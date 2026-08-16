from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Any, Optional
from datetime import date, datetime, timedelta
import os
import httpx
import pandas as pd
import user_agents
from jose import JWTError, jwt
from passlib.context import CryptContext

from db.database import get_connection, get_connection_for_org, set_org_context

# ─── Auth config ─────────────────────────────────────────────────────────────

JWT_SECRET      = os.environ.get("JWT_SECRET", "change-this-secret-in-production")
JWT_ALGORITHM   = "HS256"
JWT_EXPIRE_MINS = 60 * 8   # 8 hours

GOOGLE_CLIENT_ID     = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI  = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback")
FRONTEND_URL         = os.environ.get("FRONTEND_URL", "http://localhost:8501")

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def create_jwt(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MINS)
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return decode_jwt(credentials.credentials)


def require_owner(user=Depends(get_current_user)):
    if user.get("role") != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    return user


def get_org_id(user=Depends(get_current_user)) -> int:
    """Extracts org_id from the JWT for use with get_connection_for_org().
    Every /api/v1/rental/* route that touches org-scoped tables depends on this."""
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation context in token")
    return org_id

app = FastAPI(
    title="Rodin Property Management API",
    description="Backend API for Rodin Property Management.",
    version="1.0.0"
)

# Enable CORS so your frontend components or external tools can consume endpoints securely
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8501",
        "https://property-app-azure.vercel.app",
        "https://property-backend-taupe.vercel.app",
        "https://sr-repo-git-619970836237.northamerica-northeast2.run.app",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── JWT middleware — protects all /api/v1/rental/* routes ─────────────────────
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import time
import logging

logger = logging.getLogger("api.timing")

UNPROTECTED_PATHS = {"/", "/docs", "/openapi.json", "/redoc"}
UNPROTECTED_PREFIXES = ("/auth/", "/api/v1/metrics", "/api/v1/track",
                        "/api/v1/visitors", "/docs/", "/openapi/", "/redoc/")

class JWTMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        # Let public paths and CORS preflight through without a token
        if request.method == "OPTIONS":
            return await call_next(request)
        if path in UNPROTECTED_PATHS or any(path.startswith(p) for p in UNPROTECTED_PREFIXES):
            return await call_next(request)
        # Everything else (all /api/v1/rental/* routes) requires a valid JWT
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return JSONResponse({"detail": "Not authenticated"}, status_code=401)
        token = auth.split(" ", 1)[1]
        try:
            decode_jwt(token)
        except Exception:
            return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)
        return await call_next(request)

class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        t0 = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - t0) * 1000
        logger.info(f"{request.method} {request.url.path} → {response.status_code} ({ms:.0f}ms)")
        return response

app.add_middleware(JWTMiddleware)
app.add_middleware(TimingMiddleware)

# ─────────────────────────────────────────────────────────────────────────────
# AUTH ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

class LocalLoginBody(BaseModel):
    email:    str
    password: str

class SignupBody(BaseModel):
    org_name:  str
    full_name: str
    email:     str
    password:  str

class ProfileUpdate(BaseModel):
    full_name:           Optional[str] = None
    password:            Optional[str] = None
    theme_preference:    Optional[str] = None
    company_name:        Optional[str] = None
    sidebar_preference:  Optional[str] = None   # 'expanded' or 'collapsed'


@app.post("/auth/login")
def local_login(body: LocalLoginBody):
    """Local username/password login — used in dev (ENV=local)."""
    with get_connection() as conn:
        user = conn.execute(sql(
            "SELECT * FROM rental.users WHERE email = :email AND is_active = TRUE"
        ), {"email": body.email}).mappings().fetchone()

    if not user or not user["password_hash"]:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    try:
        valid = pwd_context.verify(body.password, user["password_hash"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Password verification error: {e}")

    if not valid:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    with get_connection() as conn:
        conn.execute(sql(
            "UPDATE rental.users SET last_login = NOW() WHERE user_id = :id"
        ), {"id": user["user_id"]})
        org_name = conn.execute(sql(
            "SELECT org_name FROM rental.organisations WHERE org_id = :oid"
        ), {"oid": user["org_id"]}).scalar()
        conn.commit()

    token = create_jwt({"sub": str(user["user_id"]), "org_id": user["org_id"],
                        "email": user["email"],
                        "role": user["role"], "name": user["full_name"]})
    return {"access_token": token, "token_type": "bearer",
            "user": {"email": user["email"], "name": user["full_name"],
                     "role": user["role"], "avatar_url": user["avatar_url"],
                     "theme": user.get("theme_preference", "light"),
                     "company_name": org_name or "Rodin Property Management",
                     "sidebar": user.get("sidebar_preference", "expanded")}}


DEFAULT_MAINTENANCE_CATEGORIES = ["hvac", "landscaping", "plumbing", "electrical", "roofing", "general", "other"]

DEFAULT_EXPENSE_TYPES = [
    "Repair", "Enbridge", "Water", "Hydro", "Maintenance", "Insurance", "Tax", "Gas",
    "Equipment", "Utilities", "Interest", "Permits", "Bank charge", "Mortgage Interest",
    "Disability Insurance", "Rent", "Deposit", "Advertising", "Car", "Legal", "Office", "Other",
]

DEFAULT_NOTICE_TYPES = [
    ("N4", "Notice to End Tenancy for Non-Payment of Rent"),
    ("N5", "Notice to End Tenancy for Interfering with Others"),
    ("N8", "Notice to End Tenancy at End of the Term"),
    ("60DAY", "60-Day Notice by Tenant to Terminate Tenancy"),
]


def seed_default_ref_data(conn, org_id: int):
    """Populate a brand-new org's customizable reference tables with sensible defaults."""
    for name in DEFAULT_MAINTENANCE_CATEGORIES:
        conn.execute(sql(
            "INSERT INTO rental.ref_maintenance_categories (name, org_id) VALUES (:name, :org_id)"
        ), {"name": name, "org_id": org_id})
    for name in DEFAULT_EXPENSE_TYPES:
        conn.execute(sql(
            "INSERT INTO rental.ref_expense_types (name, org_id) VALUES (:name, :org_id)"
        ), {"name": name, "org_id": org_id})
    for code, description in DEFAULT_NOTICE_TYPES:
        conn.execute(sql(
            "INSERT INTO rental.ref_notice_types (code, description, org_id) VALUES (:code, :description, :org_id)"
        ), {"code": code, "description": description, "org_id": org_id})


@app.post("/auth/signup")
def signup(body: SignupBody):
    """Self-serve signup — creates a brand-new org and its first owner user."""
    with get_connection() as conn:
        existing = conn.execute(sql(
            "SELECT 1 FROM rental.users WHERE email = :email"
        ), {"email": body.email}).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="Email already registered")

        org_id = conn.execute(sql(
            "INSERT INTO rental.organisations (org_name) VALUES (:org_name) RETURNING org_id"
        ), {"org_name": body.org_name}).scalar()
        set_org_context(conn, org_id)
        seed_default_ref_data(conn, org_id)

        hashed = pwd_context.hash(body.password)
        user_id = conn.execute(sql("""
            INSERT INTO rental.users (email, full_name, role, password_hash, org_id)
            VALUES (:email, :full_name, 'owner', :password_hash, :org_id)
            RETURNING user_id
        """), {"email": body.email, "full_name": body.full_name,
               "password_hash": hashed, "org_id": org_id}).scalar()
        conn.commit()

    token = create_jwt({"sub": str(user_id), "org_id": org_id,
                        "email": body.email, "role": "owner", "name": body.full_name})
    return {"access_token": token, "token_type": "bearer",
            "user": {"email": body.email, "name": body.full_name,
                     "role": "owner", "avatar_url": None,
                     "theme": "light", "company_name": body.org_name,
                     "sidebar": "expanded"}}


@app.get("/auth/google")
def google_login(frontend: Optional[str] = None):
    """Redirect user to Google OAuth consent screen.
    Pass ?frontend=<url> to control where the callback redirects after login.
    Defaults to FRONTEND_URL env var (Streamlit). Next.js passes its own URL.
    """
    import urllib.parse
    state = urllib.parse.quote(frontend or FRONTEND_URL)
    params = (
        f"client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=openid%20email%20profile"
        f"&access_type=offline"
        f"&state={state}"
    )
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@app.get("/auth/google/callback")
def google_callback(code: str, state: Optional[str] = None):
    """Google redirects here after user consents. Exchange code for token."""
    import requests as _req

    # Use corporate proxy if set in environment
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    proxies = {"https": proxy, "http": proxy} if proxy else None

    # Exchange auth code for tokens
    token_resp = _req.post("https://oauth2.googleapis.com/token", data={
        "code":          code,
        "client_id":     GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "grant_type":    "authorization_code",
    }, proxies=proxies, timeout=10)

    tokens = token_resp.json()
    if "error" in tokens:
        raise HTTPException(status_code=400,
                            detail=tokens.get("error_description", "OAuth error"))

    # Get user info from Google
    userinfo_resp = _req.get(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
        proxies=proxies, timeout=10,
    )
    info = userinfo_resp.json()

    google_id  = info.get("sub")
    email      = info.get("email")
    name       = info.get("name", email)
    avatar_url = info.get("picture")

    with get_connection() as conn:
        user = conn.execute(sql(
            "SELECT * FROM rental.users WHERE google_id = :gid OR email = :email"
        ), {"gid": google_id, "email": email}).mappings().fetchone()

        if user:
            conn.execute(sql("""
                UPDATE rental.users
                SET google_id = :gid, avatar_url = :avatar, last_login = NOW()
                WHERE user_id = :id
            """), {"gid": google_id, "avatar": avatar_url, "id": user["user_id"]})
            user_id = user["user_id"]
            org_id  = user["org_id"]
            role    = user["role"]
            name    = user["full_name"]
            theme   = user.get("theme_preference", "light")
        else:
            # Brand-new account — create a new org for them rather than ever
            # joining an existing one silently.
            new_org_id = conn.execute(sql(
                "INSERT INTO rental.organisations (org_name) VALUES (:org_name) RETURNING org_id"
            ), {"org_name": f"{name}'s Organization"}).scalar()
            set_org_context(conn, new_org_id)
            seed_default_ref_data(conn, new_org_id)

            result = conn.execute(sql("""
                INSERT INTO rental.users (email, full_name, role, google_id, avatar_url, org_id)
                VALUES (:email, :name, 'owner', :gid, :avatar, :org_id)
                RETURNING user_id, role, org_id
            """), {"email": email, "name": name, "gid": google_id, "avatar": avatar_url,
                   "org_id": new_org_id})
            row     = result.fetchone()
            user_id = row[0]
            role    = row[1]
            org_id  = row[2]
            theme   = "light"
        conn.commit()

    # Fetch company_name from the org, not the user
    with get_connection() as conn:
        company = conn.execute(sql(
            "SELECT org_name FROM rental.organisations WHERE org_id = :oid"
        ), {"oid": org_id}).scalar() or "Rodin Property Management"

    token = create_jwt({"sub": str(user_id), "org_id": org_id, "email": email, "role": role,
                        "name": name, "theme": theme, "company_name": company})
    import urllib.parse
    redirect_base = urllib.parse.unquote(state) if state else FRONTEND_URL
    return RedirectResponse(f"{redirect_base}?token={token}&theme={theme}")


@app.get("/auth/me")
def get_me(user=Depends(get_current_user)):
    """Return current user info from JWT."""
    return user


@app.patch("/auth/profile")
def update_profile(body: ProfileUpdate, user=Depends(get_current_user)):
    """Update name, password, or theme preference."""
    fields = {}
    if body.full_name:
        fields["full_name"] = body.full_name
    if body.password:
        fields["password_hash"] = pwd_context.hash(body.password)
    if body.theme_preference in ("light", "dark"):
        fields["theme_preference"] = body.theme_preference
    if body.sidebar_preference in ("expanded", "collapsed"):
        fields["sidebar_preference"] = body.sidebar_preference
    if body.company_name is not None:
        fields["company_name"] = body.company_name
    if not fields:
        raise HTTPException(status_code=400, detail="Nothing to update")

    with get_connection() as conn:
        # company_name lives on the org, not the user — scope the update to the caller's org
        if "company_name" in fields:
            conn.execute(sql(
                "UPDATE rental.organisations SET org_name = :org_name WHERE org_id = :org_id"
            ), {"org_name": fields.pop("company_name"), "org_id": user["org_id"]})

        # All other fields update only this user
        if fields:
            set_clause = ", ".join(f"{k} = :{k}" for k in fields)
            fields["user_id"] = int(user["sub"])
            conn.execute(sql(f"UPDATE rental.users SET {set_clause} WHERE user_id = :user_id"), fields)

        conn.commit()
    return {"updated": True, "theme_preference": body.theme_preference}


@app.post("/auth/create-user")
def create_user(email: str, full_name: str, password: str, role: str = "owner",
                user=Depends(require_owner)):
    """Create a new local user (owner only)."""
    from sqlalchemy import text as _sql
    hashed = pwd_context.hash(password)
    with get_connection() as conn:
        try:
            result = conn.execute(_sql("""
                INSERT INTO rental.users (email, full_name, role, password_hash, org_id)
                VALUES (:email, :full_name, :role, :password_hash, :org_id)
                RETURNING user_id
            """), {"email": email, "full_name": full_name, "role": role, "password_hash": hashed,
                   "org_id": user["org_id"]})
            uid = result.fetchone()[0]
            conn.commit()
        except Exception:
            raise HTTPException(status_code=409, detail="Email already exists")
    return {"user_id": uid}


@app.get("/auth/users")
def list_org_users(user=Depends(require_owner)):
    """List teammates in the caller's org (owner only).
    rental.users has no RLS — the WHERE org_id filter here is load-bearing."""
    with get_connection() as conn:
        rows = conn.execute(sql("""
            SELECT user_id, email, full_name, role, is_active, last_login
            FROM rental.users
            WHERE org_id = :org_id
            ORDER BY full_name
        """), {"org_id": user["org_id"]}).mappings().all()
    return [dict(r) for r in rows]


@app.get("/")
def read_root():
    """
    Health check endpoint.
    Resolves the 404 error by returning system validation metrics.
    """
    return {
        "status": "online",
        "tier": "backend-api",
        "message": "Data Engine Engine Pipeline is active and responding securely."
    }

@app.get("/api/v1/metrics")
def get_metrics():
    """
    Sample high-performance data processing endpoint.
    Simulates aggregating summary metrics using pandas dataframes.
    """
    # Sample matrix mimicking records fetched from an engineering database
    raw_data = {
        "Region": ["Greater Toronto Area", "Durham Region", "Peterborough", "Ottawa Valley"],
        "Performance_Index": [94.2, 89.7, 85.1, 91.5],
        "Active_Pipelines": [12, 8, 5, 9]
    }
    
    # Process into a Pandas DataFrame for validation/manipulation
    df = pd.DataFrame(raw_data)
    
    # Convert dataframe seamlessly back into a structured JSON dictionary array
    return df.to_dict(orient="records")


class VisitorEvent(BaseModel):
    visitor_uuid: str | None = None
    session_id: str | None = None
    referrer_url: str | None = None
    pages_visited: list[dict[str, Any]] = []


@app.post("/api/v1/track", status_code=201)
async def track_visitor(event: VisitorEvent, request: Request):
    """
    Records a visitor event into web.public_visitor_logs.
    Geo and device details are derived server-side from the request headers.
    """
    import json
    from sqlalchemy import text

    ip = request.headers.get("x-forwarded-for", request.client.host).split(",")[0].strip()
    ua_string = request.headers.get("user-agent", "")
    ua = user_agents.parse(ua_string)

    if ua.is_mobile:
        device_type = "Mobile"
    elif ua.is_tablet:
        device_type = "Tablet"
    else:
        device_type = "Desktop"

    browser = ua.browser.family if ua.browser.family else "Unknown"

    # Geo lookup — fails gracefully if the service is unavailable
    country, region = None, None
    try:
        geo = requests.get(f"http://ip-api.com/json/{ip}?fields=country,regionName", timeout=2).json()
        if geo.get("country"):
            country = geo["country"]
            region = geo.get("regionName")
    except Exception:
        pass

    try:
        with get_connection() as conn:
            result = conn.execute(
                text("""
                INSERT INTO web.public_visitor_logs
                    (visitor_uuid, session_id, ip_address, device_type, browser,
                     referrer_url, pages_visited, total_pages_viewed, country, region)
                VALUES
                    (:visitor_uuid, :session_id, CAST(:ip AS inet), :device_type, :browser,
                     :referrer_url, CAST(:pages AS jsonb), :total_pages, :country, :region)
                RETURNING id, visit_timestamp
                """),
                {
                    "visitor_uuid": event.visitor_uuid,
                    "session_id": event.session_id,
                    "ip": ip,
                    "device_type": device_type,
                    "browser": browser,
                    "referrer_url": event.referrer_url,
                    "pages": json.dumps(event.pages_visited),
                    "total_pages": len(event.pages_visited) or 1,
                    "country": country,
                    "region": region,
                },
            )
            row = result.fetchone()
            conn.commit()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"id": row[0], "visit_timestamp": row[1]}


@app.get("/api/v1/visitors")
def get_visitor_stats():
    """
    Returns aggregated visitor statistics from web.public_visitor_logs.
    """
    from sqlalchemy import text

    with get_connection() as conn:
        total = conn.execute(text("SELECT COUNT(*) FROM web.public_visitor_logs")).scalar()
        today = conn.execute(text(
            "SELECT COUNT(*) FROM web.public_visitor_logs WHERE visit_timestamp >= CURRENT_DATE"
        )).scalar()
        by_device = conn.execute(text(
            "SELECT device_type, COUNT(*) AS visits FROM web.public_visitor_logs GROUP BY device_type ORDER BY visits DESC"
        )).mappings().all()
        by_country = conn.execute(text(
            "SELECT COALESCE(country, 'Unknown') AS country, COUNT(*) AS visits FROM web.public_visitor_logs GROUP BY country ORDER BY visits DESC LIMIT 10"
        )).mappings().all()
        by_day = conn.execute(text(
            "SELECT visit_timestamp::date AS day, COUNT(*) AS visits FROM web.public_visitor_logs GROUP BY day ORDER BY day DESC LIMIT 30"
        )).mappings().all()

    return {
        "total_visits": total,
        "visits_today": today,
        "by_device": [dict(r) for r in by_device],
        "by_country": [dict(r) for r in by_country],
        "by_day": [{"day": str(r["day"]), "visits": r["visits"]} for r in by_day],
    }


# ─────────────────────────────────────────────────────────────────────────────
# RENTAL PROPERTY MANAGEMENT API
# ─────────────────────────────────────────────────────────────────────────────

from sqlalchemy import text as sql
import re

def clean_phone(raw: str | None) -> str | None:
    """Strip all non-digit characters except leading +. Store digits only."""
    if not raw:
        return None
    raw = raw.strip()
    # Preserve leading + for international numbers
    if raw.startswith("+"):
        digits = "+" + re.sub(r"\D", "", raw[1:])
    else:
        digits = re.sub(r"\D", "", raw)
    return digits if digits else None

# ── Properties ────────────────────────────────────────────────────────────────

class PropertyBody(BaseModel):
    address:       str
    city:          str
    state:         str = "ON"
    zip:           Optional[str] = None
    property_type: Optional[str] = None
    notes:         Optional[str] = None
    province_code: Optional[str] = None
    country:       Optional[str] = "CA"
    rentable_since: Optional[date] = None

class PropertyUpdate(BaseModel):
    address:       Optional[str] = None
    city:          Optional[str] = None
    state:         Optional[str] = None
    zip:           Optional[str] = None
    property_type: Optional[str] = None
    notes:         Optional[str] = None
    province_code: Optional[str] = None
    country:       Optional[str] = None
    rentable_since: Optional[date] = None

@app.get("/api/v1/rental/properties")
def get_properties(org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT p.property_id, p.address, p.city, p.state, p.zip, p.property_type, p.notes,
                   p.province_code, p.country, p.rentable_since,
                   COUNT(DISTINCT u.unit_id)  AS unit_count,
                   COUNT(DISTINCT rs.space_id) AS space_count
            FROM rental.properties p
            LEFT JOIN rental.units u  ON u.property_id = p.property_id
            LEFT JOIN rental.rentable_spaces rs ON rs.unit_id = u.unit_id
            GROUP BY p.property_id
            ORDER BY p.property_id
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.get("/api/v1/rental/properties/with-units-and-spaces")
def get_properties_with_units_and_spaces(org_id: int = Depends(get_org_id)):
    """Return all properties with their units and spaces in one query — eliminates N+1 on the properties page."""
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT
                p.property_id, p.address, p.city, p.state, p.zip, p.property_type,
                p.notes AS property_notes, p.province_code, p.country, p.rentable_since,
                u.unit_id, u.unit_number, u.bedrooms, u.bathrooms, u.sq_ft,
                u.notes AS unit_notes, u.available_since,
                rs.space_id, rs.space_name, rs.notes AS space_notes,
                l.lease_id, l.total_rent, l.status AS lease_status,
                l.start_date, l.end_date,
                STRING_AGG(DISTINCT t.first_name || ' ' || t.last_name, ', ') AS tenants,
                COALESCE(SUM(lm.monthly_obligation), 0) AS total_rent_obligation
            FROM rental.properties p
            LEFT JOIN rental.units u ON u.property_id = p.property_id
            LEFT JOIN rental.rentable_spaces rs ON rs.unit_id = u.unit_id
            LEFT JOIN rental.leases l ON l.space_id = rs.space_id AND l.status = 'active'
            LEFT JOIN rental.lease_members lm ON lm.lease_id = l.lease_id
            LEFT JOIN rental.tenants t ON t.tenant_id = lm.tenant_id
            GROUP BY p.property_id, p.address, p.city, p.state, p.zip, p.property_type,
                     p.notes, p.province_code, p.country, p.rentable_since,
                     u.unit_id, u.unit_number, u.bedrooms, u.bathrooms, u.sq_ft,
                     u.notes, u.available_since,
                     rs.space_id, rs.space_name, rs.notes,
                     l.lease_id, l.total_rent, l.status, l.start_date, l.end_date
            ORDER BY p.property_id, u.unit_number, rs.space_name
        """)).mappings().all()

    # Assemble nested structure: properties → units → spaces
    props = {}
    for r in rows:
        pid = r["property_id"]
        if pid not in props:
            props[pid] = {
                "property_id": r["property_id"],
                "address": r["address"],
                "city": r["city"],
                "state": r["state"],
                "zip": r["zip"],
                "property_type": r["property_type"],
                "notes": r["property_notes"],
                "province_code": r["province_code"],
                "country": r["country"],
                "rentable_since": r["rentable_since"],
                "unit_count": 0,
                "space_count": 0,
                "units": {},
            }

        uid = r["unit_id"]
        if uid is None:
            continue
        if uid not in props[pid]["units"]:
            props[pid]["units"][uid] = {
                "unit_id": uid,
                "unit_number": r["unit_number"],
                "bedrooms": r["bedrooms"],
                "bathrooms": r["bathrooms"],
                "sq_ft": r["sq_ft"],
                "notes": r["unit_notes"],
                "available_since": r["available_since"],
                "space_count": 0,
                "spaces": {},
            }
            props[pid]["unit_count"] += 1

        sid = r["space_id"]
        if sid is None:
            continue
        if sid not in props[pid]["units"][uid]["spaces"]:
            props[pid]["units"][uid]["spaces"][sid] = {
                "space_id": sid,
                "space_name": r["space_name"],
                "notes": r["space_notes"],
                "lease_id": r["lease_id"],
                "total_rent": r["total_rent"],
                "lease_status": r["lease_status"],
                "start_date": r["start_date"],
                "end_date": r["end_date"],
                "tenants": r["tenants"],
                "total_obligation": r["total_rent_obligation"],
            }
            props[pid]["units"][uid]["space_count"] += 1
            props[pid]["space_count"] += 1

    # Convert dicts to lists
    result = []
    for prop in props.values():
        units = []
        for unit in prop["units"].values():
            unit["spaces"] = list(unit["spaces"].values())
            units.append(unit)
        prop["units"] = units
        result.append(prop)
    return result

@app.post("/api/v1/rental/properties", status_code=201)
def create_property(body: PropertyBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        limit = conn.execute(sql(
            "SELECT property_limit FROM rental.organisations WHERE org_id = :org_id"
        ), {"org_id": org_id}).scalar()
        if limit is not None:
            count = conn.execute(sql("SELECT COUNT(*) FROM rental.properties")).scalar()
            if count >= limit:
                raise HTTPException(status_code=402, detail=(
                    f"Free plan is limited to {limit} propert{'y' if limit == 1 else 'ies'}. "
                    "Upgrade to add more."
                ))
        result = conn.execute(sql("""
            INSERT INTO rental.properties (address, city, state, zip, property_type, notes, province_code, country, rentable_since, org_id)
            VALUES (:address, :city, :state, :zip, :property_type, :notes, :province_code, :country, :rentable_since, :org_id)
            RETURNING property_id
        """), {**body.model_dump(), "org_id": org_id})
        pid = result.fetchone()[0]
        conn.commit()
    return {"property_id": pid}

@app.patch("/api/v1/rental/properties/{property_id}")
def update_property(property_id: int, body: PropertyUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["property_id"] = property_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.properties SET {set_clause} WHERE property_id = :property_id"), fields)
        conn.commit()
    return {"updated": property_id}

@app.delete("/api/v1/rental/properties/{property_id}", status_code=204)
def delete_property(property_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.properties WHERE property_id = :id"), {"id": property_id})
        conn.commit()


# ── Units ─────────────────────────────────────────────────────────────────────

class UnitBody(BaseModel):
    unit_number: str = "1"
    bedrooms:    Optional[int]   = None
    bathrooms:   Optional[float] = None
    sq_ft:       Optional[int]   = None
    notes:       Optional[str]   = None
    available_since: Optional[date] = None

class UnitUpdate(BaseModel):
    unit_number: Optional[str]   = None
    bedrooms:    Optional[int]   = None
    bathrooms:   Optional[float] = None
    sq_ft:       Optional[int]   = None
    notes:       Optional[str]   = None
    available_since: Optional[date] = None

@app.get("/api/v1/rental/properties/{property_id}/units")
def get_units(property_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT u.unit_id, u.unit_number, u.bedrooms, u.bathrooms, u.sq_ft, u.notes, u.available_since,
                   COUNT(rs.space_id) AS space_count
            FROM rental.units u
            LEFT JOIN rental.rentable_spaces rs ON rs.unit_id = u.unit_id
            WHERE u.property_id = :property_id
            GROUP BY u.unit_id
            ORDER BY u.unit_number
        """), {"property_id": property_id}).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/properties/{property_id}/units", status_code=201)
def create_unit(property_id: int, body: UnitBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        limit = conn.execute(sql(
            "SELECT unit_limit FROM rental.organisations WHERE org_id = :org_id"
        ), {"org_id": org_id}).scalar()
        if limit is not None:
            count = conn.execute(sql(
                "SELECT COUNT(*) FROM rental.units WHERE property_id = :property_id"
            ), {"property_id": property_id}).scalar()
            if count >= limit:
                raise HTTPException(status_code=402, detail=(
                    f"Free plan is limited to {limit} unit{'s' if limit != 1 else ''} per property. "
                    "Upgrade to add more."
                ))
        result = conn.execute(sql("""
            INSERT INTO rental.units (property_id, unit_number, bedrooms, bathrooms, sq_ft, notes, available_since, org_id)
            VALUES (:property_id, :unit_number, :bedrooms, :bathrooms, :sq_ft, :notes, :available_since, :org_id)
            RETURNING unit_id
        """), {"property_id": property_id, "org_id": org_id, **body.model_dump()})
        uid = result.fetchone()[0]
        conn.commit()
    return {"unit_id": uid}

@app.patch("/api/v1/rental/units/{unit_id}")
def update_unit(unit_id: int, body: UnitUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["unit_id"] = unit_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.units SET {set_clause} WHERE unit_id = :unit_id"), fields)
        conn.commit()
    return {"updated": unit_id}

@app.delete("/api/v1/rental/units/{unit_id}", status_code=204)
def delete_unit(unit_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.units WHERE unit_id = :id"), {"id": unit_id})
        conn.commit()


# ── Rentable Spaces ───────────────────────────────────────────────────────────

class SpaceBody(BaseModel):
    space_name: str
    notes:      Optional[str] = None

class SpaceUpdate(BaseModel):
    space_name: Optional[str] = None
    notes:      Optional[str] = None

@app.get("/api/v1/rental/units/{unit_id}/spaces")
def get_spaces(unit_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT rs.space_id, rs.space_name, rs.notes,
                   l.lease_id, l.total_rent, l.status AS lease_status,
                   l.start_date, l.end_date,
                   STRING_AGG(t.first_name || ' ' || t.last_name, ', ') AS tenants,
                   COALESCE(SUM(lm.monthly_obligation), 0) AS total_obligation
            FROM rental.rentable_spaces rs
            LEFT JOIN rental.leases l ON l.space_id = rs.space_id AND l.status = 'active'
            LEFT JOIN rental.lease_members lm ON lm.lease_id = l.lease_id
            LEFT JOIN rental.tenants t ON t.tenant_id = lm.tenant_id
            WHERE rs.unit_id = :unit_id
            GROUP BY rs.space_id, l.lease_id
            ORDER BY rs.space_name
        """), {"unit_id": unit_id}).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/units/{unit_id}/spaces", status_code=201)
def create_space(unit_id: int, body: SpaceBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        limit = conn.execute(sql(
            "SELECT space_limit FROM rental.organisations WHERE org_id = :org_id"
        ), {"org_id": org_id}).scalar()
        if limit is not None:
            count = conn.execute(sql(
                "SELECT COUNT(*) FROM rental.rentable_spaces WHERE unit_id = :unit_id"
            ), {"unit_id": unit_id}).scalar()
            if count >= limit:
                raise HTTPException(status_code=402, detail=(
                    f"Free plan is limited to {limit} rentable space{'s' if limit != 1 else ''} per unit. "
                    "Upgrade to add more."
                ))
        result = conn.execute(sql("""
            INSERT INTO rental.rentable_spaces (unit_id, space_name, notes, org_id)
            VALUES (:unit_id, :space_name, :notes, :org_id)
            RETURNING space_id
        """), {"unit_id": unit_id, "org_id": org_id, **body.model_dump()})
        sid = result.fetchone()[0]
        conn.commit()
    return {"space_id": sid}

@app.patch("/api/v1/rental/spaces/{space_id}")
def update_space(space_id: int, body: SpaceUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["space_id"] = space_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.rentable_spaces SET {set_clause} WHERE space_id = :space_id"), fields)
        conn.commit()
    return {"updated": space_id}

@app.delete("/api/v1/rental/spaces/{space_id}", status_code=204)
def delete_space(space_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.rentable_spaces WHERE space_id = :id"), {"id": space_id})
        conn.commit()


# ── Tenants ───────────────────────────────────────────────────────────────────

class TenantBody(BaseModel):
    first_name: str
    last_name:  str
    email:      Optional[str] = None
    phone:      Optional[str] = None
    notes:      Optional[str] = None
    id_type_id: Optional[int] = None
    id_number: Optional[str] = None
    preferred_contact_id: Optional[int] = None
    email_consent: Optional[bool] = False

class TenantUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name:  Optional[str] = None
    email:      Optional[str] = None
    phone:      Optional[str] = None
    notes:      Optional[str] = None
    id_type_id: Optional[int] = None
    id_number: Optional[str] = None
    preferred_contact_id: Optional[int] = None
    email_consent: Optional[bool] = None

@app.get("/api/v1/rental/tenants")
def get_tenants(org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT t.tenant_id, t.first_name, t.last_name, t.email, t.phone, t.notes,
                   t.id_type_id, t.id_number, t.preferred_contact_id, t.email_consent,
                   idt.name AS id_type_name, cm.name AS preferred_contact_name,
                   lm.lease_id, lm.monthly_obligation, lm.is_primary,
                   l.status AS lease_status, l.start_date, l.end_date,
                   rs.space_name, u.unit_number,
                   p.address
            FROM rental.tenants t
            LEFT JOIN rental.ref_id_types idt ON idt.type_id = t.id_type_id
            LEFT JOIN rental.ref_contact_methods cm ON cm.method_id = t.preferred_contact_id
            LEFT JOIN rental.lease_members lm ON lm.tenant_id = t.tenant_id
            LEFT JOIN rental.leases l ON l.lease_id = lm.lease_id AND l.status = 'active'
            LEFT JOIN rental.rentable_spaces rs ON rs.space_id = l.space_id
            LEFT JOIN rental.units u ON u.unit_id = rs.unit_id
            LEFT JOIN rental.properties p ON p.property_id = u.property_id
            ORDER BY t.last_name, t.first_name
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/tenants", status_code=201)
def create_tenant(body: TenantBody, org_id: int = Depends(get_org_id)):
    data = body.model_dump()
    data["phone"] = clean_phone(data.get("phone"))
    data["org_id"] = org_id
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.tenants (first_name, last_name, email, phone, notes, id_type_id, id_number, preferred_contact_id, email_consent, org_id)
            VALUES (:first_name, :last_name, :email, :phone, :notes, :id_type_id, :id_number, :preferred_contact_id, :email_consent, :org_id)
            RETURNING tenant_id
        """), data)
        tid = result.fetchone()[0]
        conn.commit()
    return {"tenant_id": tid}

@app.patch("/api/v1/rental/tenants/{tenant_id}")
def update_tenant(tenant_id: int, body: TenantUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "phone" in fields:
        fields["phone"] = clean_phone(fields["phone"])
    if "email" in fields and not fields["email"]:
        fields.pop("email")  # don't blank out email accidentally

    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["tenant_id"] = tenant_id

    with get_connection_for_org(org_id) as conn:
        # Before updating, archive old phone/email to contact history if they changed
        current = conn.execute(sql(
            "SELECT phone, email FROM rental.tenants WHERE tenant_id = :id"
        ), {"id": tenant_id}).mappings().fetchone()

        if current:
            for contact_type in ("phone", "email"):
                new_val = fields.get(contact_type)
                old_val = current[contact_type]
                if contact_type == "phone":
                    changed = new_val and old_val and clean_phone(new_val) != clean_phone(old_val)
                else:
                    changed = new_val and old_val and new_val != old_val
                if changed:
                    # Archive the old value
                    conn.execute(sql("""
                        INSERT INTO rental.tenant_contact_history
                            (tenant_id, contact_type, value, effective_from, effective_to, notes, org_id)
                        VALUES (:tid, :ct, :val, CURRENT_DATE, NULL, 'Auto-archived on update', :org_id)
                    """), {"tid": tenant_id, "ct": contact_type, "val": old_val, "org_id": org_id})

        conn.execute(sql(f"UPDATE rental.tenants SET {set_clause} WHERE tenant_id = :tenant_id"), fields)
        conn.commit()
    return {"updated": tenant_id}

@app.delete("/api/v1/rental/tenants/{tenant_id}", status_code=204)
def delete_tenant(tenant_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        active = conn.execute(sql("""
            SELECT COUNT(*) FROM rental.lease_members lm
            JOIN rental.leases l ON l.lease_id = lm.lease_id
            WHERE lm.tenant_id = :id AND l.status = 'active'
        """), {"id": tenant_id}).scalar()
        if active:
            raise HTTPException(status_code=409, detail="Tenant has an active lease. End the lease first.")
        conn.execute(sql("DELETE FROM rental.tenants WHERE tenant_id = :id"), {"id": tenant_id})
        conn.commit()


# ── Leases ────────────────────────────────────────────────────────────────────

class LeaseBody(BaseModel):
    space_id:         int
    start_date:       date
    end_date:         Optional[date]  = None
    total_rent:       float
    security_deposit: Optional[float] = None
    notes:            Optional[str]   = None
    lease_type_code:  Optional[int]   = 1
    status_code:      Optional[int]   = None
    lmr_deposit:      Optional[float] = None

class LeaseUpdate(BaseModel):
    total_rent:       Optional[float] = None
    start_date:       Optional[date]  = None
    end_date:         Optional[date]  = None
    security_deposit: Optional[float] = None
    status:           Optional[str]   = None
    notes:            Optional[str]   = None
    lease_type_code:  Optional[int]   = None
    status_code:      Optional[int]   = None
    lmr_deposit:      Optional[float] = None

@app.get("/api/v1/rental/leases")
def get_leases(space_id: Optional[int] = None, status: Optional[str] = None, org_id: int = Depends(get_org_id)):
    filters, params = [], {}
    if space_id:
        filters.append("l.space_id = :space_id")
        params["space_id"] = space_id
    if status:
        filters.append("l.status = :status")
        params["status"] = status
    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql(f"""
            SELECT l.lease_id, l.space_id, l.start_date, l.end_date,
                   l.total_rent, l.security_deposit, l.status, l.notes,
                   l.lease_type_code, l.status_code, l.lmr_deposit,
                   lt.label AS lease_type_label, ls.label AS status_label,
                   rs.space_name, u.unit_number, p.address,
                   COUNT(lm.member_id) AS member_count,
                   COALESCE(SUM(lm.monthly_obligation), 0) AS total_obligation
            FROM rental.leases l
            LEFT JOIN rental.ref_lease_statuses lt ON lt.code = l.lease_type_code
            LEFT JOIN rental.ref_lease_statuses ls ON ls.code = l.status_code
            JOIN rental.rentable_spaces rs ON rs.space_id = l.space_id
            JOIN rental.units u ON u.unit_id = rs.unit_id
            JOIN rental.properties p ON p.property_id = u.property_id
            LEFT JOIN rental.lease_members lm ON lm.lease_id = l.lease_id
            {where}
            GROUP BY l.lease_id, rs.space_id, u.unit_id, p.property_id, lt.label, ls.label
            ORDER BY l.start_date DESC
        """), params).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/leases", status_code=201)
def create_lease(body: LeaseBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        data = body.model_dump()
        effective_status = data.get("status_code") or data.get("lease_type_code") or 1
        result = conn.execute(sql("""
            INSERT INTO rental.leases (space_id, start_date, end_date, total_rent, security_deposit, notes, lease_type_code, status_code, lmr_deposit, org_id)
            VALUES (:space_id, :start_date, :end_date, :total_rent, :security_deposit, :notes, :lease_type_code, :status_code, :lmr_deposit, :org_id)
            RETURNING lease_id
        """), {**data, "status_code": effective_status, "org_id": org_id})
        lease_id = result.fetchone()[0]
        conn.commit()
    return {"lease_id": lease_id}

@app.patch("/api/v1/rental/leases/{lease_id}")
def update_lease(lease_id: int, body: LeaseUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["lease_id"] = lease_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.leases SET {set_clause} WHERE lease_id = :lease_id"), fields)
        conn.commit()
    return {"updated": lease_id}


@app.delete("/api/v1/rental/leases/{lease_id}", status_code=204)
def delete_lease(lease_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.leases WHERE lease_id = :id"), {"id": lease_id})
        conn.commit()


# ── Lease Members ─────────────────────────────────────────────────────────────

class LeaseMemberBody(BaseModel):
    tenant_id:          int
    monthly_obligation: float
    is_primary:         bool = False
    member_type:        str = "tenant"
    sublease_start:     Optional[date] = None
    sublease_end:       Optional[date] = None

class LeaseMemberUpdate(BaseModel):
    monthly_obligation: Optional[float] = None
    is_primary:         Optional[bool]  = None
    member_type:        Optional[str] = None
    sublease_start:     Optional[date] = None
    sublease_end:       Optional[date] = None

@app.get("/api/v1/rental/leases/{lease_id}/members")
def get_lease_members(lease_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT lm.member_id, lm.lease_id, lm.tenant_id, lm.monthly_obligation, lm.is_primary,
                   lm.member_type, lm.sublease_start, lm.sublease_end,
                   t.first_name, t.last_name, t.email, t.phone
            FROM rental.lease_members lm
            JOIN rental.tenants t ON t.tenant_id = lm.tenant_id
            WHERE lm.lease_id = :lease_id
            ORDER BY lm.is_primary DESC, t.last_name
        """), {"lease_id": lease_id}).mappings().all()
    return [dict(r) for r in rows]

@app.get("/api/v1/rental/leases/with-members")
def get_leases_with_members(org_id: int = Depends(get_org_id)):
    """Return all leases with their members embedded — eliminates N+1 on the leases page."""
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT l.lease_id, l.space_id, l.start_date, l.end_date,
                   l.total_rent, l.security_deposit, l.notes,
                   l.lease_type_code, l.status_code, l.lmr_deposit,
                   lt.label AS lease_type_label, ls.label AS status_label,
                   rs.space_name, u.unit_number, p.address,
                   lm.member_id, lm.tenant_id, lm.monthly_obligation,
                   lm.is_primary, lm.member_type, lm.sublease_start, lm.sublease_end,
                   t.first_name, t.last_name, t.email, t.phone
            FROM rental.leases l
            LEFT JOIN rental.ref_lease_statuses lt ON lt.code = l.lease_type_code
            LEFT JOIN rental.ref_lease_statuses ls ON ls.code = l.status_code
            JOIN rental.rentable_spaces rs ON rs.space_id = l.space_id
            JOIN rental.units u ON u.unit_id = rs.unit_id
            JOIN rental.properties p ON p.property_id = u.property_id
            LEFT JOIN rental.lease_members lm ON lm.lease_id = l.lease_id
            LEFT JOIN rental.tenants t ON t.tenant_id = lm.tenant_id
            ORDER BY l.start_date DESC, lm.is_primary DESC, t.last_name
        """)).mappings().all()

    leases = {}
    for r in rows:
        lid = r["lease_id"]
        if lid not in leases:
            leases[lid] = {
                "lease_id":         lid,
                "space_id":         r["space_id"],
                "start_date":       r["start_date"],
                "end_date":         r["end_date"],
                "total_rent":       r["total_rent"],
                "security_deposit": r["security_deposit"],
                "notes":            r["notes"],
                "lease_type_code":  r["lease_type_code"],
                "status_code":      r["status_code"],
                "lmr_deposit":      r["lmr_deposit"],
                "lease_type_label": r["lease_type_label"],
                "status_label":     r["status_label"],
                "space_name":       r["space_name"],
                "unit_number":      r["unit_number"],
                "address":          r["address"],
                "member_count":     0,
                "members":          [],
            }
        if r["member_id"] is not None:
            leases[lid]["members"].append({
                "member_id":          r["member_id"],
                "lease_id":           lid,
                "tenant_id":          r["tenant_id"],
                "monthly_obligation": r["monthly_obligation"],
                "is_primary":         r["is_primary"],
                "member_type":        r["member_type"],
                "sublease_start":     r["sublease_start"],
                "sublease_end":       r["sublease_end"],
                "first_name":         r["first_name"],
                "last_name":          r["last_name"],
                "email":              r["email"],
                "phone":              r["phone"],
            })
            leases[lid]["member_count"] += 1

    return list(leases.values())

@app.post("/api/v1/rental/leases/{lease_id}/members", status_code=201)
def add_lease_member(lease_id: int, body: LeaseMemberBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.lease_members (lease_id, tenant_id, monthly_obligation, is_primary, member_type, sublease_start, sublease_end, org_id)
            VALUES (:lease_id, :tenant_id, :monthly_obligation, :is_primary, :member_type, :sublease_start, :sublease_end, :org_id)
            RETURNING member_id
        """), {"lease_id": lease_id, "org_id": org_id, **body.model_dump()})
        mid = result.fetchone()[0]
        conn.commit()
    return {"member_id": mid}

@app.patch("/api/v1/rental/lease-members/{member_id}")
def update_lease_member(member_id: int, body: LeaseMemberUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["member_id"] = member_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.lease_members SET {set_clause} WHERE member_id = :member_id"), fields)
        conn.commit()
    return {"updated": member_id}

@app.delete("/api/v1/rental/lease-members/{member_id}", status_code=204)
def remove_lease_member(member_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.lease_members WHERE member_id = :id"), {"id": member_id})
        conn.commit()


# ── Rent Ledger ───────────────────────────────────────────────────────────────

class LedgerBody(BaseModel):
    lease_id:       int
    tenant_id:      int
    due_date:       date
    amount_due:     float
    amount_paid:    Optional[float] = None
    paid_date:      Optional[date]  = None
    payment_method: Optional[str]   = None
    payment_method_code: Optional[str] = None
    status:         Optional[str]   = "pending"
    promised_date:  Optional[date]  = None
    promised_amount: Optional[float] = None
    notes:          Optional[str]   = None

class LedgerUpdate(BaseModel):
    amount_paid:        Optional[float] = None
    paid_date:          Optional[date]  = None
    payment_method:     Optional[str]   = None
    payment_method_code: Optional[str] = None
    status:             Optional[str]   = None
    promised_date:      Optional[date]  = None
    promised_amount:    Optional[float] = None
    paid_by_tenant_id:  Optional[int]   = None
    notes:              Optional[str]   = None

@app.get("/api/v1/rental/ledger")
def get_ledger(
    lease_id:  Optional[int] = None,
    tenant_id: Optional[int] = None,
    status:    Optional[str] = None,
    month:     Optional[str] = None,   # YYYY-MM
    org_id: int = Depends(get_org_id),
):
    filters, params = [], {}
    if lease_id:
        filters.append("rl.lease_id = :lease_id")
        params["lease_id"] = lease_id
    if tenant_id:
        filters.append("rl.tenant_id = :tenant_id")
        params["tenant_id"] = tenant_id
    if status:
        filters.append("rl.status = :status")
        params["status"] = status
    if month:
        filters.append("TO_CHAR(rl.due_date, 'YYYY-MM') = :month")
        params["month"] = month
    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql(f"""
            SELECT rl.ledger_id, rl.lease_id, rl.tenant_id, rl.due_date,
                   rl.amount_due, rl.amount_paid, rl.paid_date,
                   rl.payment_method, rl.payment_method_code, rl.status,
                   rl.promised_date, rl.promised_amount, rl.notes,
                   rl.paid_by_tenant_id,
                   pm.label AS payment_method_label,
                   t.first_name || ' ' || t.last_name AS tenant_name,
                   pb.first_name || ' ' || pb.last_name AS paid_by_name,
                   rs.space_name, u.unit_number, p.address
            FROM rental.rent_ledger rl
            JOIN rental.tenants t ON t.tenant_id = rl.tenant_id
            LEFT JOIN rental.tenants pb ON pb.tenant_id = rl.paid_by_tenant_id
            LEFT JOIN rental.ref_payment_methods pm ON pm.code = rl.payment_method_code
            JOIN rental.leases l ON l.lease_id = rl.lease_id
            JOIN rental.rentable_spaces rs ON rs.space_id = l.space_id
            JOIN rental.units u ON u.unit_id = rs.unit_id
            JOIN rental.properties p ON p.property_id = u.property_id
            {where}
            ORDER BY rl.due_date DESC, t.last_name
        """), params).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/ledger", status_code=201)
def create_ledger_entry(body: LedgerBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.rent_ledger
                (lease_id, tenant_id, due_date, amount_due, amount_paid, paid_date,
                 payment_method, payment_method_code, status, promised_date, promised_amount, notes, org_id)
            VALUES
                (:lease_id, :tenant_id, :due_date, :amount_due, :amount_paid, :paid_date,
                 :payment_method, :payment_method_code, :status, :promised_date, :promised_amount, :notes, :org_id)
            RETURNING ledger_id
        """), {**body.model_dump(), "org_id": org_id})
        lid = result.fetchone()[0]

        # If created with amount_paid already set, log it as a transaction too
        if body.amount_paid and body.amount_paid > 0 and body.paid_date:
            conn.execute(sql("""
                INSERT INTO rental.payment_transactions
                    (ledger_id, amount, paid_date, payment_method_code, notes, org_id)
                VALUES (:lid, :amount, :paid_date, :method, :notes, :org_id)
            """), {
                "lid":      lid,
                "amount":   body.amount_paid,
                "paid_date": body.paid_date,
                "method":   body.payment_method_code,
                "notes":    body.notes,
                "org_id":   org_id,
            })
        conn.commit()
    return {"ledger_id": lid}

@app.patch("/api/v1/rental/ledger/{ledger_id}")
def update_ledger_entry(ledger_id: int, body: LedgerUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["ledger_id"] = ledger_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.rent_ledger SET {set_clause} WHERE ledger_id = :ledger_id"), fields)
        conn.commit()
    return {"updated": ledger_id}


class PaymentInstalment(BaseModel):
    amount:              float
    paid_date:           date
    payment_method_code: Optional[str] = None
    notes:               Optional[str] = None


@app.post("/api/v1/rental/ledger/{ledger_id}/pay")
def record_payment_instalment(ledger_id: int, body: PaymentInstalment, org_id: int = Depends(get_org_id)):
    """Add a payment instalment — accumulates on top of any existing amount_paid.
    Automatically sets status to paid/partial based on total collected vs amount_due."""
    with get_connection_for_org(org_id) as conn:
        row = conn.execute(sql("""
            SELECT rl.amount_due, COALESCE(rl.amount_paid, 0) AS already_paid,
                   COALESCE((SELECT SUM(amount) FROM rental.rent_adjustments WHERE ledger_id = :id), 0) AS adjustment_total
            FROM rental.rent_ledger rl WHERE rl.ledger_id = :id
        """), {"id": ledger_id}).mappings().fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Ledger entry not found")

        net_due   = float(row["amount_due"]) + float(row["adjustment_total"])
        new_total = float(row["already_paid"]) + body.amount
        new_status = "paid" if new_total >= net_due else "partial"

        # Build notes string in Python to avoid duplicate named params in SQL
        existing_notes = conn.execute(sql(
            "SELECT notes FROM rental.rent_ledger WHERE ledger_id = :id"
        ), {"id": ledger_id}).scalar()

        if body.notes:
            new_notes = f"{existing_notes} | {body.notes}" if existing_notes else body.notes
        else:
            new_notes = existing_notes

        conn.execute(sql("""
            UPDATE rental.rent_ledger
            SET amount_paid         = :total,
                paid_date           = :paid_date,
                payment_method_code = COALESCE(:method, payment_method_code),
                status              = :status,
                notes               = :notes
            WHERE ledger_id = :id
        """), {
            "total":     new_total,
            "paid_date": body.paid_date,
            "method":    body.payment_method_code,
            "status":    new_status,
            "notes":     new_notes,
            "id":        ledger_id,
        })

        # Record individual instalment in transaction history
        conn.execute(sql("""
            INSERT INTO rental.payment_transactions
                (ledger_id, amount, paid_date, payment_method_code, notes, org_id)
            VALUES (:ledger_id, :amount, :paid_date, :method, :notes, :org_id)
        """), {
            "ledger_id": ledger_id,
            "amount":    body.amount,
            "paid_date": body.paid_date,
            "method":    body.payment_method_code,
            "notes":     body.notes,
            "org_id":    org_id,
        })
        conn.commit()
    return {"ledger_id": ledger_id, "total_paid": new_total, "status": new_status}


@app.get("/api/v1/rental/ledger/{ledger_id}/transactions")
def get_payment_transactions(ledger_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT pt.transaction_id, pt.amount, pt.paid_date,
                   pt.payment_method_code, pm.label AS payment_method_label,
                   pt.notes, pt.created_at
            FROM rental.payment_transactions pt
            LEFT JOIN rental.ref_payment_methods pm ON pm.code = pt.payment_method_code
            WHERE pt.ledger_id = :ledger_id
            ORDER BY pt.paid_date, pt.created_at
        """), {"ledger_id": ledger_id}).mappings().all()
    return [dict(r) for r in rows]

@app.get("/api/v1/rental/rent-roll")
def get_rent_roll(month: str, org_id: int = Depends(get_org_id)):
    """Return all active lease members with their ledger status for a given YYYY-MM.
    If no ledger row exists for a member, returns a virtual 'not generated' row.
    This drives the rent roll view — one row per tenant per month."""
    year, mon = int(month.split("-")[0]), int(month.split("-")[1])
    due_date = date(year, mon, 1)

    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT
                t.tenant_id,
                t.first_name || ' ' || t.last_name AS tenant_name,
                lm.monthly_obligation,
                lm.is_primary,
                lm.member_type,
                l.lease_id,
                l.start_date,
                l.end_date,
                rs.space_name,
                u.unit_number,
                p.address,
                p.property_id,
                -- Ledger row if it exists for this month
                rl.ledger_id,
                rl.amount_due,
                rl.amount_paid,
                rl.paid_date,
                rl.status        AS payment_status,
                rl.promised_date,
                rl.promised_amount,
                pm.label         AS payment_method_label,
                rl.notes         AS payment_notes,
                COALESCE(ra.adjustment_total, 0) AS adjustment_total
            FROM rental.lease_members lm
            JOIN rental.leases l       ON l.lease_id   = lm.lease_id
            JOIN rental.tenants t      ON t.tenant_id  = lm.tenant_id
            JOIN rental.rentable_spaces rs ON rs.space_id = l.space_id
            JOIN rental.units u        ON u.unit_id    = rs.unit_id
            JOIN rental.properties p   ON p.property_id = u.property_id
            LEFT JOIN rental.rent_ledger rl
                ON rl.lease_id  = l.lease_id
               AND rl.tenant_id = lm.tenant_id
               AND DATE_TRUNC('month', rl.due_date) = :month_start
            LEFT JOIN rental.ref_payment_methods pm ON pm.code = rl.payment_method_code
            LEFT JOIN (
                SELECT ledger_id, SUM(amount) AS adjustment_total
                FROM rental.rent_adjustments
                GROUP BY ledger_id
            ) ra ON ra.ledger_id = rl.ledger_id
            WHERE (l.status_code IN (1, 2) OR l.status = 'active')
              AND l.start_date <= :due_date
              AND (l.end_date IS NULL OR l.end_date >= :due_date)
              AND lm.monthly_obligation > 0
            ORDER BY p.address, u.unit_number, rs.space_name, t.last_name
        """), {"month_start": due_date, "due_date": due_date}).mappings().all()

    return [dict(r) for r in rows]


@app.post("/api/v1/rental/ledger/generate-month")
def generate_month_ledger(month: str, org_id: int = Depends(get_org_id)):
    """Generate rent_ledger rows for all active lease members for a given YYYY-MM."""
    year, mon = int(month.split("-")[0]), int(month.split("-")[1])
    due_date = date(year, mon, 1)
    with get_connection_for_org(org_id) as conn:
        members = conn.execute(sql("""
            SELECT lm.lease_id, lm.tenant_id, lm.monthly_obligation
            FROM rental.lease_members lm
            JOIN rental.leases l ON l.lease_id = lm.lease_id
            WHERE l.status = 'active'
              AND l.start_date <= :due_date
              AND (l.end_date IS NULL OR l.end_date >= :due_date)
        """), {"due_date": due_date}).mappings().all()

        created = 0
        for m in members:
            exists = conn.execute(sql("""
                SELECT 1 FROM rental.rent_ledger
                WHERE lease_id = :lease_id AND tenant_id = :tenant_id AND due_date = :due_date
            """), {"lease_id": m["lease_id"], "tenant_id": m["tenant_id"], "due_date": due_date}).fetchone()
            if not exists:
                conn.execute(sql("""
                    INSERT INTO rental.rent_ledger (lease_id, tenant_id, due_date, amount_due, status, org_id)
                    VALUES (:lease_id, :tenant_id, :due_date, :amount_due, 'pending', :org_id)
                """), {"lease_id": m["lease_id"], "tenant_id": m["tenant_id"],
                       "due_date": due_date, "amount_due": m["monthly_obligation"], "org_id": org_id})
                created += 1
        conn.commit()
    return {"month": month, "created": created}


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/api/v1/rental/dashboard")
def get_rental_dashboard(org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        properties_total = conn.execute(sql("SELECT COUNT(*) FROM rental.properties")).scalar()
        plan = conn.execute(sql(
            "SELECT plan_tier, property_limit FROM rental.organisations WHERE org_id = :org_id"
        ), {"org_id": org_id}).mappings().fetchone() or {"plan_tier": "free", "property_limit": 1}

        spaces_total = conn.execute(sql("SELECT COUNT(*) FROM rental.rentable_spaces")).scalar()
        spaces_occupied = conn.execute(sql(
            "SELECT COUNT(DISTINCT space_id) FROM rental.leases WHERE status = 'active'"
        )).scalar()

        rent_collected = conn.execute(sql("""
            SELECT COALESCE(SUM(amount_paid), 0)
            FROM rental.rent_ledger
            WHERE DATE_TRUNC('month', due_date) = DATE_TRUNC('month', CURRENT_DATE)
              AND status IN ('paid', 'partial')
        """)).scalar()

        rent_expected = conn.execute(sql("""
            SELECT COALESCE(SUM(amount_due), 0)
            FROM rental.rent_ledger
            WHERE DATE_TRUNC('month', due_date) = DATE_TRUNC('month', CURRENT_DATE)
        """)).scalar()

        overdue_tasks = conn.execute(sql("""
            SELECT COUNT(*) FROM rental.maintenance_tasks
            WHERE next_due_date <= CURRENT_DATE AND status = 'active'
        """)).scalar()

        open_requests = conn.execute(sql("""
            SELECT COUNT(*) FROM rental.maintenance_requests
            WHERE status IN ('open', 'in_progress')
        """)).scalar()

        open_lease_tasks = conn.execute(sql("""
            SELECT COUNT(*) FROM rental.lease_tasks WHERE status = 'open'
        """)).scalar()

        promised = conn.execute(sql("""
            SELECT COUNT(*) AS cnt,
                   COALESCE(SUM(amount_due - COALESCE(amount_paid, 0)), 0) AS outstanding
            FROM rental.rent_ledger WHERE status = 'promised'
        """)).mappings().fetchone() or {"cnt": 0, "outstanding": 0}

        late = conn.execute(sql("""
            SELECT COUNT(*) FROM rental.rent_ledger
            WHERE status = 'pending' AND due_date < CURRENT_DATE
        """)).scalar()

        outstanding_payments = conn.execute(sql("""
            SELECT COUNT(*) FROM rental.rent_ledger
            WHERE amount_due > COALESCE(amount_paid, 0)
              AND status NOT IN ('waived')
        """)).scalar()

        active_tenants = conn.execute(sql("""
            SELECT COUNT(DISTINCT lm.tenant_id)
            FROM rental.lease_members lm
            JOIN rental.leases l ON l.lease_id = lm.lease_id
            WHERE l.status_code IN (1, 2)
               OR l.status = 'active'
        """)).scalar()

    return {
        "spaces_total":              spaces_total,
        "spaces_occupied":           spaces_occupied,
        "occupancy_rate":            round(spaces_occupied / spaces_total * 100, 1) if spaces_total else 0,
        "rent_collected_this_month": float(rent_collected or 0),
        "rent_expected_this_month":  float(rent_expected or 0),
        "overdue_maintenance_tasks": overdue_tasks,
        "open_maintenance_requests": open_requests,
        "open_lease_tasks":          open_lease_tasks,
        "outstanding_payment_count":  outstanding_payments,
        "promised_payment_count":    promised["cnt"],
        "promised_payment_outstanding": float(promised["outstanding"] or 0),
        "late_payment_count":        late,
        "active_tenant_count":       active_tenants,
        "properties_total":          properties_total,
        "plan_tier":                 plan["plan_tier"],
        "property_limit":            plan["property_limit"],
    }


# ── Vendors ───────────────────────────────────────────────────────────────────

class VendorBody(BaseModel):
    company_name: str
    contact_name: Optional[str] = None
    phone:        Optional[str] = None
    email:        Optional[str] = None
    trade:        Optional[str] = None
    notes:        Optional[str] = None

class VendorUpdate(BaseModel):
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    phone:        Optional[str] = None
    email:        Optional[str] = None
    trade:        Optional[str] = None
    notes:        Optional[str] = None

@app.get("/api/v1/rental/vendors")
def get_vendors(org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT v.vendor_id, v.company_name, v.contact_name, v.phone, v.email, v.trade, v.notes,
                   COALESCE(SUM(e.amount), 0) AS total_paid,
                   COUNT(e.expense_id) AS invoice_count
            FROM rental.vendors v
            LEFT JOIN rental.expenses e ON e.vendor_id = v.vendor_id
            GROUP BY v.vendor_id
            ORDER BY v.company_name
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/vendors", status_code=201)
def create_vendor(body: VendorBody, org_id: int = Depends(get_org_id)):
    data = body.model_dump()
    data["phone"] = clean_phone(data.get("phone"))
    data["org_id"] = org_id
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.vendors (company_name, contact_name, phone, email, trade, notes, org_id)
            VALUES (:company_name, :contact_name, :phone, :email, :trade, :notes, :org_id)
            RETURNING vendor_id
        """), data)
        vid = result.fetchone()[0]
        conn.commit()
    return {"vendor_id": vid}

@app.patch("/api/v1/rental/vendors/{vendor_id}")
def update_vendor(vendor_id: int, body: VendorUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "phone" in fields:
        fields["phone"] = clean_phone(fields["phone"])
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["vendor_id"] = vendor_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.vendors SET {set_clause} WHERE vendor_id = :vendor_id"), fields)
        conn.commit()
    return {"updated": vendor_id}


# ── Maintenance Tasks ─────────────────────────────────────────────────────────

class MaintenanceTaskBody(BaseModel):
    task_name:      str
    category:       Optional[str]  = None
    description:    Optional[str]  = None
    frequency_days: Optional[int]  = None
    next_due_date:  Optional[date] = None
    property_id:    Optional[int]  = None
    unit_id:        Optional[int]  = None
    category_id:    Optional[int]  = None

class MaintenanceTaskUpdate(BaseModel):
    task_name:      Optional[str]  = None
    category:       Optional[str]  = None
    description:    Optional[str]  = None
    frequency_days: Optional[int]  = None
    next_due_date:  Optional[date] = None
    status:         Optional[str]  = None
    category_id:    Optional[int]  = None

class TaskCompletionBody(BaseModel):
    completed_date:         date
    vendor_id:              Optional[int] = None
    completed_by:           Optional[str] = None
    completed_by_person_id: Optional[int] = None
    notes:                  Optional[str] = None

@app.get("/api/v1/rental/maintenance/tasks")
def get_maintenance_tasks(overdue_only: bool = False, org_id: int = Depends(get_org_id)):
    where = "WHERE mt.next_due_date <= CURRENT_DATE AND mt.status = 'active'" if overdue_only else ""
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql(f"""
            SELECT mt.task_id, mt.task_name, mt.category, mt.description,
                   mt.frequency_days, mt.last_completed_date, mt.next_due_date, mt.status,
                   mt.category_id, mc.name AS category_name,
                   p.address AS property_address, u.unit_number,
                   (mt.next_due_date - CURRENT_DATE)::int AS days_until_due
            FROM rental.maintenance_tasks mt
            LEFT JOIN rental.ref_maintenance_categories mc ON mc.category_id = mt.category_id
            LEFT JOIN rental.properties p ON p.property_id = mt.property_id
            LEFT JOIN rental.units u ON u.unit_id = mt.unit_id
            {where}
            ORDER BY mt.next_due_date ASC
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/maintenance/tasks", status_code=201)
def create_maintenance_task(body: MaintenanceTaskBody, org_id: int = Depends(get_org_id)):
    if not body.property_id and not body.unit_id:
        raise HTTPException(status_code=400, detail="Either property_id or unit_id is required.")
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.maintenance_tasks
                (task_name, category, description, frequency_days, next_due_date, property_id, unit_id, category_id, org_id)
            VALUES (:task_name, :category, :description, :frequency_days, :next_due_date, :property_id, :unit_id, :category_id, :org_id)
            RETURNING task_id
        """), {**body.model_dump(), "org_id": org_id})
        tid = result.fetchone()[0]
        conn.commit()
    return {"task_id": tid}

@app.delete("/api/v1/rental/maintenance/tasks/{task_id}", status_code=204)
def delete_maintenance_task(task_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.maintenance_records WHERE task_id = :task_id"), {"task_id": task_id})
        conn.execute(sql("DELETE FROM rental.maintenance_tasks WHERE task_id = :task_id AND org_id = :org_id"), {"task_id": task_id, "org_id": org_id})
        conn.commit()

@app.patch("/api/v1/rental/maintenance/tasks/{task_id}")
def update_maintenance_task(task_id: int, body: MaintenanceTaskUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["task_id"] = task_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.maintenance_tasks SET {set_clause} WHERE task_id = :task_id"), fields)
        conn.commit()
    return {"updated": task_id}

@app.get("/api/v1/rental/maintenance/tasks/{task_id}/records")
def get_task_records(task_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT mr.record_id, mr.completed_date, mr.completed_by, mr.notes,
                   v.company_name AS vendor_name,
                   ap.first_name || ' ' || ap.last_name AS person_name, ap.role AS person_role
            FROM rental.maintenance_records mr
            LEFT JOIN rental.vendors v ON v.vendor_id = mr.vendor_id
            LEFT JOIN rental.authorized_persons ap ON ap.person_id = mr.completed_by_person_id
            WHERE mr.task_id = :task_id
            ORDER BY mr.completed_date DESC
        """), {"task_id": task_id}).mappings().all()
    return [dict(r) for r in rows]


@app.post("/api/v1/rental/maintenance/tasks/{task_id}/complete")
def complete_task(task_id: int, body: TaskCompletionBody, org_id: int = Depends(get_org_id)):
    from datetime import timedelta
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.maintenance_records
                (task_id, vendor_id, completed_date, completed_by, completed_by_person_id, notes, org_id)
            VALUES
                (:task_id, :vendor_id, :completed_date, :completed_by, :completed_by_person_id, :notes, :org_id)
            RETURNING record_id
        """), {
            "task_id":                task_id,
            "vendor_id":              body.vendor_id,
            "completed_date":         body.completed_date,
            "completed_by":           body.completed_by,
            "completed_by_person_id": body.completed_by_person_id,
            "notes":                  body.notes,
            "org_id":                 org_id,
        })
        record_id = result.fetchone()[0]

        # Fetch frequency_days first, then compute next_due_date in Python
        freq = conn.execute(sql(
            "SELECT frequency_days FROM rental.maintenance_tasks WHERE task_id = :id"
        ), {"id": task_id}).scalar()

        next_due = body.completed_date + timedelta(days=freq) if freq else body.completed_date

        conn.execute(sql("""
            UPDATE rental.maintenance_tasks
            SET last_completed_date = :completed_date,
                next_due_date       = :next_due
            WHERE task_id = :task_id
        """), {
            "completed_date": body.completed_date,
            "next_due":       next_due,
            "task_id":        task_id,
        })
        conn.commit()
    return {"record_id": record_id}


# ── Maintenance Requests ──────────────────────────────────────────────────────

class MaintenanceRequestBody(BaseModel):
    unit_id:                   int
    description:               str
    priority:                  Optional[str]  = "normal"
    tenant_id:                 Optional[int]  = None
    vendor_id:                 Optional[int]  = None
    estimated_completion_date: Optional[date] = None
    notes:                     Optional[str]  = None

class MaintenanceRequestUpdate(BaseModel):
    status:                    Optional[str]  = None
    vendor_id:                 Optional[int]  = None
    priority:                  Optional[str]  = None
    estimated_completion_date: Optional[date] = None
    actual_completion_date:    Optional[date] = None
    notes:                     Optional[str]  = None

@app.get("/api/v1/rental/maintenance/requests")
def get_maintenance_requests(status: Optional[str] = None, org_id: int = Depends(get_org_id)):
    where = "WHERE mr.status = :status" if status else ""
    params = {"status": status} if status else {}
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql(f"""
            SELECT mr.request_id, mr.reported_date, mr.description, mr.priority, mr.status,
                   mr.estimated_completion_date, mr.actual_completion_date, mr.notes,
                   p.address AS property_address, u.unit_number,
                   t.first_name || ' ' || t.last_name AS reported_by,
                   v.company_name AS assigned_vendor
            FROM rental.maintenance_requests mr
            JOIN rental.units u ON u.unit_id = mr.unit_id
            JOIN rental.properties p ON p.property_id = u.property_id
            LEFT JOIN rental.tenants t ON t.tenant_id = mr.tenant_id
            LEFT JOIN rental.vendors v ON v.vendor_id = mr.vendor_id
            {where}
            ORDER BY CASE mr.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2
                     WHEN 'normal' THEN 3 ELSE 4 END, mr.reported_date DESC
        """), params).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/maintenance/requests", status_code=201)
def create_maintenance_request(body: MaintenanceRequestBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.maintenance_requests
                (unit_id, description, priority, tenant_id, vendor_id, estimated_completion_date, notes, org_id)
            VALUES (:unit_id, :description, :priority, :tenant_id, :vendor_id, :estimated_completion_date, :notes, :org_id)
            RETURNING request_id
        """), {**body.model_dump(), "org_id": org_id})
        rid = result.fetchone()[0]
        conn.commit()
    return {"request_id": rid}

@app.patch("/api/v1/rental/maintenance/requests/{request_id}")
def update_maintenance_request(request_id: int, body: MaintenanceRequestUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["request_id"] = request_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.maintenance_requests SET {set_clause} WHERE request_id = :request_id"), fields)
        conn.commit()
    return {"updated": request_id}


# ── Expenses ──────────────────────────────────────────────────────────────────

class ExpenseBody(BaseModel):
    property_id:     Optional[int]   = None
    expense_date:    date
    expense_type:    Optional[str]   = None   # legacy free-text, kept for backwards compat
    expense_type_id: Optional[int]  = None    # preferred — FK to ref_expense_types
    amount:          float
    receipt_number:  Optional[str]   = None
    drive_url:       Optional[str]   = None
    notes:           Optional[str]   = None
    vendor_id:       Optional[int]   = None
    invoice_id:      Optional[int]   = None

class ExpenseUpdate(BaseModel):
    property_id:    Optional[int]   = None
    expense_date:   Optional[date]  = None
    expense_type:   Optional[str]   = None
    amount:         Optional[float] = None
    receipt_number: Optional[str]   = None
    drive_url:      Optional[str]   = None
    notes:          Optional[str]   = None
    expense_type_id: Optional[int]  = None
    vendor_id:      Optional[int]   = None
    invoice_id:     Optional[int]   = None

@app.get("/api/v1/rental/expenses")
def get_expenses(property_id: Optional[int] = None, expense_type: Optional[str] = None,
                 year: Optional[int] = None, month: Optional[int] = None,
                 org_id: int = Depends(get_org_id)):
    filters, params = [], {}
    if property_id:
        filters.append("e.property_id = :property_id"); params["property_id"] = property_id
    if expense_type:
        filters.append("e.expense_type = :expense_type"); params["expense_type"] = expense_type
    if year:
        filters.append("EXTRACT(YEAR FROM e.expense_date) = :year"); params["year"] = year
    if month:
        filters.append("EXTRACT(MONTH FROM e.expense_date) = :month"); params["month"] = month
    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql(f"""
            SELECT e.expense_id, e.expense_date, e.expense_type, e.amount,
                   e.receipt_number, e.drive_url, e.notes, e.expense_type_id, e.vendor_id, e.invoice_id,
                   COALESCE(et.name, e.expense_type) AS type_name,
                   p.address AS property_address,
                   v.company_name AS vendor_name
            FROM rental.expenses e
            LEFT JOIN rental.ref_expense_types et ON et.type_id = e.expense_type_id
            LEFT JOIN rental.properties p ON p.property_id = e.property_id
            LEFT JOIN rental.vendors v ON v.vendor_id = e.vendor_id
            {where}
            ORDER BY e.expense_date DESC
        """), params).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/expenses", status_code=201)
def create_expense(body: ExpenseBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.expenses
                (property_id, expense_date, expense_type, expense_type_id,
                 amount, receipt_number, drive_url, notes, vendor_id, invoice_id, org_id)
            VALUES (:property_id, :expense_date, :expense_type, :expense_type_id,
                    :amount, :receipt_number, :drive_url, :notes, :vendor_id, :invoice_id, :org_id)
            RETURNING expense_id
        """), {
            "property_id":     body.property_id,
            "expense_date":    body.expense_date,
            "expense_type":    body.expense_type,
            "expense_type_id": body.expense_type_id,
            "amount":          body.amount,
            "receipt_number":  body.receipt_number,
            "drive_url":       body.drive_url,
            "notes":           body.notes,
            "vendor_id":       body.vendor_id,
            "invoice_id":      body.invoice_id,
            "org_id":          org_id,
        })
        eid = result.fetchone()[0]
        conn.commit()
    return {"expense_id": eid}

@app.patch("/api/v1/rental/expenses/{expense_id}")
def update_expense(expense_id: int, body: ExpenseUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["expense_id"] = expense_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.expenses SET {set_clause} WHERE expense_id = :expense_id"), fields)
        conn.commit()
    return {"updated": expense_id}

@app.delete("/api/v1/rental/expenses/{expense_id}", status_code=204)
def delete_expense(expense_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.expenses WHERE expense_id = :id"), {"id": expense_id})
        conn.commit()

# ── Fixed Costs ───────────────────────────────────────────────────────────────

class FixedCostBody(BaseModel):
    name:            str
    expense_type_id: Optional[int]  = None
    property_id:     Optional[int]  = None
    vendor_id:       Optional[int]  = None
    amount:          float
    frequency:       str            = "monthly"
    start_date:      date
    notes:           Optional[str]  = None

class FixedCostUpdate(BaseModel):
    name:            Optional[str]   = None
    expense_type_id: Optional[int]   = None
    property_id:     Optional[int]   = None
    vendor_id:       Optional[int]   = None
    amount:          Optional[float] = None
    frequency:       Optional[str]   = None
    start_date:      Optional[date]  = None
    notes:           Optional[str]   = None
    active:          Optional[bool]  = None

@app.get("/api/v1/rental/fixed-costs")
def get_fixed_costs(org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT fc.fixed_cost_id, fc.name, fc.amount, fc.frequency, fc.start_date,
                   fc.notes, fc.active,
                   fc.property_id, p.address AS property_address,
                   fc.expense_type_id, et.name AS expense_type_name,
                   fc.vendor_id, v.company_name AS vendor_name
            FROM rental.fixed_costs fc
            LEFT JOIN rental.properties p ON p.property_id = fc.property_id
            LEFT JOIN rental.ref_expense_types et ON et.type_id = fc.expense_type_id
            LEFT JOIN rental.vendors v ON v.vendor_id = fc.vendor_id
            WHERE fc.org_id = :org_id
            ORDER BY fc.name
        """), {"org_id": org_id}).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/fixed-costs", status_code=201)
def create_fixed_cost(body: FixedCostBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.fixed_costs
                (name, expense_type_id, property_id, vendor_id, amount, frequency, start_date, notes, org_id)
            VALUES
                (:name, :expense_type_id, :property_id, :vendor_id, :amount, :frequency, :start_date, :notes, :org_id)
            RETURNING fixed_cost_id
        """), {**body.model_dump(), "org_id": org_id})
        fid = result.fetchone()[0]
        conn.commit()
    return {"fixed_cost_id": fid}

@app.patch("/api/v1/rental/fixed-costs/{fixed_cost_id}")
def update_fixed_cost(fixed_cost_id: int, body: FixedCostUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["fixed_cost_id"] = fixed_cost_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.fixed_costs SET {set_clause} WHERE fixed_cost_id = :fixed_cost_id AND org_id = :org_id"),
                     {**fields, "org_id": org_id})
        conn.commit()
    return {"updated": fixed_cost_id}

@app.delete("/api/v1/rental/fixed-costs/{fixed_cost_id}", status_code=204)
def delete_fixed_cost(fixed_cost_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.fixed_costs WHERE fixed_cost_id = :id AND org_id = :org_id"),
                     {"id": fixed_cost_id, "org_id": org_id})
        conn.commit()

@app.post("/api/v1/rental/fixed-costs/generate")
def generate_fixed_costs(month: str, org_id: int = Depends(get_org_id)):
    """Generate expense rows for all active fixed costs for the given month (YYYY-MM).
    Skips any that already have an expense entry for that month to prevent duplicates."""
    try:
        month_date = date.fromisoformat(month + "-01")
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")

    with get_connection_for_org(org_id) as conn:
        costs = conn.execute(sql("""
            SELECT fc.fixed_cost_id, fc.name, fc.expense_type_id, fc.property_id,
                   fc.vendor_id, fc.amount, fc.frequency, fc.start_date
            FROM rental.fixed_costs fc
            WHERE fc.org_id = :org_id AND fc.active = TRUE
        """), {"org_id": org_id}).mappings().all()

        created = 0
        for fc in costs:
            start = fc["start_date"]
            if isinstance(start, str):
                start = date.fromisoformat(start)

            # Annual costs: only generate in their start month
            if fc["frequency"] == "annual" and start.month != month_date.month:
                continue
            # Skip if cost started after this month
            if start > month_date.replace(day=28):
                continue

            expense_date = month_date  # 1st of the month

            # Check for duplicate
            existing = conn.execute(sql("""
                SELECT 1 FROM rental.expenses
                WHERE org_id = :org_id
                  AND property_id IS NOT DISTINCT FROM :property_id
                  AND expense_type_id IS NOT DISTINCT FROM :expense_type_id
                  AND notes = :notes
                  AND EXTRACT(YEAR  FROM expense_date) = :yr
                  AND EXTRACT(MONTH FROM expense_date) = :mo
            """), {
                "org_id": org_id,
                "property_id": fc["property_id"],
                "expense_type_id": fc["expense_type_id"],
                "notes": f"[Fixed] {fc['name']}",
                "yr": month_date.year,
                "mo": month_date.month,
            }).fetchone()

            if existing:
                continue

            conn.execute(sql("""
                INSERT INTO rental.expenses
                    (property_id, expense_date, expense_type_id, vendor_id, amount, notes, org_id)
                VALUES
                    (:property_id, :expense_date, :expense_type_id, :vendor_id, :amount, :notes, :org_id)
            """), {
                "property_id":     fc["property_id"],
                "expense_date":    expense_date,
                "expense_type_id": fc["expense_type_id"],
                "vendor_id":       fc["vendor_id"],
                "amount":          fc["amount"],
                "notes":           f"[Fixed] {fc['name']}",
                "org_id":          org_id,
            })
            created += 1

        conn.commit()
    return {"created": created, "month": month}


@app.get("/api/v1/rental/expenses/summary")
def get_expense_summary(year: Optional[int] = None, month: Optional[int] = None,
                        property_id: Optional[int] = None, expense_type_id: Optional[int] = None,
                        org_id: int = Depends(get_org_id)):
    filters, params = [], {}
    if year:
        filters.append("EXTRACT(YEAR FROM e.expense_date) = :year")
        params["year"] = year
    if month:
        filters.append("EXTRACT(MONTH FROM e.expense_date) = :month")
        params["month"] = month
    if property_id:
        filters.append("e.property_id = :property_id")
        params["property_id"] = property_id
    if expense_type_id:
        filters.append("e.expense_type_id = :expense_type_id")
        params["expense_type_id"] = expense_type_id
    where = ("WHERE " + " AND ".join(filters)) if filters else ""
    with get_connection_for_org(org_id) as conn:
        by_type = conn.execute(sql(f"""
            SELECT COALESCE(et.name, e.expense_type, 'Other') AS expense_type,
                   COALESCE(SUM(e.amount), 0) AS total
            FROM rental.expenses e
            LEFT JOIN rental.ref_expense_types et ON et.type_id = e.expense_type_id
            {where}
            GROUP BY COALESCE(et.name, e.expense_type, 'Other')
            ORDER BY total DESC
        """), params).mappings().all()
        by_property = conn.execute(sql(f"""
            SELECT COALESCE(p.address, 'General') AS property, COALESCE(SUM(e.amount), 0) AS total
            FROM rental.expenses e
            LEFT JOIN rental.properties p ON p.property_id = e.property_id
            {where}
            GROUP BY p.address ORDER BY total DESC
        """), params).mappings().all()
        total = conn.execute(sql(f"""
            SELECT COALESCE(SUM(e.amount), 0) FROM rental.expenses e {where}
        """), params).scalar()
    return {
        "total": float(total),
        "by_type": [dict(r) for r in by_type],
        "by_property": [dict(r) for r in by_property],
    }


# ── Reference Tables (Read-Only) ──────────────────────────────────────────────

@app.get("/api/v1/rental/ref/provinces")
def get_provinces():
    """Get all provinces from ref_provinces, ordered by country and name."""
    with get_connection() as conn:
        rows = conn.execute(sql("""
            SELECT code, name, country
            FROM rental.ref_provinces
            ORDER BY country, name
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.get("/api/v1/rental/ref/payment-methods")
def get_payment_methods():
    """Get all payment methods from ref_payment_methods."""
    with get_connection() as conn:
        rows = conn.execute(sql("""
            SELECT code, label
            FROM rental.ref_payment_methods
            ORDER BY label
        """)).mappings().all()
    return [dict(r) for r in rows]

class RefNameBody(BaseModel):
    name: str

@app.get("/api/v1/rental/ref/maintenance-categories")
def get_maintenance_categories(org_id: int = Depends(get_org_id)):
    """Get this org's maintenance categories from ref_maintenance_categories."""
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT category_id, name
            FROM rental.ref_maintenance_categories
            ORDER BY name
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/ref/maintenance-categories", status_code=201)
def create_maintenance_category(body: RefNameBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        try:
            result = conn.execute(sql("""
                INSERT INTO rental.ref_maintenance_categories (name, org_id)
                VALUES (:name, :org_id)
                RETURNING category_id
            """), {"name": body.name, "org_id": org_id})
            cid = result.fetchone()[0]
            conn.commit()
        except Exception:
            raise HTTPException(status_code=409, detail="That category already exists")
    return {"category_id": cid}

@app.delete("/api/v1/rental/ref/maintenance-categories/{category_id}", status_code=204)
def delete_maintenance_category(category_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        in_use = conn.execute(sql(
            "SELECT COUNT(*) FROM rental.maintenance_tasks WHERE category_id = :id"
        ), {"id": category_id}).scalar()
        if in_use:
            raise HTTPException(status_code=409, detail=(
                f"Still used by {in_use} maintenance task{'s' if in_use != 1 else ''}. "
                "Reassign them first."
            ))
        conn.execute(sql(
            "DELETE FROM rental.ref_maintenance_categories WHERE category_id = :id"
        ), {"id": category_id})
        conn.commit()

@app.patch("/api/v1/rental/ref/maintenance-categories/{category_id}")
def update_maintenance_category(category_id: int, body: RefNameBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        try:
            conn.execute(sql(
                "UPDATE rental.ref_maintenance_categories SET name = :name WHERE category_id = :id"
            ), {"name": body.name, "id": category_id})
            conn.commit()
        except Exception:
            raise HTTPException(status_code=409, detail="That category already exists")
    return {"updated": category_id}

@app.get("/api/v1/rental/ref/expense-types")
def get_expense_types(org_id: int = Depends(get_org_id)):
    """Get this org's expense types from ref_expense_types."""
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT type_id, name
            FROM rental.ref_expense_types
            ORDER BY name
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/ref/expense-types", status_code=201)
def create_expense_type(body: RefNameBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        try:
            result = conn.execute(sql("""
                INSERT INTO rental.ref_expense_types (name, org_id)
                VALUES (:name, :org_id)
                RETURNING type_id
            """), {"name": body.name, "org_id": org_id})
            tid = result.fetchone()[0]
            conn.commit()
        except Exception:
            raise HTTPException(status_code=409, detail="That expense type already exists")
    return {"type_id": tid}

@app.delete("/api/v1/rental/ref/expense-types/{type_id}", status_code=204)
def delete_expense_type(type_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        in_use = conn.execute(sql(
            "SELECT COUNT(*) FROM rental.expenses WHERE expense_type_id = :id"
        ), {"id": type_id}).scalar()
        if in_use:
            raise HTTPException(status_code=409, detail=(
                f"Still used by {in_use} expense{'s' if in_use != 1 else ''}. Reassign them first."
            ))
        conn.execute(sql(
            "DELETE FROM rental.ref_expense_types WHERE type_id = :id"
        ), {"id": type_id})
        conn.commit()

@app.patch("/api/v1/rental/ref/expense-types/{type_id}")
def update_expense_type(type_id: int, body: RefNameBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        try:
            conn.execute(sql(
                "UPDATE rental.ref_expense_types SET name = :name WHERE type_id = :id"
            ), {"name": body.name, "id": type_id})
            conn.commit()
        except Exception:
            raise HTTPException(status_code=409, detail="That expense type already exists")
    return {"updated": type_id}

@app.get("/api/v1/rental/ref/lease-statuses")
def get_lease_statuses():
    """Get all lease statuses from ref_lease_statuses."""
    with get_connection() as conn:
        rows = conn.execute(sql("""
            SELECT code, label
            FROM rental.ref_lease_statuses
            ORDER BY label
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.get("/api/v1/rental/ref/id-types")
def get_id_types():
    """Get all ID types from ref_id_types."""
    with get_connection() as conn:
        rows = conn.execute(sql("""
            SELECT type_id, name
            FROM rental.ref_id_types
            ORDER BY name
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.get("/api/v1/rental/ref/contact-methods")
def get_contact_methods():
    """Get all contact methods from ref_contact_methods."""
    with get_connection() as conn:
        rows = conn.execute(sql("""
            SELECT method_id, name
            FROM rental.ref_contact_methods
            ORDER BY name
        """)).mappings().all()
    return [dict(r) for r in rows]

class NoticeTypeBody(BaseModel):
    code: str
    description: str

@app.get("/api/v1/rental/ref/notice-types")
def get_notice_types(org_id: int = Depends(get_org_id)):
    """Get this org's notice types from ref_notice_types."""
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT notice_type_id, code, description
            FROM rental.ref_notice_types
            ORDER BY description
        """)).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/ref/notice-types", status_code=201)
def create_notice_type(body: NoticeTypeBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        try:
            result = conn.execute(sql("""
                INSERT INTO rental.ref_notice_types (code, description, org_id)
                VALUES (:code, :description, :org_id)
                RETURNING notice_type_id
            """), {"code": body.code, "description": body.description, "org_id": org_id})
            nid = result.fetchone()[0]
            conn.commit()
        except Exception:
            raise HTTPException(status_code=409, detail="That notice code already exists")
    return {"notice_type_id": nid}

@app.delete("/api/v1/rental/ref/notice-types/{notice_type_id}", status_code=204)
def delete_notice_type(notice_type_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        in_use = conn.execute(sql(
            "SELECT COUNT(*) FROM rental.legal_notices WHERE notice_type_id = :id"
        ), {"id": notice_type_id}).scalar()
        if in_use:
            raise HTTPException(status_code=409, detail=(
                f"Still used by {in_use} legal notice{'s' if in_use != 1 else ''}. Reassign them first."
            ))
        conn.execute(sql(
            "DELETE FROM rental.ref_notice_types WHERE notice_type_id = :id"
        ), {"id": notice_type_id})
        conn.commit()

@app.patch("/api/v1/rental/ref/notice-types/{notice_type_id}")
def update_notice_type(notice_type_id: int, body: NoticeTypeBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        try:
            conn.execute(sql(
                "UPDATE rental.ref_notice_types SET code = :code, description = :description WHERE notice_type_id = :id"
            ), {"code": body.code, "description": body.description, "id": notice_type_id})
            conn.commit()
        except Exception:
            raise HTTPException(status_code=409, detail="That notice code already exists")
    return {"updated": notice_type_id}

@app.get("/api/v1/rental/ref/service-methods")
def get_service_methods():
    """Get all service methods from ref_service_methods."""
    with get_connection() as conn:
        rows = conn.execute(sql("""
            SELECT method_id, name
            FROM rental.ref_service_methods
            ORDER BY name
        """)).mappings().all()
    return [dict(r) for r in rows]


# ── Tenant Contact History ────────────────────────────────────────────────────

class TenantContactHistoryBody(BaseModel):
    contact_type: str  # 'phone' or 'email'
    value: str
    effective_from: date
    notes: Optional[str] = None

class TenantContactHistoryUpdate(BaseModel):
    contact_type: Optional[str] = None
    value: Optional[str] = None
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    notes: Optional[str] = None

@app.get("/api/v1/rental/tenants/{tenant_id}/contact-history")
def get_tenant_contact_history(tenant_id: int, org_id: int = Depends(get_org_id)):
    """Get all contact history records for a tenant, ordered by effective_from DESC."""
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT history_id, tenant_id, contact_type, value, effective_from, effective_to, notes
            FROM rental.tenant_contact_history
            WHERE tenant_id = :tenant_id
            ORDER BY effective_from DESC
        """), {"tenant_id": tenant_id}).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/tenants/{tenant_id}/contact-history", status_code=201)
def create_tenant_contact_history(tenant_id: int, body: TenantContactHistoryBody, org_id: int = Depends(get_org_id)):
    """Create a new contact history record. Sets effective_to=today on existing records with same contact_type."""
    with get_connection_for_org(org_id) as conn:
        # Set effective_to = today on existing row with same contact_type where effective_to IS NULL
        conn.execute(sql("""
            UPDATE rental.tenant_contact_history
            SET effective_to = CURRENT_DATE
            WHERE tenant_id = :tenant_id AND contact_type = :contact_type AND effective_to IS NULL
        """), {"tenant_id": tenant_id, "contact_type": body.contact_type})

        # Clean phone digits before storing
        data = body.model_dump()
        if data.get("contact_type") == "phone":
            data["value"] = clean_phone(data["value"]) or data["value"]

        # Insert new record
        result = conn.execute(sql("""
            INSERT INTO rental.tenant_contact_history (tenant_id, contact_type, value, effective_from, notes, org_id)
            VALUES (:tenant_id, :contact_type, :value, :effective_from, :notes, :org_id)
            RETURNING history_id
        """), {"tenant_id": tenant_id, "org_id": org_id, **data})
        history_id = result.fetchone()[0]
        conn.commit()
    return {"history_id": history_id}


# ── Lease Tasks ───────────────────────────────────────────────────────────────

class LeaseTaskBody(BaseModel):
    lease_id: int
    task_type: str
    due_date: date
    notes: Optional[str] = None

class LeaseTaskUpdate(BaseModel):
    task_type: Optional[str] = None
    due_date: Optional[date] = None
    status: Optional[str] = None
    notes: Optional[str] = None

@app.get("/api/v1/rental/lease-tasks")
def get_lease_tasks(lease_id: Optional[int] = None, org_id: int = Depends(get_org_id)):
    """Get all open lease tasks, optionally filtered by lease_id."""
    filters, params = [], {}
    if lease_id:
        filters.append("lt.lease_id = :lease_id")
        params["lease_id"] = lease_id
    filters.append("lt.status = 'open'")
    where = "WHERE " + " AND ".join(filters)

    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql(f"""
            SELECT lt.task_id, lt.lease_id, lt.task_type, lt.due_date, lt.status, lt.notes,
                   l.space_id, rs.space_name, u.unit_number, p.address,
                   (lt.due_date - CURRENT_DATE)::int AS days_until_due
            FROM rental.lease_tasks lt
            JOIN rental.leases l ON l.lease_id = lt.lease_id
            JOIN rental.rentable_spaces rs ON rs.space_id = l.space_id
            JOIN rental.units u ON u.unit_id = rs.unit_id
            JOIN rental.properties p ON p.property_id = u.property_id
            {where}
            ORDER BY lt.due_date ASC
        """), params).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/lease-tasks", status_code=201)
def create_lease_task(body: LeaseTaskBody, org_id: int = Depends(get_org_id)):
    """Create a new lease task."""
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.lease_tasks (lease_id, task_type, due_date, notes, org_id)
            VALUES (:lease_id, :task_type, :due_date, :notes, :org_id)
            RETURNING task_id
        """), {**body.model_dump(), "org_id": org_id})
        task_id = result.fetchone()[0]
        conn.commit()
    return {"task_id": task_id}

@app.patch("/api/v1/rental/lease-tasks/{task_id}")
def update_lease_task(task_id: int, body: LeaseTaskUpdate, org_id: int = Depends(get_org_id)):
    """Update a lease task (status, notes, due_date, task_type)."""
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["task_id"] = task_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.lease_tasks SET {set_clause} WHERE task_id = :task_id"), fields)
        conn.commit()
    return {"updated": task_id}


# ── Legal Notices ─────────────────────────────────────────────────────────────

class LegalNoticeBody(BaseModel):
    lease_id:          int
    notice_type_id:    int
    notice_date:       date
    served_by:         str
    service_method_id: int
    compliance_date:   Optional[date] = None
    drive_url:         Optional[str]  = None
    notes:             Optional[str]  = None
    tenant_ids:        list[int]      = []

class LegalNoticeUpdate(BaseModel):
    served_by:         Optional[str]  = None
    service_method_id: Optional[int]  = None
    compliance_date:   Optional[date] = None
    drive_url:         Optional[str]  = None
    status:            Optional[str]  = None   # active, void, escalated
    notes:             Optional[str]  = None

@app.get("/api/v1/rental/legal-notices")
def get_legal_notices(lease_id: Optional[int] = None, org_id: int = Depends(get_org_id)):
    """Get all legal notices, optionally filtered by lease_id. Includes joins to ref tables and property info."""
    filters, params = [], {}
    if lease_id:
        filters.append("ln.lease_id = :lease_id")
        params["lease_id"] = lease_id
    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql(f"""
            SELECT ln.notice_id, ln.lease_id, ln.notice_type_id, ln.notice_date,
                   ln.served_by, ln.service_method_id, ln.drive_url, ln.notes,
                   ln.compliance_date, ln.status,
                   rnt.code AS notice_type_code, rnt.description AS notice_type_name,
                   rsm.name AS service_method_name,
                   l.space_id, rs.space_name, u.unit_number, p.address
            FROM rental.legal_notices ln
            LEFT JOIN rental.ref_notice_types rnt ON rnt.notice_type_id = ln.notice_type_id
            LEFT JOIN rental.ref_service_methods rsm ON rsm.method_id = ln.service_method_id
            JOIN rental.leases l ON l.lease_id = ln.lease_id
            JOIN rental.rentable_spaces rs ON rs.space_id = l.space_id
            JOIN rental.units u ON u.unit_id = rs.unit_id
            JOIN rental.properties p ON p.property_id = u.property_id
            {where}
            ORDER BY ln.notice_date DESC
        """), params).mappings().all()

        # Fetch recipients for each notice
        result = []
        for row in rows:
            notice = dict(row)
            recipients = conn.execute(sql("""
                SELECT t.first_name || ' ' || t.last_name AS name
                FROM rental.legal_notice_recipients lnr
                JOIN rental.tenants t ON t.tenant_id = lnr.tenant_id
                WHERE lnr.notice_id = :notice_id
                ORDER BY t.last_name
            """), {"notice_id": notice["notice_id"]}).mappings().all()
            notice["recipients"] = [r["name"] for r in recipients]
            result.append(notice)

    return result

@app.post("/api/v1/rental/legal-notices", status_code=201)
def create_legal_notice(body: LegalNoticeBody, org_id: int = Depends(get_org_id)):
    """Create a legal notice and its recipients in one operation."""
    with get_connection_for_org(org_id) as conn:
        # Insert notice
        result = conn.execute(sql("""
            INSERT INTO rental.legal_notices
                (lease_id, notice_type_id, notice_date, served_by, service_method_id,
                 compliance_date, drive_url, notes, org_id)
            VALUES
                (:lease_id, :notice_type_id, :notice_date, :served_by, :service_method_id,
                 :compliance_date, :drive_url, :notes, :org_id)
            RETURNING notice_id
        """), {
            "lease_id":          body.lease_id,
            "notice_type_id":    body.notice_type_id,
            "notice_date":       body.notice_date,
            "served_by":         body.served_by,
            "service_method_id": body.service_method_id,
            "compliance_date":   body.compliance_date,
            "drive_url":         body.drive_url,
            "notes":             body.notes,
            "org_id":            org_id,
        })
        notice_id = result.fetchone()[0]

        # Insert recipients
        for tenant_id in body.tenant_ids:
            conn.execute(sql("""
                INSERT INTO rental.legal_notice_recipients (notice_id, tenant_id, org_id)
                VALUES (:notice_id, :tenant_id, :org_id)
            """), {"notice_id": notice_id, "tenant_id": tenant_id, "org_id": org_id})

        conn.commit()
    return {"notice_id": notice_id, "recipients_count": len(body.tenant_ids)}

@app.patch("/api/v1/rental/legal-notices/{notice_id}")
def update_legal_notice(notice_id: int, body: LegalNoticeUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["notice_id"] = notice_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.legal_notices SET {set_clause} WHERE notice_id = :notice_id"), fields)

        # If compliance_date is being set and status is still active,
        # create an escalation lease_task due on the compliance_date
        if body.compliance_date and body.status != "void":
            notice = conn.execute(sql(
                "SELECT lease_id, status FROM rental.legal_notices WHERE notice_id = :id"
            ), {"id": notice_id}).mappings().fetchone()
            if notice and notice["status"] == "active":
                existing = conn.execute(sql("""
                    SELECT 1 FROM rental.lease_tasks
                    WHERE lease_id = :lid AND task_type = 'escalation'
                      AND notes LIKE :pattern AND status = 'open'
                """), {"lid": notice["lease_id"], "pattern": f"%notice_id={notice_id}%"}).fetchone()
                if not existing:
                    conn.execute(sql("""
                        INSERT INTO rental.lease_tasks (lease_id, task_type, due_date, status, notes, org_id)
                        VALUES (:lid, 'escalation', :due, 'open', :notes, :org_id)
                    """), {
                        "lid":   notice["lease_id"],
                        "due":   body.compliance_date,
                        "notes": f"Escalate if not complied — notice_id={notice_id}",
                        "org_id": org_id,
                    })

        conn.commit()
    return {"updated": notice_id}


@app.delete("/api/v1/rental/legal-notices/{notice_id}", status_code=204)
def delete_legal_notice(notice_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.legal_notices WHERE notice_id = :id"), {"id": notice_id})
        conn.commit()


# ─────────────────────────────────────────────────────────────────────────────
# AUTHORIZED PERSONS (Landlords / Property Managers)
# ─────────────────────────────────────────────────────────────────────────────

PERSON_ROLES = ["Landlord", "Property Manager", "Representative"]


class AuthorizedPersonBody(BaseModel):
    first_name: str
    last_name:  str
    role:       str = "Landlord"
    email:      Optional[str]  = None
    phone:      Optional[str]  = None
    is_default: bool           = False
    notes:      Optional[str]  = None


class AuthorizedPersonUpdate(BaseModel):
    first_name: Optional[str]  = None
    last_name:  Optional[str]  = None
    role:       Optional[str]  = None
    email:      Optional[str]  = None
    phone:      Optional[str]  = None
    is_default: Optional[bool] = None
    notes:      Optional[str]  = None


@app.get("/api/v1/rental/persons")
def get_persons(property_id: Optional[int] = None, org_id: int = Depends(get_org_id)):
    """Return authorized persons. If property_id given, return assigned + all defaults."""
    with get_connection_for_org(org_id) as conn:
        if property_id:
            rows = conn.execute(sql("""
                SELECT ap.person_id, ap.first_name, ap.last_name, ap.role,
                       ap.email, ap.phone, ap.is_default, ap.notes
                FROM rental.authorized_persons ap
                WHERE ap.is_default = TRUE
                   OR ap.person_id IN (
                       SELECT person_id FROM rental.property_persons
                       WHERE property_id = :property_id
                   )
                ORDER BY ap.last_name, ap.first_name
            """), {"property_id": property_id}).mappings().all()
        else:
            rows = conn.execute(sql("""
                SELECT ap.person_id, ap.first_name, ap.last_name, ap.role,
                       ap.email, ap.phone, ap.is_default, ap.notes,
                       ARRAY_AGG(pp.property_id) FILTER (WHERE pp.property_id IS NOT NULL) AS property_ids
                FROM rental.authorized_persons ap
                LEFT JOIN rental.property_persons pp ON pp.person_id = ap.person_id
                GROUP BY ap.person_id
                ORDER BY ap.last_name, ap.first_name
            """)).mappings().all()
    return [dict(r) for r in rows]


@app.post("/api/v1/rental/persons", status_code=201)
def create_person(body: AuthorizedPersonBody, org_id: int = Depends(get_org_id)):
    data = body.model_dump()
    data["phone"] = clean_phone(data.get("phone"))
    data["org_id"] = org_id
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.authorized_persons
                (first_name, last_name, role, email, phone, is_default, notes, org_id)
            VALUES (:first_name, :last_name, :role, :email, :phone, :is_default, :notes, :org_id)
            RETURNING person_id
        """), data)
        pid = result.fetchone()[0]
        conn.commit()
    return {"person_id": pid}


@app.patch("/api/v1/rental/persons/{person_id}")
def update_person(person_id: int, body: AuthorizedPersonUpdate, org_id: int = Depends(get_org_id)):
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    if "phone" in fields:
        fields["phone"] = clean_phone(fields["phone"])
    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    fields["person_id"] = person_id
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql(f"UPDATE rental.authorized_persons SET {set_clause} WHERE person_id = :person_id"), fields)
        conn.commit()
    return {"updated": person_id}


@app.delete("/api/v1/rental/persons/{person_id}", status_code=204)
def delete_person(person_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.authorized_persons WHERE person_id = :id"), {"id": person_id})
        conn.commit()


@app.post("/api/v1/rental/persons/{person_id}/assign/{property_id}", status_code=201)
def assign_person_to_property(person_id: int, property_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("""
            INSERT INTO rental.property_persons (property_id, person_id, org_id)
            VALUES (:property_id, :person_id, :org_id)
            ON CONFLICT DO NOTHING
        """), {"property_id": property_id, "person_id": person_id, "org_id": org_id})
        conn.commit()
    return {"assigned": True}


@app.delete("/api/v1/rental/persons/{person_id}/assign/{property_id}", status_code=204)
def unassign_person_from_property(person_id: int, property_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("""
            DELETE FROM rental.property_persons
            WHERE property_id = :property_id AND person_id = :person_id
        """), {"property_id": property_id, "person_id": person_id})
        conn.commit()


# ─── Tenant Deposits ──────────────────────────────────────────────────────────

class DepositBody(BaseModel):
    lease_id:  int
    tenant_id: int
    amount:    float
    paid_date: date
    notes:     Optional[str] = None

class DepositApply(BaseModel):
    ledger_id: int

@app.get("/api/v1/rental/deposits")
def get_deposits(tenant_id: Optional[int] = None, org_id: int = Depends(get_org_id)):
    filters, params = ["d.org_id = :org_id"], {"org_id": org_id}
    if tenant_id:
        filters.append("d.tenant_id = :tenant_id")
        params["tenant_id"] = tenant_id
    where = "WHERE " + " AND ".join(filters)
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql(f"""
            SELECT d.deposit_id, d.lease_id, d.tenant_id, d.amount, d.paid_date,
                   d.status, d.applied_ledger_id, d.notes, d.created_at,
                   t.first_name || ' ' || t.last_name AS tenant_name,
                   rs.space_name, u.unit_number, p.address,
                   rl.due_date AS applied_due_date
            FROM rental.tenant_deposits d
            JOIN rental.tenants t ON t.tenant_id = d.tenant_id
            JOIN rental.leases l ON l.lease_id = d.lease_id
            JOIN rental.rentable_spaces rs ON rs.space_id = l.space_id
            JOIN rental.units u ON u.unit_id = rs.unit_id
            JOIN rental.properties p ON p.property_id = u.property_id
            LEFT JOIN rental.rent_ledger rl ON rl.ledger_id = d.applied_ledger_id
            {where}
            ORDER BY d.paid_date DESC
        """), params).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/deposits", status_code=201)
def create_deposit(body: DepositBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.tenant_deposits (lease_id, tenant_id, amount, paid_date, notes, org_id)
            VALUES (:lease_id, :tenant_id, :amount, :paid_date, :notes, :org_id)
            RETURNING deposit_id
        """), {**body.model_dump(), "org_id": org_id})
        dep_id = result.fetchone()[0]
        conn.commit()
    return {"deposit_id": dep_id}

@app.patch("/api/v1/rental/deposits/{deposit_id}/apply")
def apply_deposit(deposit_id: int, body: DepositApply, org_id: int = Depends(get_org_id)):
    """Mark a deposit as applied and record the payment on the rent ledger entry."""
    with get_connection_for_org(org_id) as conn:
        # Get deposit details
        dep = conn.execute(sql(
            "SELECT amount, tenant_id FROM rental.tenant_deposits WHERE deposit_id = :id"
        ), {"id": deposit_id}).mappings().fetchone()
        if not dep:
            raise HTTPException(status_code=404, detail="Deposit not found")

        # Get ledger entry's current state
        ledger = conn.execute(sql("""
            SELECT rl.amount_due, COALESCE(rl.amount_paid, 0) AS already_paid,
                   COALESCE((SELECT SUM(amount) FROM rental.rent_adjustments WHERE ledger_id = :lid), 0) AS adjustment_total
            FROM rental.rent_ledger rl WHERE rl.ledger_id = :lid
        """), {"lid": body.ledger_id}).mappings().fetchone()
        if not ledger:
            raise HTTPException(status_code=404, detail="Ledger entry not found")

        dep_amount = float(dep["amount"])
        net_due    = float(ledger["amount_due"]) + float(ledger["adjustment_total"])
        new_total  = float(ledger["already_paid"]) + dep_amount
        new_status = "paid" if new_total >= net_due else "partial"

        # Mark deposit as applied
        conn.execute(sql("""
            UPDATE rental.tenant_deposits
            SET status = 'applied', applied_ledger_id = :ledger_id
            WHERE deposit_id = :deposit_id
        """), {"deposit_id": deposit_id, "ledger_id": body.ledger_id})

        # Record payment on the ledger
        conn.execute(sql("""
            UPDATE rental.rent_ledger
            SET amount_paid         = :total,
                paid_date           = CURRENT_DATE,
                payment_method_code = 'L',
                status              = :status
            WHERE ledger_id = :lid
        """), {"total": new_total, "status": new_status, "lid": body.ledger_id})

        # Insert transaction history entry
        conn.execute(sql("""
            INSERT INTO rental.payment_transactions
                (ledger_id, amount, paid_date, payment_method_code, notes, org_id)
            VALUES (:ledger_id, :amount, CURRENT_DATE, 'L', 'Last month deposit applied', :org_id)
        """), {"ledger_id": body.ledger_id, "amount": dep_amount, "org_id": org_id})

        conn.commit()
    return {"updated": deposit_id, "ledger_status": new_status}

@app.delete("/api/v1/rental/deposits/{deposit_id}", status_code=204)
def delete_deposit(deposit_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.tenant_deposits WHERE deposit_id = :id"), {"id": deposit_id})
        conn.commit()


# ─── Payment Promises ─────────────────────────────────────────────────────────

class PromiseBody(BaseModel):
    promised_date:   date
    promised_amount: float
    notes:           Optional[str] = None

@app.get("/api/v1/rental/ledger/{ledger_id}/promises")
def get_promises(ledger_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT promise_id, ledger_id, promised_date, promised_amount, notes, created_at
            FROM rental.payment_promises
            WHERE ledger_id = :ledger_id
            ORDER BY promised_date
        """), {"ledger_id": ledger_id}).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/ledger/{ledger_id}/promises", status_code=201)
def add_promise(ledger_id: int, body: PromiseBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.payment_promises (ledger_id, promised_date, promised_amount, notes, org_id)
            VALUES (:ledger_id, :promised_date, :promised_amount, :notes, :org_id)
            RETURNING promise_id
        """), {"ledger_id": ledger_id, **body.model_dump(), "org_id": org_id})
        pid = result.fetchone()[0]
        conn.execute(sql(
            "UPDATE rental.rent_ledger SET status = 'promised' WHERE ledger_id = :id"
        ), {"id": ledger_id})
        conn.commit()
    return {"promise_id": pid}

@app.delete("/api/v1/rental/promises/{promise_id}", status_code=204)
def delete_promise(promise_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        row = conn.execute(sql(
            "SELECT ledger_id FROM rental.payment_promises WHERE promise_id = :id"
        ), {"id": promise_id}).fetchone()
        if row:
            ledger_id = row[0]
            conn.execute(sql("DELETE FROM rental.payment_promises WHERE promise_id = :id"), {"id": promise_id})
            remaining = conn.execute(sql(
                "SELECT COUNT(*) FROM rental.payment_promises WHERE ledger_id = :id"
            ), {"id": ledger_id}).scalar()
            if remaining == 0:
                conn.execute(sql("""
                    UPDATE rental.rent_ledger SET status = 'pending'
                    WHERE ledger_id = :id AND status = 'promised'
                """), {"id": ledger_id})
            conn.commit()


# ─── Rent Adjustments ─────────────────────────────────────────────────────────

class AdjustmentBody(BaseModel):
    amount: float   # negative = discount, positive = surcharge
    reason: str

@app.get("/api/v1/rental/ledger/{ledger_id}/adjustments")
def get_adjustments(ledger_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        rows = conn.execute(sql("""
            SELECT adjustment_id, ledger_id, amount, reason, created_at
            FROM rental.rent_adjustments
            WHERE ledger_id = :ledger_id
            ORDER BY created_at
        """), {"ledger_id": ledger_id}).mappings().all()
    return [dict(r) for r in rows]

@app.post("/api/v1/rental/ledger/{ledger_id}/adjustments", status_code=201)
def add_adjustment(ledger_id: int, body: AdjustmentBody, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        result = conn.execute(sql("""
            INSERT INTO rental.rent_adjustments (ledger_id, amount, reason, org_id)
            VALUES (:ledger_id, :amount, :reason, :org_id)
            RETURNING adjustment_id
        """), {"ledger_id": ledger_id, "amount": body.amount, "reason": body.reason, "org_id": org_id})
        adj_id = result.fetchone()[0]
        conn.commit()
    return {"adjustment_id": adj_id}

@app.delete("/api/v1/rental/adjustments/{adjustment_id}", status_code=204)
def delete_adjustment(adjustment_id: int, org_id: int = Depends(get_org_id)):
    with get_connection_for_org(org_id) as conn:
        conn.execute(sql("DELETE FROM rental.rent_adjustments WHERE adjustment_id = :id"), {"id": adjustment_id})
        conn.commit()
