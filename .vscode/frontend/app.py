from dotenv import load_dotenv
load_dotenv()

import os
import requests
import streamlit as st
import pandas as pd
from datetime import date

API_URL = os.environ.get("ENDPOINT", "http://localhost:8000")

st.set_page_config(
    page_title="Rodin Property Management",
    page_icon="🏠",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Base styles — toolbar hidden, padding reduced
st.markdown("""
    <style>
        [data-testid="stToolbar"] { display: none !important; }
        .block-container { padding-top: 1.5rem !important; }
        [data-testid="stSidebarContent"] { padding-top: 1rem !important; }
    </style>
""", unsafe_allow_html=True)

def apply_theme():
    """Inject dark mode CSS if user prefers it."""
    user = st.session_state.get("auth_user") or {}
    theme = user.get("theme", "light")
    if theme == "dark":
        st.markdown("""
            <style>
                /* Dark background — entire app including header */
                .stApp,
                [data-testid="stAppViewContainer"],
                [data-testid="stHeader"],
                header[data-testid="stHeader"],
                .stApp > header {
                    background-color: #1e1e2e !important;
                    color: #cdd6f4 !important;
                }
                [data-testid="stSidebar"] {
                    background-color: #181825 !important;
                }
                /* Cards / expanders */
                [data-testid="stExpander"] {
                    background-color: #2a2a3e !important;
                    border: 1px solid #45475a !important;
                }
                /* Expander headers — dark at rest, invert to white on hover */
                [data-testid="stExpander"] summary,
                [data-testid="stExpanderHeader"],
                [data-testid="stExpanderToggleIcon"],
                .streamlit-expanderHeader {
                    background-color: #2a2a3e !important;
                    color: #cdd6f4 !important;
                    transition: background-color 0.15s ease, color 0.15s ease;
                }
                [data-testid="stExpander"] summary:hover,
                [data-testid="stExpanderHeader"]:hover,
                .streamlit-expanderHeader:hover {
                    background-color: #ffffff !important;
                    color: #1e1e2e !important;
                }
                [data-testid="stExpander"] summary:hover [data-testid="stExpanderToggleIcon"],
                [data-testid="stExpander"] summary:hover svg {
                    color: #1e1e2e !important;
                    fill: #1e1e2e !important;
                }
                /* Inputs */
                input, textarea, select,
                [data-baseweb="input"] > div,
                [data-baseweb="textarea"] > div {
                    background-color: #313244 !important;
                    color: #cdd6f4 !important;
                    border-color: #45475a !important;
                }
                /* Text */
                p, label, .stMarkdown, h1, h2, h3 {
                    color: #cdd6f4 !important;
                }
                /* Metric tiles */
                [data-testid="metric-container"] {
                    background-color: #2a2a3e !important;
                    border: 1px solid #45475a !important;
                    border-radius: 8px;
                    padding: 8px;
                }
                /* Buttons — dark at rest, invert to white on hover */
                .stButton > button,
                .stFormSubmitButton > button,
                .stDownloadButton > button,
                .stLinkButton > a,
                [data-testid="stBaseButton-secondary"],
                [data-testid="stBaseButton-primary"],
                [data-testid="baseButton-secondary"],
                [data-testid="baseButton-primary"] {
                    background-color: #313244 !important;
                    color: #cdd6f4 !important;
                    border: 1px solid #45475a !important;
                    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
                }
                .stButton > button:hover,
                .stFormSubmitButton > button:hover,
                .stDownloadButton > button:hover,
                .stLinkButton > a:hover,
                [data-testid="stBaseButton-secondary"]:hover,
                [data-testid="stBaseButton-primary"]:hover,
                [data-testid="baseButton-secondary"]:hover,
                [data-testid="baseButton-primary"]:hover {
                    background-color: #ffffff !important;
                    color: #1e1e2e !important;
                    border-color: #ffffff !important;
                }
                .stButton > button:disabled,
                .stFormSubmitButton > button:disabled,
                .stDownloadButton > button:disabled,
                [data-testid="stBaseButton-secondary"]:disabled,
                [data-testid="stBaseButton-primary"]:disabled,
                [data-testid="baseButton-secondary"]:disabled,
                [data-testid="baseButton-primary"]:disabled {
                    background-color: #313244 !important;
                    color: #6c7086 !important;
                    border-color: #45475a !important;
                    opacity: 0.6;
                }
            </style>
        """, unsafe_allow_html=True)


# ─── Auth helpers ─────────────────────────────────────────────────────────────

def get_token() -> str | None:
    return st.session_state.get("auth_token")

def get_user() -> dict | None:
    return st.session_state.get("auth_user")

def auth_headers() -> dict:
    token = get_token()
    return {"Authorization": f"Bearer {token}"} if token else {}

def logout():
    st.session_state.pop("auth_token", None)
    st.session_state.pop("auth_user", None)
    st.rerun()

def check_google_token_in_url():
    """After Google OAuth, the backend redirects back with ?token=... in the URL."""
    try:
        params = st.query_params
        if "token" in params:
            token = params["token"]
            # Verify token with backend
            resp = requests.get(f"{API_URL}/auth/me",
                                headers={"Authorization": f"Bearer {token}"}, timeout=5)
            if resp.status_code == 200:
                st.session_state.auth_token = token
                st.session_state.auth_user  = resp.json()
                st.session_state.sidebar_state = resp.json().get("sidebar", "expanded")
            st.query_params.clear()
            st.rerun()
    except Exception:
        pass


def api(method, path, **kwargs):
    # Inject auth token into every request
    headers = kwargs.pop("headers", {})
    headers.update(auth_headers())
    try:
        resp = requests.request(method, f"{API_URL}{path}", timeout=10,
                                headers=headers, **kwargs)
        if resp.status_code == 401:
            st.warning("Session expired. Please log in again.")
            logout()
            return None
        resp.raise_for_status()
        if resp.status_code == 204:
            return None
        return resp.json()
    except requests.exceptions.HTTPError as e:
        detail = ""
        try:
            detail = e.response.json().get("detail", "")
        except Exception:
            pass
        st.error(f"API error: {e} {detail}")
        return None
    except requests.exceptions.ConnectionError:
        st.error("Cannot reach backend. Is uvicorn running on port 8000?")
        return None


# ─── Login page ───────────────────────────────────────────────────────────────

def _complete_login(data: dict):
    st.session_state.auth_token = data["access_token"]
    st.session_state.auth_user  = data["user"]
    st.session_state.sidebar_state = data["user"].get("sidebar", "expanded")
    st.rerun()


def page_login():
    check_google_token_in_url()

    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        st.markdown("<br>", unsafe_allow_html=True)
        st.title("🏠 Property Management")
        st.markdown("<br>", unsafe_allow_html=True)

        tab_signin, tab_signup = st.tabs(["Sign In", "Sign Up"])

        with tab_signin:
            st.markdown("#### Sign in to continue")

            # Google sign-in — prominent at the top
            if st.button("🔐 Sign in with Google", type="primary", use_container_width=True):
                st.markdown(f'<meta http-equiv="refresh" content="0; url={API_URL}/auth/google">',
                            unsafe_allow_html=True)

            st.markdown("<div style='text-align:center;color:#888;margin:12px 0'>— or —</div>",
                        unsafe_allow_html=True)

            # Email & password below
            with st.form("login_form"):
                email    = st.text_input("Email", placeholder="email@example.com")
                password = st.text_input("Password", type="password")
                if st.form_submit_button("Sign In with Email", use_container_width=True):
                    if email and password:
                        try:
                            resp = requests.post(f"{API_URL}/auth/login",
                                                 json={"email": email, "password": password},
                                                 timeout=10)
                            if resp.status_code == 200:
                                _complete_login(resp.json())
                            else:
                                try:
                                    detail = resp.json().get("detail", "Login failed")
                                except Exception:
                                    detail = f"Login failed (status {resp.status_code})"
                                st.error(detail)
                        except requests.exceptions.ConnectionError:
                            st.error("Cannot reach backend. Is uvicorn running?")
                        except Exception as e:
                            st.error(f"Unexpected error: {e}")
                    else:
                        st.warning("Please enter email and password.")

        with tab_signup:
            st.markdown("#### Create your organisation")
            st.caption("Free plan — 1 property included. Upgrade any time for more.")

            with st.form("signup_form"):
                org_name  = st.text_input("Company / Organisation Name", placeholder="Acme Rentals")
                full_name = st.text_input("Your Name", placeholder="Jane Smith")
                email     = st.text_input("Email", placeholder="email@example.com", key="signup_email")
                password  = st.text_input("Password", type="password", key="signup_password")
                confirm   = st.text_input("Confirm Password", type="password", key="signup_confirm")
                if st.form_submit_button("Create Account", use_container_width=True):
                    if not (org_name and full_name and email and password):
                        st.warning("Please fill in all fields.")
                    elif password != confirm:
                        st.error("Passwords do not match.")
                    elif len(password) < 8:
                        st.error("Password must be at least 8 characters.")
                    else:
                        try:
                            resp = requests.post(f"{API_URL}/auth/signup", json={
                                "org_name": org_name, "full_name": full_name,
                                "email": email, "password": password,
                            }, timeout=10)
                            if resp.status_code == 200:
                                _complete_login(resp.json())
                            else:
                                try:
                                    detail = resp.json().get("detail", "Signup failed")
                                except Exception:
                                    detail = f"Signup failed (status {resp.status_code})"
                                st.error(detail)
                        except requests.exceptions.ConnectionError:
                            st.error("Cannot reach backend. Is uvicorn running?")
                        except Exception as e:
                            st.error(f"Unexpected error: {e}")


# ─── Profile page ─────────────────────────────────────────────────────────────

def page_profile():
    st.title("⚙️ My Profile")
    user = get_user() or {}

    col1, col2 = st.columns([1, 3])
    if user.get("avatar_url"):
        col1.image(user["avatar_url"], width=80)
    col2.markdown(f"**{user.get('name', '—')}**")
    col2.markdown(f"{user.get('email', '—')} — `{user.get('role', '—').upper()}`")

    st.markdown("---")

    with st.expander("✏️ Update Profile"):
        with st.form("update_profile"):
            new_name    = st.text_input("Full Name", value=user.get("name", ""))
            new_company = st.text_input("Company / Property Management Name",
                                         value=user.get("company_name", "Rodin Property Management"),
                                         help="This name appears in the sidebar, login page, and browser tab.")
            if st.form_submit_button("Save"):
                payload = {}
                if new_name:    payload["full_name"]    = new_name
                if new_company: payload["company_name"] = new_company
                r = api("PATCH", "/auth/profile", json=payload)
                if r:
                    if new_name:    st.session_state.auth_user["name"]         = new_name
                    if new_company: st.session_state.auth_user["company_name"] = new_company
                    st.success("Profile updated.")
                    st.rerun()

    with st.expander("🔑 Change Password"):
        with st.form("change_password"):
            new_pw  = st.text_input("New Password", type="password")
            confirm = st.text_input("Confirm Password", type="password")
            if st.form_submit_button("Change Password"):
                if new_pw != confirm:
                    st.error("Passwords do not match.")
                elif len(new_pw) < 8:
                    st.error("Password must be at least 8 characters.")
                else:
                    r = api("PATCH", "/auth/profile", json={"password": new_pw})
                    if r:
                        st.success("Password changed.")

    with st.expander("🌙 Appearance"):
        current_theme = user.get("theme", "light")

        new_theme = st.radio("Theme", ["light", "dark"],
                              index=0 if current_theme == "light" else 1,
                              horizontal=True,
                              format_func=lambda x: "☀️ Light" if x == "light" else "🌙 Dark")

        st.caption("💡 The sidebar opens automatically on desktop. On mobile it collapses — use the top navigation bar to switch pages.")

        if st.button("Save Appearance"):
            r = api("PATCH", "/auth/profile", json={
                "theme_preference": new_theme,
            })
            if r:
                st.session_state.auth_user["theme"] = new_theme
                st.success(f"Theme set to {new_theme} mode.")
                st.rerun()

    st.markdown("---")
    if st.button("🚪 Sign Out", type="secondary"):
        logout()


def status_badge(status):
    icons = {"paid": "🟢", "pending": "⚪", "late": "🔴", "promised": "🟡", "partial": "🟠"}
    return f"{icons.get(status, '⚪')} {status.upper()}"


def status_badge_ui(status: str):
    """Render a badge for payment status."""
    colors = {"paid": "green", "late": "red", "pending": "gray",
              "promised": "orange", "partial": "blue"}
    st.badge(status.upper(), color=colors.get(status.lower(), "gray"))


def fmt_phone(digits: str | None) -> str:
    """Format stored digits-only phone for display.
    7416999 9999  → (416) 999-9999
    +14169999999  → +1 (416) 999-9999
    anything else → returned as-is
    """
    if not digits:
        return ""
    import re
    d = digits.strip()
    # International with leading +
    if d.startswith("+"):
        nums = re.sub(r"\D", "", d[1:])
        if len(nums) == 11:  # e.g. 1 + 10 digits
            return f"+{nums[0]} ({nums[1:4]}) {nums[4:7]}-{nums[7:]}"
        return d  # unknown format, return raw
    nums = re.sub(r"\D", "", d)
    if len(nums) == 10:
        return f"({nums[:3]}) {nums[3:6]}-{nums[6:]}"
    if len(nums) == 11 and nums[0] == "1":
        return f"+1 ({nums[1:4]}) {nums[4:7]}-{nums[7:]}"
    return d  # return as-is for unknown formats


TRADES = ["hvac", "landscaping", "plumbing", "electrical", "roofing", "general", "other"]
PROPERTY_TYPES = ["single_family", "duplex", "apartment", "condo", "other"]


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: DASHBOARD
# ─────────────────────────────────────────────────────────────────────────────

def page_dashboard():
    st.title("🏠 Dashboard")
    data = api("GET", "/api/v1/rental/dashboard")
    if not data:
        return

    late_count      = data.get("late_payment_count", 0)
    promised_count  = data.get("promised_payment_count", 0)
    overdue_maint   = data["overdue_maintenance_tasks"]
    open_requests   = data["open_maintenance_requests"]
    open_tasks      = data.get("open_lease_tasks", 0)
    active_tenants  = data.get("active_tenant_count", 0)

    # ── Row 1: Occupancy, Rent, Tenants ───────────────────────────────────────
    c1, _gap1, c2, _gap2, c3 = st.columns([2, 1, 2, 1, 2])
    c1.metric("Occupancy",
              f"{data['occupancy_rate']}%",
              f"{data['spaces_occupied']}/{data['spaces_total']} spaces")
    c2.metric("Rent Collected (this month)",
              f"${data['rent_collected_this_month']:,.0f}",
              f"of ${data['rent_expected_this_month']:,.0f} expected")
    c3.metric("Active Tenants", active_tenants)

    st.divider()

    # ── Row 2: Action items — clickable if non-zero ───────────────────────────
    a1, a2, a3, a4, a5 = st.columns(5)

    _pages = st.session_state.get("_pages", {})
    pg_pay   = _pages.get("payments")
    pg_maint = _pages.get("maintenance")
    pg_tasks = _pages.get("lease_tasks")

    with a1:
        st.metric("🔴 Late Payments", late_count)
        if late_count > 0 and pg_pay:
            st.page_link(pg_pay, label="→ View Payments", icon="💳")

    with a2:
        st.metric("🟡 Promised Payments", promised_count,
                  delta=f"${data.get('promised_payment_outstanding',0):,.0f} outstanding" if promised_count > 0 else None)
        if promised_count > 0 and pg_pay:
            st.page_link(pg_pay, label="→ View Payments", icon="💳")

    with a3:
        st.metric("🔧 Overdue Maintenance", overdue_maint)
        if overdue_maint > 0 and pg_maint:
            st.page_link(pg_maint, label="→ View Maintenance", icon="🔧")

    with a4:
        st.metric("📋 Open Requests", open_requests)
        if open_requests > 0 and pg_maint:
            st.page_link(pg_maint, label="→ View Maintenance", icon="🔧")

    with a5:
        st.metric("📅 Lease Tasks", open_tasks)
        if open_tasks > 0 and pg_tasks:
            st.page_link(pg_tasks, label="→ View Lease Tasks", icon="📅")

    # ── Status summary ────────────────────────────────────────────────────────
    st.divider()
    issues = late_count + overdue_maint + open_requests + open_tasks
    if issues == 0:
        st.success("✅ Everything looks good — no urgent items.")
    else:
        st.info(f"⚠️ {issues} item(s) need attention — click the links above to go directly to each section.")


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: PROPERTIES, UNITS & SPACES
# ─────────────────────────────────────────────────────────────────────────────

def page_properties():
    st.title("🏢 Properties, Units & Spaces")

    # Load provinces reference data
    provinces = api("GET", "/api/v1/rental/ref/provinces") or []
    ca_provinces = [(p["code"], p["name"]) for p in provinces if p["country"] == "CA"]
    us_states = [(p["code"], p["name"]) for p in provinces if p["country"] == "US"]

    # Track which property is currently open so rerun doesn't close it
    if "open_property" not in st.session_state:
        st.session_state.open_property = None

    with st.expander("➕ Add Property"):
        with st.form("add_property"):
            c1, c2 = st.columns(2)
            address = c1.text_input("Address*")
            city    = c2.text_input("City*")
            c3, c4 = st.columns(2)
            country = c3.selectbox("Country*", ["CA", "US", "Other"], key="add_country")
            ptype   = c4.selectbox("Type", PROPERTY_TYPES)
            c5, c6, c7 = st.columns(3)
            if country == "CA":
                province_opts = {name: code for code, name in ca_provinces}
                state = c5.selectbox("Province*", list(province_opts.keys()), key="add_province")
                province_code = province_opts[state]
            elif country == "US":
                state_opts = {name: code for code, name in us_states}
                state = c5.selectbox("State*", list(state_opts.keys()), key="add_state")
                province_code = state_opts[state]
            else:
                province_code = c5.text_input("Province/State*", key="add_other_prov")
            zip_ = c6.text_input("Postal Code")
            rentable_since = c7.date_input("Rentable Since (optional)", value=None)
            notes   = st.text_area("Notes", height=68)
            if st.form_submit_button("Add Property"):
                if address and city and (country != "CA" or province_code) and (country != "US" or province_code) and (country == "Other" or province_code):
                    r = api("POST", "/api/v1/rental/properties", json={
                        "address": address, "city": city, "province_code": province_code,
                        "country": country, "zip": zip_ or None, "property_type": ptype,
                        "rentable_since": rentable_since.isoformat() if rentable_since else None,
                        "notes": notes or None
                    })
                    if r:
                        st.success("Property added.")
                        st.rerun()
                else:
                    st.warning("Address, city, country and province are required.")

    properties = api("GET", "/api/v1/rental/properties/with-units-and-spaces") or []

    for prop in properties:
        pid = prop["property_id"]

        is_open = st.session_state.open_property == pid
        with st.expander(
            f"**{prop['address']}**, {prop['city']} — {prop['unit_count']} unit(s), {prop['space_count']} space(s)",
            expanded=is_open
        ):

            # ── Property edit ─────────────────────────────────────────────────
            with st.form(f"edit_prop_{pid}"):
                c1, c2 = st.columns(2)
                a  = c1.text_input("Address", value=prop["address"])
                ci = c2.text_input("City", value=prop["city"])
                c3, c4 = st.columns(2)
                country = c3.selectbox("Country", ["CA", "US", "Other"],
                                      index=["CA", "US", "Other"].index(prop.get("country", "CA")),
                                      key=f"edit_country_{pid}")
                pt = c4.selectbox("Type", PROPERTY_TYPES,
                                  index=PROPERTY_TYPES.index(prop["property_type"])
                                  if prop["property_type"] in PROPERTY_TYPES else 0)
                c5, c6, c7 = st.columns(3)
                if country == "CA":
                    province_opts = {name: code for code, name in ca_provinces}
                    prov_name = next((name for code, name in ca_provinces if code == prop.get("province_code")), "")
                    st_ = c5.selectbox("Province", list(province_opts.keys()),
                                      index=list(province_opts.keys()).index(prov_name) if prov_name in province_opts else 0,
                                      key=f"edit_province_{pid}")
                    province_code = province_opts[st_]
                elif country == "US":
                    state_opts = {name: code for code, name in us_states}
                    prov_name = next((name for code, name in us_states if code == prop.get("province_code")), "")
                    st_ = c5.selectbox("State", list(state_opts.keys()),
                                      index=list(state_opts.keys()).index(prov_name) if prov_name in state_opts else 0,
                                      key=f"edit_state_{pid}")
                    province_code = state_opts[st_]
                else:
                    province_code = c5.text_input("Province/State", value=prop.get("province_code") or "")
                z   = c6.text_input("Postal Code", value=prop["zip"] or "")
                rentable_since = c7.date_input("Rentable Since", value=None)
                n   = st.text_area("Notes", value=prop["notes"] or "", height=68)
                if st.form_submit_button("Save"):
                    api("PATCH", f"/api/v1/rental/properties/{pid}", json={
                        "address": a, "city": ci, "province_code": province_code,
                        "country": country, "zip": z or None, "property_type": pt,
                        "rentable_since": rentable_since.isoformat() if rentable_since else None,
                        "notes": n or None
                    })
                    st.session_state.open_property = pid
                    st.success("Saved.")
                    st.rerun()

            # Delete property — two-click confirmation outside the form
            confirm_prop_key = f"confirm_del_prop_{pid}"
            if st.session_state.get(confirm_prop_key):
                st.error(
                    f"⚠️ Delete **{prop['address']}**? "
                    f"This will permanently delete all {prop['unit_count']} unit(s) and {prop['space_count']} rentable space(s). "
                    "This cannot be undone."
                )
                dp1, dp2 = st.columns(2)
                if dp1.button("Yes, delete this property and everything in it",
                              key=f"yes_del_prop_{pid}", type="primary"):
                    api("DELETE", f"/api/v1/rental/properties/{pid}")
                    st.session_state.pop(confirm_prop_key, None)
                    st.session_state.open_property = None
                    st.rerun()
                if dp2.button("Cancel", key=f"cancel_del_prop_{pid}"):
                    st.session_state.pop(confirm_prop_key, None)
                    st.rerun()
            else:
                if st.button("🗑 Delete Property", key=f"del_prop_{pid}", type="secondary"):
                    st.session_state[confirm_prop_key] = True
                    st.rerun()

            # ── Units ─────────────────────────────────────────────────────────
            units = prop.get("units") or []
            for unit in units:
                uid = unit["unit_id"]
                st.markdown("---")
                uh1, uh2 = st.columns([4, 1])
                uh1.markdown(f"**Unit {unit['unit_number']}** — {unit['bedrooms']}bd / {unit['bathrooms']}ba — {unit['space_count']} rentable space(s)")

                # ── Rentable spaces as tabs ────────────────────────────────────
                spaces = unit.get("spaces") or []

                tab_labels = [s["space_name"] for s in spaces] + ["➕ Add Space"]
                tabs = st.tabs(tab_labels)

                for i, space in enumerate(spaces):
                    sid = space["space_id"]
                    tenants_label = space["tenants"] or "Vacant"
                    rent_label = f"${float(space['total_rent'] or 0):,.0f}/mo" if space.get("total_rent") else "No active lease"
                    is_vacant = not space.get("tenants")

                    with tabs[i]:
                        col_status, col_info = st.columns([1, 4])
                        with col_status:
                            if is_vacant:
                                st.badge("VACANT", color="gray")
                            else:
                                st.badge("OCCUPIED", color="green")
                        with col_info:
                            st.markdown(f"**{tenants_label}** — {rent_label}")
                        with st.form(f"edit_space_{sid}"):
                            sc1, sc2 = st.columns([3, 1])
                            new_name  = sc1.text_input("Space Name", value=space["space_name"], key=f"sn_{sid}")
                            new_notes = sc2.text_input("Notes", value=space["notes"] or "", key=f"snotes_{sid}")
                            fb1, fb2 = st.columns([1, 4])
                            if fb1.form_submit_button("Save", key=f"save_space_{sid}"):
                                api("PATCH", f"/api/v1/rental/spaces/{sid}", json={
                                    "space_name": new_name, "notes": new_notes or None
                                })
                                st.session_state.open_property = pid
                                st.success("Saved.")
                                st.rerun()
                            if fb2.form_submit_button("🗑 Delete this Space", key=f"del_space_btn_{sid}", type="secondary"):
                                st.session_state[f"confirm_del_space_{sid}"] = True
                                st.session_state.open_property = pid
                                st.rerun()

                        # Confirmation shown below the form after delete is clicked
                        confirm_key = f"confirm_del_space_{sid}"
                        if st.session_state.get(confirm_key):
                            st.error(f"Are you sure you want to delete **{space['space_name']}**? This cannot be undone.")
                            dc1, dc2 = st.columns(2)
                            if dc1.button("Yes, delete", key=f"yes_del_space_{sid}", type="primary"):
                                api("DELETE", f"/api/v1/rental/spaces/{sid}")
                                st.session_state.pop(confirm_key, None)
                                st.session_state.open_property = pid
                                st.rerun()
                            if dc2.button("Cancel", key=f"cancel_del_space_{sid}"):
                                st.session_state.pop(confirm_key, None)
                                st.session_state.open_property = pid
                                st.rerun()

                # ── Add space tab ──────────────────────────────────────────────
                with tabs[-1]:
                    with st.form(f"add_space_{uid}"):
                        sc1, sc2 = st.columns(2)
                        s_name  = sc1.text_input("Space Name (e.g. Room 1, Whole Unit)", key=f"asn_{uid}")
                        s_notes = sc2.text_input("Notes", key=f"asnt_{uid}")
                        if st.form_submit_button("Add Space"):
                            if s_name:
                                r = api("POST", f"/api/v1/rental/units/{uid}/spaces", json={
                                    "space_name": s_name, "notes": s_notes or None
                                })
                                if r:
                                    st.session_state.open_property = pid
                                    st.success(f"'{s_name}' added.")
                                    st.rerun()
                            else:
                                st.warning("Space name is required.")

                # ── Edit / delete unit (collapsed) ────────────────────────────
                with st.expander(f"⚙️ Edit / Delete Unit {unit['unit_number']}"):
                    with st.form(f"edit_unit_{uid}"):
                        uc1, uc2, uc3, uc4 = st.columns(4)
                        u_num  = uc1.text_input("Unit #", value=unit["unit_number"])
                        u_bed  = uc2.number_input("Bed", value=unit["bedrooms"] or 1, min_value=0, step=1)
                        u_bath = uc3.number_input("Bath", value=float(unit["bathrooms"] or 1), min_value=0.0, step=0.5)
                        u_sqft = uc4.number_input("Sq Ft", value=unit["sq_ft"] or 0, min_value=0, step=50)
                        u_avail_since = st.date_input("Available Since (optional)", value=None)
                        if st.form_submit_button("Save Unit"):
                            api("PATCH", f"/api/v1/rental/units/{uid}", json={
                                "unit_number": u_num, "bedrooms": u_bed,
                                "bathrooms": u_bath, "sq_ft": u_sqft or None,
                                "available_since": u_avail_since.isoformat() if u_avail_since else None
                            })
                            st.session_state.open_property = pid
                            st.rerun()

                    confirm_unit_key = f"confirm_del_unit_{uid}"
                    if st.session_state.get(confirm_unit_key):
                        st.error(
                            f"⚠️ Delete Unit **{unit['unit_number']}**? "
                            f"This will also delete all **{unit['space_count']} rentable space(s)** inside it. "
                            "This cannot be undone."
                        )
                        du1, du2 = st.columns(2)
                        if du1.button(f"Yes, delete Unit {unit['unit_number']} and all its spaces",
                                      key=f"yes_del_unit_{uid}", type="primary"):
                            api("DELETE", f"/api/v1/rental/units/{uid}")
                            st.session_state.pop(confirm_unit_key, None)
                            st.session_state.open_property = pid
                            st.rerun()
                        if du2.button("Cancel", key=f"cancel_del_unit_{uid}"):
                            st.session_state.pop(confirm_unit_key, None)
                            st.session_state.open_property = pid
                            st.rerun()
                    else:
                        if st.button(f"🗑 Delete Unit {unit['unit_number']}",
                                     key=f"del_unit_{uid}", type="secondary"):
                            st.session_state[confirm_unit_key] = True
                            st.session_state.open_property = pid
                            st.rerun()

            # ── Add unit (collapsed) ──────────────────────────────────────────
            with st.expander("➕ Add Unit"):
                with st.form(f"add_unit_{pid}"):
                    au1, au2, au3, au4 = st.columns(4)
                    a_num  = au1.text_input("Unit #", value="1")
                    a_bed  = au2.number_input("Bed", value=1, min_value=0, step=1)
                    a_bath = au3.number_input("Bath", value=1.0, min_value=0.0, step=0.5)
                    a_sqft = au4.number_input("Sq Ft", value=0, min_value=0, step=50)
                    a_avail_since = st.date_input("Available Since (optional)", value=None)
                    if st.form_submit_button("Add Unit"):
                        r = api("POST", f"/api/v1/rental/properties/{pid}/units", json={
                            "unit_number": a_num, "bedrooms": a_bed,
                            "bathrooms": a_bath, "sq_ft": a_sqft or None,
                            "available_since": a_avail_since.isoformat() if a_avail_since else None
                        })
                        if r:
                            st.session_state.open_property = pid
                            st.success("Unit added.")
                            st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: TENANTS
# ─────────────────────────────────────────────────────────────────────────────

def _render_tenant_list(tenants, id_type_opts, contact_method_opts):
    """Shared rendering for a list of tenant rows."""

    for t in tenants:
        tid  = t["tenant_id"]
        name = f"{t['first_name']} {t['last_name']}"
        loc  = f"{t['address']} — Unit {t['unit_number']} — {t['space_name']}" if t.get("address") else "No active lease"
        rent = f"${float(t['monthly_obligation']):,.0f}/mo" if t.get("monthly_obligation") else ""

        with st.expander(f"**{name}** — {loc} {rent}"):
            with st.form(f"edit_tenant_{tid}"):
                c1, c2 = st.columns(2)
                nf  = c1.text_input("First Name", value=t["first_name"])
                nl  = c2.text_input("Last Name",  value=t["last_name"])
                c3, c4, c5 = st.columns(3)
                ne  = c3.text_input("Email", value=t["email"] or "")
                np_ = c4.text_input("Phone", value=fmt_phone(t["phone"]) or "")
                id_type = c5.selectbox("ID Type", list(id_type_opts.keys()) + [None],
                    format_func=lambda x: x or "None", key=f"id_type_{tid}")
                c6, c7 = st.columns(2)
                nid = c6.text_input("ID Number", value=t.get("id_number") or "", key=f"id_num_{tid}")
                pref_contact = c7.selectbox("Preferred Contact", list(contact_method_opts.keys()) + [None],
                    format_func=lambda x: x or "None", key=f"pref_cont_{tid}")
                nemail_consent = st.checkbox("Email Consent", value=t.get("email_consent", False), key=f"email_cons_{tid}")
                nn  = st.text_area("Notes", value=t["notes"] or "", height=68)
                if st.form_submit_button("Save"):
                    api("PATCH", f"/api/v1/rental/tenants/{tid}", json={
                        "first_name": nf, "last_name": nl,
                        "email": ne or None, "phone": np_ or None,
                        "id_type_id": id_type_opts.get(id_type) if id_type else None,
                        "id_number": nid or None,
                        "preferred_contact_id": contact_method_opts.get(pref_contact) if pref_contact else None,
                        "email_consent": nemail_consent,
                        "notes": nn or None
                    })
                    st.success("Saved.")
                    st.rerun()

            # Contact history — lazy loaded: only call API when user clicks to reveal
            ch_key = f"show_contact_history_{tid}"
            if st.button("📋 Contact History", key=f"ch_btn_{tid}", type="secondary"):
                st.session_state[ch_key] = not st.session_state.get(ch_key, False)
            if st.session_state.get(ch_key):
                st.caption("Phone and email changes are logged automatically when you save the edit form above.")
                history = api("GET", f"/api/v1/rental/tenants/{tid}/contact-history") or []
                if history:
                    for h in history:
                        val = fmt_phone(h["value"]) if h["contact_type"] == "phone" else h["value"]
                        to_label = h.get("effective_to") or "Current"
                        st.markdown(
                            f"**{h['contact_type'].upper()}** — {val} &nbsp;|&nbsp; "
                            f"{h['effective_from']} → {to_label}"
                            + (f" &nbsp;|&nbsp; *{h['notes']}*" if h.get("notes") and h["notes"] != "Auto-archived on update" else "")
                        )
                else:
                    st.info("No contact changes recorded yet.")

            confirm_t_key = f"confirm_del_tenant_{tid}"
            if st.session_state.get(confirm_t_key):
                st.error(f"Remove **{name}**? This cannot be undone.")
                dc1, dc2 = st.columns(2)
                if dc1.button("Yes, remove", key=f"yes_del_t_{tid}", type="primary"):
                    api("DELETE", f"/api/v1/rental/tenants/{tid}")
                    st.session_state.pop(confirm_t_key, None)
                    st.rerun()
                if dc2.button("Cancel", key=f"cancel_del_t_{tid}"):
                    st.session_state.pop(confirm_t_key, None)
                    st.rerun()
            else:
                if st.button("🗑 Remove Tenant", key=f"del_t_{tid}", type="secondary"):
                    st.session_state[confirm_t_key] = True
                    st.rerun()


def page_tenants():
    st.title("👥 Tenants")

    # Load ref data once — passed down to renderers to avoid repeated API calls
    id_types = api("GET", "/api/v1/rental/ref/id-types") or []
    contact_methods = api("GET", "/api/v1/rental/ref/contact-methods") or []

    id_type_opts = {t["name"]: t["type_id"] for t in id_types}
    contact_method_opts = {c["name"]: c["method_id"] for c in contact_methods}

    all_tenants = api("GET", "/api/v1/rental/tenants") or []
    active  = [t for t in all_tenants if t.get("lease_status") == "active"]
    past    = [t for t in all_tenants if t.get("lease_status") != "active"]

    with st.expander("➕ Add Tenant"):
        if "add_tenant_key" not in st.session_state:
            st.session_state.add_tenant_key = 0
        with st.form(f"add_tenant_{st.session_state.add_tenant_key}"):
            c1, c2 = st.columns(2)
            first = c1.text_input("First Name*")
            last  = c2.text_input("Last Name*")
            c3, c4, c5 = st.columns(3)
            email = c3.text_input("Email")
            phone = c4.text_input("Phone")
            id_type = c5.selectbox("ID Type", list(id_type_opts.keys()) + [None], format_func=lambda x: x or "None")
            c6, c7 = st.columns(2)
            id_number = c6.text_input("ID Number")
            preferred_contact = c7.selectbox("Preferred Contact", list(contact_method_opts.keys()) + [None], format_func=lambda x: x or "None")
            email_consent = st.checkbox("Email Consent")
            notes = st.text_area("Notes", height=68)
            if st.form_submit_button("Add Tenant"):
                if first and last:
                    r = api("POST", "/api/v1/rental/tenants", json={
                        "first_name": first, "last_name": last,
                        "email": email or None, "phone": phone or None,
                        "id_type_id": id_type_opts.get(id_type) if id_type else None,
                        "id_number": id_number or None,
                        "preferred_contact_id": contact_method_opts.get(preferred_contact) if preferred_contact else None,
                        "email_consent": email_consent,
                        "notes": notes or None
                    })
                    if r:
                        st.session_state.add_tenant_key += 1
                        st.success("Tenant added.")
                        st.rerun()
                else:
                    st.warning("First and last name are required.")

    # ── Search / Filter ───────────────────────────────────────────────────────
    st.markdown("---")

    # Persist filter values across page navigation using session state
    if "tenant_name_search" not in st.session_state:
        st.session_state.tenant_name_search = ""
    if "tenant_prop_filter" not in st.session_state:
        st.session_state.tenant_prop_filter = "All properties"

    property_names = sorted({t["address"] for t in all_tenants if t.get("address")})
    prop_options = ["All properties"] + property_names

    fc1, fc2 = st.columns([2, 3])
    name_search = fc1.text_input("🔍 Search by name", placeholder="Type partial name…",
                                  value=st.session_state.tenant_name_search,
                                  key="tenant_name_input")

    # Keep saved prop filter valid if properties changed
    saved_prop = st.session_state.tenant_prop_filter
    prop_idx = prop_options.index(saved_prop) if saved_prop in prop_options else 0
    prop_filter = fc2.selectbox("Filter by property", prop_options, index=prop_idx,
                                 key="tenant_prop_input")

    # Persist current values back to session state
    st.session_state.tenant_name_search = name_search
    st.session_state.tenant_prop_filter  = prop_filter

    def apply_filters(tenant_list):
        result = tenant_list
        if name_search:
            q = name_search.lower()
            result = [t for t in result
                      if q in t["first_name"].lower() or q in t["last_name"].lower()]
        if prop_filter != "All properties":
            result = [t for t in result if t.get("address") == prop_filter]
        return result

    filtered_active = apply_filters(active)
    filtered_past   = apply_filters(past)

    # Show clear filter hint when filter is active
    if name_search or prop_filter != "All properties":
        total_shown = len(filtered_active) + len(filtered_past)
        st.caption(f"Showing {total_shown} of {len(all_tenants)} tenants")

    tab_active, tab_past = st.tabs([
        f"Active ({len(filtered_active)})",
        f"Past / No Lease ({len(filtered_past)})",
    ])

    with tab_active:
        if filtered_active:
            _render_tenant_list(filtered_active, id_type_opts, contact_method_opts)
        elif name_search or prop_filter != "All properties":
            st.info("No active tenants match the current filter.")
        else:
            st.info("No active tenants.")

    with tab_past:
        if filtered_past:
            _render_tenant_list(filtered_past, id_type_opts, contact_method_opts)
        elif name_search or prop_filter != "All properties":
            st.info("No past tenants match the current filter.")
        else:
            st.info("No past tenants.")


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: LEASES
# ─────────────────────────────────────────────────────────────────────────────

def page_leases():
    st.title("📋 Leases")

    # Load ref data
    lease_statuses = api("GET", "/api/v1/rental/ref/lease-statuses") or []

    tenants    = api("GET", "/api/v1/rental/tenants") or []
    properties = api("GET", "/api/v1/rental/properties/with-units-and-spaces") or []

    # Build flat list of spaces for lease creation — from already-loaded nested data
    all_spaces = []
    for prop in properties:
        for unit in prop.get("units") or []:
            for s in unit.get("spaces") or []:
                all_spaces.append({**s,
                    "unit_number": unit["unit_number"],
                    "property_address": prop["address"],
                    "label": f"{prop['address']} — Unit {unit['unit_number']} — {s['space_name']}"
                })

    with st.expander("➕ Create Lease"):
        if "add_lease_key" not in st.session_state:
            st.session_state.add_lease_key = 0
        with st.form(f"add_lease_{st.session_state.add_lease_key}"):
            if all_spaces:
                space_opts = {s["label"]: s["space_id"] for s in all_spaces}
                sel_space = st.selectbox("Rentable Space*", list(space_opts.keys()))
                lease_status_opts = {f"{ls['label']}": ls["code"] for ls in lease_statuses}
                lease_type_labels = list(lease_status_opts.keys())
                fixed_term_idx = next((i for i, k in enumerate(lease_type_labels) if "Fixed" in k), 0)
                c1, c2, c3 = st.columns(3)
                l_start = c1.date_input("Start Date", value=date.today())
                l_end   = c2.date_input("End Date (optional)", value=None)
                l_type  = c3.selectbox("Lease Type*", lease_type_labels, index=fixed_term_idx)
                c4, c5, c6 = st.columns(3)
                l_rent  = c4.number_input("Total Rent ($)", min_value=0.0, step=50.0)
                l_dep   = c5.number_input("Security Deposit ($)", min_value=0.0, step=50.0)
                l_lmr   = c6.number_input("LMR Deposit ($)", min_value=0.0, step=50.0)
                l_notes = st.text_area("Notes", height=68)
                if st.form_submit_button("Create Lease"):
                    r = api("POST", "/api/v1/rental/leases", json={
                        "space_id":         space_opts[sel_space],
                        "start_date":       l_start.isoformat(),
                        "end_date":         l_end.isoformat() if l_end else None,
                        "lease_type_code":  lease_status_opts[l_type],
                        "total_rent":       l_rent,
                        "security_deposit": l_dep or None,
                        "lmr_deposit":      l_lmr or None,
                        "notes":            l_notes or None,
                    })
                    if r:
                        st.session_state.add_lease_key += 1
                        st.success(f"Lease created (ID {r['lease_id']}). Add members below.")
                        st.rerun()
            else:
                st.info("Add properties, units and spaces first.")

    leases = api("GET", "/api/v1/rental/leases/with-members") or []
    tenant_opts = {f"{t['first_name']} {t['last_name']}": t["tenant_id"] for t in tenants}

    if not leases:
        st.info("No leases yet.")
        return

    # ── Filters ───────────────────────────────────────────────────────────────
    st.markdown("---")

    if "lease_prop_filter" not in st.session_state:
        st.session_state.lease_prop_filter = "All properties"
    if "lease_tenant_search" not in st.session_state:
        st.session_state.lease_tenant_search = ""

    prop_names = sorted({l["address"] for l in leases if l.get("address")})
    prop_options = ["All properties"] + prop_names
    saved_prop = st.session_state.lease_prop_filter
    prop_idx = prop_options.index(saved_prop) if saved_prop in prop_options else 0

    fc1, fc2 = st.columns([3, 2])
    lease_prop_filter   = fc1.selectbox("Filter by property", prop_options, index=prop_idx, key="lease_prop_input")
    lease_tenant_search = fc2.text_input("🔍 Search by tenant name", placeholder="Type partial name…",
                                          value=st.session_state.lease_tenant_search, key="lease_tenant_input")

    st.session_state.lease_prop_filter   = lease_prop_filter
    st.session_state.lease_tenant_search = lease_tenant_search

    def lease_matches(lease):
        if lease_prop_filter != "All properties" and lease.get("address") != lease_prop_filter:
            return False
        if lease_tenant_search:
            q = lease_tenant_search.lower()
            member_names = [
                f"{m['first_name']} {m['last_name']}".lower()
                for m in (lease.get("members") or [])
            ]
            if not any(q in name for name in member_names):
                return False
        return True

    filtered_leases = [l for l in leases if lease_matches(l)]

    active_leases = [l for l in filtered_leases if l.get("status") in ("active", None) or l.get("status_code") in (1, 2)]
    past_leases   = [l for l in filtered_leases if l not in active_leases]

    if lease_prop_filter != "All properties" or lease_tenant_search:
        st.caption(f"Showing {len(filtered_leases)} of {len(leases)} leases")

    tab_active, tab_past = st.tabs([
        f"Active ({len(active_leases)})",
        f"Past ({len(past_leases)})",
    ])

    def render_leases(lease_list):
        if not lease_list:
            st.info("No leases found.")
            return
        for lease in lease_list:
            lid = lease["lease_id"]
            status_code = lease.get("status_code") or lease.get("status")
            status_label = next((ls["label"] for ls in lease_statuses if ls["code"] == status_code), str(status_code))
            status_icon = {1: "🟢", 2: "🟢", 3: "⚪", 4: "🔴"}.get(status_code, "⚪")
            label = (f"{status_icon} **{lease['address']}** — Unit {lease['unit_number']} — "
                     f"{lease['space_name']} | ${float(lease['total_rent']):,.0f}/mo | "
                     f"{status_label} | {lease['member_count']} member(s)")

            with st.expander(label):

                # ── Members ───────────────────────────────────────────────────
                members = lease.get("members") or []
                st.markdown("**Members & Monthly Obligations**")

                for m in members:
                    mid   = m["member_id"]
                    mname = f"{m['first_name']} {m['last_name']}"
                    member_badge = "🔄" if m.get("member_type") == "sublessee" else ""
                    primary = "⭐" if m["is_primary"] else ""

                    mc1, mc2 = st.columns([3, 1])
                    with mc1:
                        with st.form(f"edit_member_{mid}"):
                            fc1, fc2, fc3 = st.columns(3)
                            fc1.markdown(f"{member_badge} **{mname}** {primary}")
                            new_obl     = fc2.number_input("$/mo", value=float(m["monthly_obligation"]),
                                                            step=25.0, key=f"mo_{mid}")
                            new_primary = fc3.checkbox("Primary", value=m["is_primary"], key=f"mp_{mid}")
                            if st.form_submit_button("Save", key=f"save_mem_{mid}"):
                                api("PATCH", f"/api/v1/rental/lease-members/{mid}", json={
                                    "monthly_obligation": new_obl, "is_primary": new_primary
                                })
                                st.rerun()
                    with mc2:
                        confirm_mem_key = f"confirm_del_member_{mid}"
                        if st.session_state.get(confirm_mem_key):
                            st.warning(f"Remove {mname}?")
                            if st.button("Yes", key=f"yes_del_mem_{mid}", type="primary"):
                                api("DELETE", f"/api/v1/rental/lease-members/{mid}")
                                st.session_state.pop(confirm_mem_key, None)
                                st.rerun()
                            if st.button("No", key=f"no_del_mem_{mid}"):
                                st.session_state.pop(confirm_mem_key, None)
                                st.rerun()
                        else:
                            if st.button("🗑 Remove", key=f"mr_{mid}", type="secondary"):
                                st.session_state[confirm_mem_key] = True
                                st.rerun()

                st.markdown("---")

                # ── Add member ────────────────────────────────────────────────
                with st.expander("➕ Add Member to Lease"):
                    with st.form(f"add_member_{lid}"):
                        ac1, ac2, ac3 = st.columns(3)
                        sel_tenant  = ac1.selectbox("Tenant", list(tenant_opts.keys()), key=f"amt_{lid}")
                        obl         = ac2.number_input("Monthly Obligation ($)", min_value=0.0, step=25.0, key=f"amo_{lid}")
                        is_primary  = ac3.checkbox("Primary", key=f"amp_{lid}")
                        member_type = st.selectbox("Member Type", ["tenant", "sublessee"], key=f"amtype_{lid}")
                        if member_type == "sublessee":
                            ac4, ac5 = st.columns(2)
                            sublease_start = ac4.date_input("Sublease Start", key=f"amsub_start_{lid}")
                            sublease_end   = ac5.date_input("Sublease End", key=f"amsub_end_{lid}")
                        else:
                            sublease_start = sublease_end = None
                        if st.form_submit_button("Add Member"):
                            payload = {
                                "tenant_id":          tenant_opts[sel_tenant],
                                "monthly_obligation": obl,
                                "is_primary":         is_primary,
                                "member_type":        member_type,
                            }
                            if sublease_start:
                                payload["sublease_start"] = sublease_start.isoformat()
                            if sublease_end:
                                payload["sublease_end"] = sublease_end.isoformat()
                            api("POST", f"/api/v1/rental/leases/{lid}/members", json=payload)
                            st.success("Member added.")
                            st.rerun()

                # ── Edit lease ────────────────────────────────────────────────
                with st.expander("⚙️ Edit Lease"):
                    with st.form(f"edit_lease_{lid}"):
                        lc1, lc2, lc3 = st.columns(3)
                        new_rent = lc1.number_input("Total Rent ($)", value=float(lease["total_rent"]), step=50.0)
                        lease_status_opts = {ls["label"]: ls["code"] for ls in lease_statuses}
                        cur_code  = lease.get("status_code") or lease.get("status")
                        cur_label = next((ls["label"] for ls in lease_statuses if ls["code"] == cur_code), "")
                        status_idx = list(lease_status_opts.keys()).index(cur_label) if cur_label in lease_status_opts else 0
                        new_status_label = lc2.selectbox("Status", list(lease_status_opts.keys()), index=status_idx)
                        new_lmr  = lc3.number_input("LMR Deposit ($)", value=float(lease.get("lmr_deposit") or 0), step=50.0)
                        ld1, ld2 = st.columns(2)
                        cur_start = date.fromisoformat(lease["start_date"][:10]) if lease.get("start_date") else date.today()
                        cur_end   = date.fromisoformat(lease["end_date"][:10]) if lease.get("end_date") else None
                        new_start = ld1.date_input("Start Date", value=cur_start, key=f"ls_{lid}")
                        new_end   = ld2.date_input("End Date", value=cur_end, key=f"le_{lid}")
                        if st.form_submit_button("Update Lease"):
                            payload = {
                                "status_code": lease_status_opts[new_status_label],
                                "total_rent":  new_rent,
                                "lmr_deposit": new_lmr or None,
                                "start_date":  new_start.isoformat(),
                            }
                            if new_end:
                                payload["end_date"] = new_end.isoformat()
                            api("PATCH", f"/api/v1/rental/leases/{lid}", json=payload)
                            st.success("Lease updated.")
                            st.rerun()

                # ── Delete lease ──────────────────────────────────────────────
                confirm_lease_key = f"confirm_del_lease_{lid}"
                if st.session_state.get(confirm_lease_key):
                    st.error(f"⚠️ Delete this lease permanently? All members and ledger entries will also be deleted.")
                    dl1, dl2 = st.columns(2)
                    if dl1.button("Yes, delete lease", key=f"yes_del_lease_{lid}", type="primary"):
                        api("DELETE", f"/api/v1/rental/leases/{lid}")
                        st.session_state.pop(confirm_lease_key, None)
                        st.rerun()
                    if dl2.button("Cancel", key=f"cancel_del_lease_{lid}"):
                        st.session_state.pop(confirm_lease_key, None)
                        st.rerun()
                else:
                    if st.button("🗑 Delete Lease", key=f"del_lease_{lid}", type="secondary"):
                        st.session_state[confirm_lease_key] = True
                        st.rerun()

    with tab_active:
        render_leases(active_leases)

    with tab_past:
        render_leases(past_leases)


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: PAYMENTS (Rent Ledger)
# ─────────────────────────────────────────────────────────────────────────────

def page_payments():
    st.title("💳 Payments")

    pay_methods = api("GET", "/api/v1/rental/ref/payment-methods") or []
    method_opts = {m["label"]: m["code"] for m in pay_methods}
    method_labels = list(method_opts.keys())
    etransfer_idx = next((i for i, k in enumerate(method_labels) if "transfer" in k.lower()), 0)

    today = date.today()
    current_month = today.strftime("%Y-%m")
    month_options_all = [f"{y}-{m:02d}" for y in [today.year - 1, today.year, today.year + 1] for m in range(1, 13)]

    # ── Month selector (shared across tabs) ──────────────────────────────────
    mc1, mc2, mc3 = st.columns([2, 1, 3])
    sel_month = mc1.selectbox("Month", month_options_all,
                               index=month_options_all.index(current_month))
    if mc2.button("⚡ Generate", use_container_width=True,
                  help="Create pending payment rows for all active tenants for this month"):
        r = api("POST", f"/api/v1/rental/ledger/generate-month?month={sel_month}")
        if r is not None:
            created = r.get("created", 0)
            if created > 0:
                mc3.success(f"✅ Created {created} pending entries for {sel_month}.")
            else:
                mc3.info("All entries already exist for this month.")

    st.divider()
    tab_roll, tab_add = st.tabs(["📋 Rent Roll", "➕ Add Entry"])

    # ═══════════════════════════════════════════════════════════════════════════
    # TAB 1 — RENT ROLL
    # ═══════════════════════════════════════════════════════════════════════════
    with tab_roll:
        roll = api("GET", "/api/v1/rental/rent-roll", params={"month": sel_month}) or []

        if not roll:
            st.info(f"No active tenants found for {sel_month}. Click ⚡ Generate above to create payment entries.")
        else:
            # Summary counts
            total_due      = sum(float(r["monthly_obligation"]) for r in roll)
            total_paid     = sum(float(r["amount_paid"] or 0) for r in roll)
            count_paid     = sum(1 for r in roll if r.get("payment_status") == "paid")
            count_partial  = sum(1 for r in roll if r.get("payment_status") == "partial")
            count_late     = sum(1 for r in roll if r.get("payment_status") in ("late", "pending")
                                 and r.get("ledger_id") and date.fromisoformat(sel_month + "-01") < today)
            count_none     = sum(1 for r in roll if not r.get("ledger_id"))

            sc1, sc2, sc3, sc4 = st.columns(4)
            sc1.metric("Total Expected", f"${total_due:,.0f}")
            sc2.metric("Collected", f"${total_paid:,.0f}")
            sc3.metric("🟢 Paid", count_paid)
            sc4.metric("⚠️ Outstanding", len(roll) - count_paid)
            st.divider()

            # Group by property
            from itertools import groupby
            roll_sorted = sorted(roll, key=lambda r: (r["address"], r["unit_number"], r["space_name"]))

            for prop_addr, prop_rows in groupby(roll_sorted, key=lambda r: r["address"]):
                st.markdown(f"### 🏢 {prop_addr}")
                for r in prop_rows:
                    lid        = r.get("ledger_id")
                    status     = r.get("payment_status") or "not_generated"
                    obligation = float(r["monthly_obligation"])
                    paid       = float(r["amount_paid"] or 0)
                    remaining  = max(0.0, obligation - paid)
                    tenant     = r["tenant_name"]
                    space      = f"Unit {r['unit_number']} — {r['space_name']}"

                    # Status colour
                    status_colors = {
                        "paid": "🟢", "partial": "🟠", "promised": "🟡",
                        "late": "🔴", "pending": "⚪", "not_generated": "⬜"
                    }
                    icon = status_colors.get(status, "⬜")

                    with st.expander(f"{icon} **{tenant}** — {space} | ${obligation:,.0f}/mo | {status.upper().replace('_',' ')}"):

                        if status == "paid":
                            st.success(f"✅ Paid in full: ${paid:,.0f} on {r.get('paid_date') or '—'}")

                        elif status == "partial":
                            st.warning(f"🟠 Partial — ${paid:,.0f} paid, **${remaining:,.0f} remaining**")
                            with st.form(f"rr_pay_{lid}"):
                                pc1, pc2, pc3 = st.columns(3)
                                amt    = pc1.number_input("Amount received ($)", value=remaining, min_value=0.0, step=25.0)
                                dt     = pc2.date_input("Date", value=today)
                                method = pc3.selectbox("Method", method_labels, index=etransfer_idx)
                                notes  = st.text_input("Notes")
                                if st.form_submit_button("💾 Record Payment"):
                                    api("POST", f"/api/v1/rental/ledger/{lid}/pay", json={
                                        "amount": amt, "paid_date": dt.isoformat(),
                                        "payment_method_code": method_opts[method], "notes": notes or None
                                    })
                                    st.rerun()

                        elif status == "promised":
                            st.info(f"🟡 Promised ${r.get('promised_amount') or obligation:,.0f} by {r.get('promised_date') or '?'}")
                            with st.form(f"rr_pay_{lid}"):
                                pc1, pc2, pc3 = st.columns(3)
                                amt    = pc1.number_input("Amount received ($)", value=obligation, min_value=0.0, step=25.0)
                                dt     = pc2.date_input("Date", value=today)
                                method = pc3.selectbox("Method", method_labels, index=etransfer_idx)
                                notes  = st.text_input("Notes")
                                if st.form_submit_button("💾 Record Payment"):
                                    api("POST", f"/api/v1/rental/ledger/{lid}/pay", json={
                                        "amount": amt, "paid_date": dt.isoformat(),
                                        "payment_method_code": method_opts[method], "notes": notes or None
                                    })
                                    st.rerun()

                        elif status in ("pending", "late") and lid:
                            if status == "late":
                                st.error(f"🔴 LATE — ${obligation:,.0f} was due {sel_month}-01")
                            with st.form(f"rr_pay_{lid}"):
                                pc1, pc2, pc3 = st.columns(3)
                                amt    = pc1.number_input("Amount received ($)", value=obligation, min_value=0.0, step=25.0)
                                dt     = pc2.date_input("Date", value=today)
                                method = pc3.selectbox("Method", method_labels, index=etransfer_idx)
                                notes  = st.text_input("Notes")
                                if st.form_submit_button("💾 Record Payment"):
                                    api("POST", f"/api/v1/rental/ledger/{lid}/pay", json={
                                        "amount": amt, "paid_date": dt.isoformat(),
                                        "payment_method_code": method_opts[method], "notes": notes or None
                                    })
                                    st.rerun()
                            # Mark as promised
                            with st.form(f"rr_promise_{lid}"):
                                pr1, pr2 = st.columns(2)
                                pr_date = pr1.date_input("Promised by", value=today)
                                pr_amt  = pr2.number_input("Amount ($)", value=obligation, min_value=0.0)
                                if st.form_submit_button("🟡 Mark as Promised"):
                                    api("PATCH", f"/api/v1/rental/ledger/{lid}", json={
                                        "status": "promised",
                                        "promised_date": pr_date.isoformat(),
                                        "promised_amount": pr_amt
                                    })
                                    st.rerun()

                        else:
                            # No ledger row generated yet
                            st.caption(f"No payment entry for {sel_month} yet. Click ⚡ Generate above.")

    # ═══════════════════════════════════════════════════════════════════════════
    # TAB 2 — ADD ENTRY
    # ═══════════════════════════════════════════════════════════════════════════
    with tab_add:
        leases = api("GET", "/api/v1/rental/leases") or []
        active_leases = [l for l in leases if l.get("status_code") in (1, 2) or l.get("status") == "active"]
        if not active_leases:
            st.info("No active leases found.")
        else:
            # Step 1 — pick a lease (outside form so selecting it updates the rest)
            lease_opts = {
                f"{l['address']} — {l['space_name']}": l
                for l in active_leases
            }
            sel_lease_label = st.selectbox("Lease", list(lease_opts.keys()), key="new_ledger_lease")
            sel_lease = lease_opts[sel_lease_label]
            lid = sel_lease["lease_id"]

            # Load members of the selected lease to populate tenant dropdown
            lease_members = api("GET", f"/api/v1/rental/leases/{lid}/members") or []

            # Smart due date: if lease starts mid-month, first payment = start_date,
            # otherwise 1st of current month
            from datetime import date as dt
            import calendar

            def smart_due_date(lease, offset_months=0):
                start = date.fromisoformat(lease["start_date"]) if lease.get("start_date") else today
                if start > today and offset_months == 0:
                    # Lease hasn't started yet — use start date as first due date
                    return start
                # Base: 1st of current month + offset
                base = date(today.year, today.month, 1)
                m = base.month + offset_months
                y = base.year + (m - 1) // 12
                m = ((m - 1) % 12) + 1
                return date(y, m, 1)

            PAYMENT_TYPES = [
                "Regular — current month",
                "Regular — next month (advance)",
                "Regular — 2 months ahead (advance)",
                "Regular — past month",
                "Regular — 2 months ago",
                "LMR Deposit",
                "Security Deposit",
                "Other / Custom",
            ]

            with st.form("add_ledger"):
                c1, c2 = st.columns(2)

                # Tenant — only members of the selected lease
                if lease_members:
                    member_opts = {
                        f"{m['first_name']} {m['last_name']} (${float(m['monthly_obligation']):,.0f}/mo)": m
                        for m in lease_members
                    }
                    sel_member_label = c1.selectbox("Tenant*", list(member_opts.keys()))
                    sel_member = member_opts[sel_member_label]
                    default_amount = float(sel_member["monthly_obligation"])
                    sel_tenant_id = sel_member["tenant_id"]
                else:
                    c1.warning("No members on this lease yet.")
                    sel_tenant_id = None
                    default_amount = float(sel_lease.get("total_rent") or 0)

                payment_type = c2.selectbox("Payment Type*", PAYMENT_TYPES)

                # Smart due date based on payment type
                if payment_type == "Regular — current month":
                    default_due = smart_due_date(sel_lease, 0)
                    default_amt = default_amount
                elif payment_type == "Regular — next month (advance)":
                    default_due = smart_due_date(sel_lease, 1)
                    default_amt = default_amount
                elif payment_type == "Regular — 2 months ahead (advance)":
                    default_due = smart_due_date(sel_lease, 2)
                    default_amt = default_amount
                elif payment_type == "Regular — past month":
                    default_due = smart_due_date(sel_lease, -1)
                    default_amt = default_amount
                elif payment_type == "Regular — 2 months ago":
                    default_due = smart_due_date(sel_lease, -2)
                    default_amt = default_amount
                elif payment_type == "LMR Deposit":
                    default_due = date.fromisoformat(sel_lease["start_date"]) if sel_lease.get("start_date") else today
                    default_amt = float(sel_lease.get("lmr_deposit") or sel_lease.get("total_rent") or 0)
                elif payment_type == "Security Deposit":
                    default_due = date.fromisoformat(sel_lease["start_date"]) if sel_lease.get("start_date") else today
                    default_amt = float(sel_lease.get("security_deposit") or 0)
                else:
                    default_due = today
                    default_amt = default_amount

                c3, c4 = st.columns(2)
                p_due    = c3.date_input("Due Date*", value=default_due)
                p_amount = c4.number_input("Amount Due ($)*", value=default_amt, min_value=0.0, step=25.0)

                c5, c6 = st.columns(2)
                p_status = c5.selectbox("Status", ["pending", "paid", "partial", "promised", "late"])
                # Amount paid — auto-fill when status is paid, otherwise 0
                p_paid = c6.number_input(
                    "Amount Paid ($)",
                    value=p_amount if p_status == "paid" else 0.0,
                    min_value=0.0, step=25.0
                )

                c7, c8, c9 = st.columns(3)
                method_labels = list(method_opts.keys())
                etransfer_idx = next((i for i, k in enumerate(method_labels) if "transfer" in k.lower()), 0)
                p_method  = c7.selectbox("Payment Method", method_labels, index=etransfer_idx)
                p_paid_dt = c8.date_input("Date Paid", value=today if p_status == "paid" else None)
                p_notes   = c9.text_input("Notes", value=payment_type if payment_type not in ("Regular — current month", "Other / Custom") else "")

                if st.form_submit_button("Add Entry") and sel_tenant_id:
                    api("POST", "/api/v1/rental/ledger", json={
                        "lease_id":            lid,
                        "tenant_id":           sel_tenant_id,
                        "due_date":            p_due.isoformat(),
                        "amount_due":          p_amount,
                        "amount_paid":         p_paid if p_paid > 0 else None,
                        "paid_date":           p_paid_dt.isoformat() if p_paid > 0 and p_paid_dt else None,
                        "status":              p_status,
                        "payment_method_code": method_opts[p_method],
                        "notes":               p_notes or None,
                    })
                    st.success("Entry added.")
                    st.rerun()

        st.markdown("---")

        if not ledger:
            st.info("No payment entries found for the selected filters. Use **⚡ Generate** above.")
        else:
            total_due  = sum(float(r["amount_due"]) for r in ledger)
            total_paid = sum(float(r["amount_paid"] or 0) for r in ledger)
            st.markdown(f"**{len(ledger)} entries — Due: ${total_due:,.0f} | Collected: ${total_paid:,.0f}**")
            st.markdown("---")

            # Pre-fetch lease members for "Paid by" dropdown
            lease_members_cache = {}
            for row in ledger:
                lease_id = row["lease_id"]
                if lease_id not in lease_members_cache:
                    members = api("GET", f"/api/v1/rental/leases/{lease_id}/members") or []
                    lease_members_cache[lease_id] = {
                        f"{m['first_name']} {m['last_name']}": m["tenant_id"] for m in members
                    }

            for row in ledger:
                lid     = row["ledger_id"]
                badge   = status_badge(row["status"])
                tenant  = row.get("tenant_name", "Unknown")
                loc     = f"{row.get('address', '')} — {row.get('space_name', '')} (Unit {row.get('unit_number', '')})"
                paid    = f"${float(row['amount_paid']):,.0f}" if row["amount_paid"] else "—"
                due_amt = f"${float(row['amount_due']):,.0f}"
                paid_by = row.get("paid_by_name")
                paid_by_label = f" — paid by {paid_by}" if paid_by and paid_by != tenant else ""
        
                header = f"{badge} | {tenant} | {loc} | Due: {row['due_date']} | {paid} / {due_amt}{paid_by_label}"
        
                # Co-tenants on the same lease for the "Paid by" dropdown
                co_tenants = lease_members_cache.get(row["lease_id"], {})
                payer_options = {"— same as above —": None, **co_tenants}
        
                with st.expander(header):
                    if row.get("promised_date"):
                        st.info(f"Promised: ${row.get('promised_amount') or '?'} by {row['promised_date']}")
                    if row.get("notes"):
                        st.caption(f"Notes: {row['notes']}")
        
                    tab1, tab2, tab3 = st.tabs(["Record Payment", "Mark as Promised", "Payment History"])
        
                    with tab1:
                        already_paid = float(row.get("amount_paid") or 0)
                        amount_due   = float(row["amount_due"])
                        remaining    = max(0.0, amount_due - already_paid)
        
                        if already_paid > 0:
                            st.caption(f"Already collected: **${already_paid:,.0f}** — Remaining: **${remaining:,.0f}**")
        
                        with st.form(f"record_pay_{lid}"):
                            rc1, rc2, rc3 = st.columns(3)
                            r_amount = rc1.number_input(
                                "Amount received this payment ($)",
                                value=remaining,
                                min_value=0.0, step=25.0,
                                help="Enter only what was received NOW — previous payments are preserved."
                            )
                            r_date   = rc2.date_input("Date Received", value=today)
                            method_labels = list(method_opts.keys())
                            etransfer_idx = next((i for i, k in enumerate(method_labels) if "transfer" in k.lower() or k.lower() == "e-transfer"), 0)
                            r_method = rc3.selectbox("Method", method_labels, index=etransfer_idx)
                            if len(co_tenants) > 1:
                                default_payer = row.get("paid_by_name") or "— same as above —"
                                default_idx = list(payer_options.keys()).index(default_payer) \
                                              if default_payer in payer_options else 0
                                r_payer = st.selectbox("Paid by", list(payer_options.keys()), index=default_idx)
                            else:
                                r_payer = "— same as above —"
                            r_notes = st.text_input("Notes")
                            if st.form_submit_button("Save Payment"):
                                r = api("POST", f"/api/v1/rental/ledger/{lid}/pay", json={
                                    "amount":              r_amount,
                                    "paid_date":           r_date.isoformat(),
                                    "payment_method_code": method_opts.get(r_method),
                                    "notes":               r_notes or None,
                                })
                                if r:
                                    # Update paid_by separately if needed
                                    if payer_options.get(r_payer):
                                        api("PATCH", f"/api/v1/rental/ledger/{lid}", json={
                                            "paid_by_tenant_id": payer_options.get(r_payer)
                                        })
                                    new_total = r.get("total_paid", 0)
                                    new_status = r.get("status", "partial")
                                    if new_status == "paid":
                                        st.success(f"✅ Fully paid! Total collected: ${new_total:,.0f}")
                                    else:
                                        st.info(f"🟠 Partial — ${new_total:,.0f} of ${amount_due:,.0f} collected.")
                                    st.rerun()
        
                    with tab2:
                        with st.form(f"promise_pay_{lid}"):
                            pr1, pr2 = st.columns(2)
                            pr_date   = pr1.date_input("Promised Date")
                            pr_amount = pr2.number_input("Promised Amount ($)", value=float(row["amount_due"]), min_value=0.0)
                            pr_notes  = st.text_input("Notes")
                            if st.form_submit_button("Save Promise"):
                                api("PATCH", f"/api/v1/rental/ledger/{lid}", json={
                                    "status":          "promised",
                                    "promised_date":   pr_date.isoformat(),
                                    "promised_amount": pr_amount,
                                    "notes":           pr_notes or None,
                                })
                                st.success("Promise recorded.")
                                st.rerun()
        
                    with tab3:
                        transactions = api("GET", f"/api/v1/rental/ledger/{lid}/transactions") or []
                        if not transactions:
                            st.caption("No individual payment records yet. Payments recorded using 'Record Payment' will appear here.")
                        else:
                            total_tx = sum(float(t["amount"]) for t in transactions)
                            st.caption(f"{len(transactions)} payment(s) — Total recorded: **${total_tx:,.2f}**")
                            for tx in transactions:
                                method = tx.get("payment_method_label") or tx.get("payment_method_code") or "—"
                                notes  = f" — {tx['notes']}" if tx.get("notes") else ""
                                st.markdown(f"✅ **{tx['paid_date']}** &nbsp;|&nbsp; **${float(tx['amount']):,.2f}** &nbsp;|&nbsp; {method}{notes}")


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: MAINTENANCE
# ─────────────────────────────────────────────────────────────────────────────

def page_maintenance():
    st.title("🔧 Maintenance")

    today      = date.today()
    # Load maintenance categories ref
    cats = api("GET", "/api/v1/rental/ref/maintenance-categories") or []
    cat_opts = {c["name"]: c["category_id"] for c in cats}

    vendors    = api("GET", "/api/v1/rental/vendors") or []
    vendor_opts = {"None": None, **{v["company_name"]: v["vendor_id"] for v in vendors}}
    properties = api("GET", "/api/v1/rental/properties") or []
    all_units  = []
    for prop in properties:
        units = api("GET", f"/api/v1/rental/properties/{prop['property_id']}/units") or []
        for u in units:
            all_units.append({**u, "property_address": prop["address"], "property_id": prop["property_id"]})

    tab_tasks, tab_requests = st.tabs(["Recurring Tasks", "Tenant Requests"])

    with tab_tasks:
        with st.expander("➕ Add Recurring Task"):
            with st.form("add_task"):
                tc1, tc2 = st.columns(2)
                t_name = tc1.text_input("Task Name*")
                t_cat  = tc2.selectbox("Category", list(cat_opts.keys()))
                tc3, tc4 = st.columns(2)
                t_freq = tc3.number_input("Repeat every (days)", min_value=1, value=90)
                t_next = tc4.date_input("Next Due Date", value=today)
                t_desc = st.text_area("Description", height=68)
                scope  = st.radio("Scope", ["Property-level", "Unit-level"], horizontal=True)
                if scope == "Property-level":
                    prop_scope_opts = {p["address"]: p["property_id"] for p in properties}
                    if prop_scope_opts:
                        sel_prop  = st.selectbox("Property", list(prop_scope_opts.keys()))
                        t_prop_id, t_unit_id = prop_scope_opts[sel_prop], None
                    else:
                        st.info("No properties found.")
                        t_prop_id, t_unit_id = None, None
                else:
                    unit_opts = {f"{u['property_address']} — Unit {u['unit_number']}": u["unit_id"] for u in all_units}
                    if unit_opts:
                        sel_unit  = st.selectbox("Unit", list(unit_opts.keys()))
                        t_unit_id, t_prop_id = unit_opts[sel_unit], None
                    else:
                        st.info("No units found.")
                        t_unit_id, t_prop_id = None, None
                if st.form_submit_button("Add Task"):
                    if t_name:
                        r = api("POST", "/api/v1/rental/maintenance/tasks", json={
                            "task_name": t_name, "category_id": cat_opts.get(t_cat), "description": t_desc or None,
                            "frequency_days": t_freq, "next_due_date": t_next.isoformat(),
                            "property_id": t_prop_id, "unit_id": t_unit_id,
                        })
                        if r:
                            st.success("Recurring task was added.")
                            st.rerun()

        tasks = api("GET", "/api/v1/rental/maintenance/tasks") or []

        # Quick filters
        task_filter = st.radio(
            "Show",
            ["All", "Overdue", "Due this month", "Due next month"],
            horizontal=True,
            key="task_filter",
        )

        from datetime import date as _date
        _today = _date.today()
        _month_start = _today.replace(day=1)
        # First day of next month
        _next_month = (_month_start.replace(month=_month_start.month % 12 + 1)
                       if _month_start.month < 12
                       else _month_start.replace(year=_month_start.year + 1, month=1))
        _next_month_end = (_next_month.replace(month=_next_month.month % 12 + 1)
                           if _next_month.month < 12
                           else _next_month.replace(year=_next_month.year + 1, month=1))

        def _parse_due(t):
            try:
                return _date.fromisoformat(t["next_due_date"]) if t.get("next_due_date") else None
            except Exception:
                return None

        if task_filter == "Overdue":
            tasks = [t for t in tasks if isinstance(t.get("days_until_due"), int) and t["days_until_due"] < 0]
        elif task_filter == "Due this month":
            tasks = [t for t in tasks if (d := _parse_due(t)) and _month_start <= d < _next_month]
        elif task_filter == "Due next month":
            tasks = [t for t in tasks if (d := _parse_due(t)) and _next_month <= d < _next_month_end]

        if not tasks:
            st.info(f"No tasks match '{task_filter}'.")
        else:
            for t in tasks:
                tid  = t["task_id"]
                days = t["days_until_due"]
                if isinstance(days, int) and days < 0:
                    urgency = f"🔴 OVERDUE {abs(days)} day(s)"
                elif isinstance(days, int) and days <= 7:
                    urgency = f"🟡 Due in {days} day(s)"
                else:
                    urgency = f"🟢 Due {t['next_due_date']}"
                loc = (t.get("property_address") or "") + (f" Unit {t['unit_number']}" if t.get("unit_number") else "")

                with st.expander(f"{urgency} | **{t['task_name']}** | {loc}"):
                    mc1, mc2 = st.columns(2)
                    with mc1:
                        with st.form(f"complete_task_{tid}"):
                            st.markdown("**Mark Complete**")
                            c_date   = st.date_input("Completed", value=today, key=f"cd_{tid}")
                            c_vendor = st.selectbox("Vendor", list(vendor_opts.keys()), key=f"cv_{tid}")
                            # Person who completed — from authorized persons
                            persons = api("GET", "/api/v1/rental/persons") or []
                            person_opts = {"— None —": None, **{
                                f"{p['first_name']} {p['last_name']} ({p['role']})": p["person_id"]
                                for p in persons
                            }}
                            c_person = st.selectbox("Completed By", list(person_opts.keys()), key=f"cp_{tid}")
                            c_notes  = st.text_input("Notes", key=f"cn_{tid}")
                            if st.form_submit_button("Mark Complete"):
                                api("POST", f"/api/v1/rental/maintenance/tasks/{tid}/complete", json={
                                    "completed_date":         c_date.isoformat(),
                                    "vendor_id":              vendor_opts[c_vendor],
                                    "completed_by_person_id": person_opts[c_person],
                                    "notes":                  c_notes or None,
                                })
                                st.success("Marked complete.")
                                st.rerun()
                    with mc2:
                        with st.form(f"edit_task_{tid}"):
                            st.markdown("**Edit Task**")
                            e_name = st.text_input("Name", value=t["task_name"], key=f"tn_{tid}")
                            e_freq = st.number_input("Frequency (days)", value=t.get("frequency_days") or 90, key=f"tf_{tid}")
                            e_next = st.date_input("Next Due", value=date.fromisoformat(t["next_due_date"]) if t.get("next_due_date") else today, key=f"tnd_{tid}")
                            if st.form_submit_button("Save"):
                                api("PATCH", f"/api/v1/rental/maintenance/tasks/{tid}", json={
                                    "task_name": e_name, "frequency_days": e_freq,
                                    "next_due_date": e_next.isoformat(),
                                })
                                st.rerun()

                        st.markdown("---")
                        if st.button("🗑️ Delete Task", key=f"del_{tid}", type="secondary"):
                            if st.session_state.get(f"confirm_del_{tid}"):
                                api("DELETE", f"/api/v1/rental/maintenance/tasks/{tid}")
                                st.session_state.pop(f"confirm_del_{tid}", None)
                                st.rerun()
                            else:
                                st.session_state[f"confirm_del_{tid}"] = True
                                st.rerun()
                        if st.session_state.get(f"confirm_del_{tid}"):
                            st.warning("Are you sure? Click Delete Task again to confirm.")


                    # Completion history
                    with st.expander(f"📋 Completion History"):
                        records = api("GET", f"/api/v1/rental/maintenance/tasks/{tid}/records") or []
                        if not records:
                            st.caption("No completions recorded yet.")
                        else:
                            for rec in records:
                                who = rec.get("person_name") or rec.get("vendor_name") or rec.get("completed_by") or "—"
                                role = f" ({rec['person_role']})" if rec.get("person_role") else ""
                                notes = f" — {rec['notes']}" if rec.get("notes") else ""
                                st.markdown(f"✅ **{rec['completed_date']}** — {who}{role}{notes}")

    with tab_requests:
        tenants = api("GET", "/api/v1/rental/tenants") or []
        with st.expander("➕ Log New Request"):
            with st.form("add_request"):
                PRIORITIES = ["low", "normal", "high", "urgent"]
                unit_opts  = {f"{u['property_address']} — Unit {u['unit_number']}": u["unit_id"] for u in all_units}
                t_opts     = {"None": None, **{f"{t['first_name']} {t['last_name']}": t["tenant_id"] for t in tenants}}
                rc1, rc2   = st.columns(2)
                r_unit   = rc1.selectbox("Unit", list(unit_opts.keys()))
                r_tenant = rc2.selectbox("Reported By", list(t_opts.keys()))
                rc3, rc4 = st.columns(2)
                r_prio   = rc3.selectbox("Priority", PRIORITIES, index=1)
                r_vendor = rc4.selectbox("Vendor", list(vendor_opts.keys()))
                r_desc   = st.text_area("Description*", height=80)
                r_est    = st.date_input("Est. Completion (optional)", value=None)
                if st.form_submit_button("Log Request"):
                    if r_desc:
                        r = api("POST", "/api/v1/rental/maintenance/requests", json={
                            "unit_id":   unit_opts[r_unit],
                            "tenant_id": t_opts[r_tenant],
                            "vendor_id": vendor_opts[r_vendor],
                            "description": r_desc, "priority": r_prio,
                            "estimated_completion_date": r_est.isoformat() if r_est else None,
                        })
                        if r:
                            st.success("Request logged.")
                            st.rerun()

        status_filter = st.selectbox("Filter", ["All", "open", "in_progress", "completed", "cancelled"])
        params = {"status": status_filter} if status_filter != "All" else {}
        requests_list = api("GET", "/api/v1/rental/maintenance/requests", params=params) or []
        PRIORITY_ICONS = {"urgent": "🔴", "high": "🟠", "normal": "🟡", "low": "🟢"}

        for r in requests_list:
            rid  = r["request_id"]
            icon = PRIORITY_ICONS.get(r["priority"], "⚪")
            loc  = f"{r.get('property_address', '')} Unit {r.get('unit_number', '')}"
            with st.expander(f"{icon} {r['priority'].upper()} | **{r['description'][:60]}** | {loc} | {r['status'].upper()}"):
                ic1, ic2, ic3 = st.columns(3)
                ic1.markdown(f"**Reported By:** {r.get('reported_by') or '—'}")
                ic2.markdown(f"**Reported:** {r['reported_date']}")
                ic3.markdown(f"**Vendor:** {r.get('assigned_vendor') or 'Unassigned'}")
                with st.form(f"update_req_{rid}"):
                    STATUSES = ["open", "in_progress", "completed", "cancelled"]
                    uc1, uc2 = st.columns(2)
                    u_status = uc1.selectbox("Status", STATUSES,
                                              index=STATUSES.index(r["status"]) if r["status"] in STATUSES else 0,
                                              key=f"rs_{rid}")
                    u_vendor = uc2.selectbox("Vendor", list(vendor_opts.keys()),
                                              index=list(vendor_opts.keys()).index(r.get("assigned_vendor") or "None")
                                              if r.get("assigned_vendor") in vendor_opts else 0,
                                              key=f"rv_{rid}")
                    u_est    = st.date_input("Est. Completion", value=None, key=f"re_{rid}")
                    u_actual = st.date_input("Actual Completion", value=None, key=f"ra_{rid}")
                    u_notes  = st.text_input("Notes", value=r.get("notes") or "", key=f"rn_{rid}")
                    if st.form_submit_button("Update"):
                        payload = {"status": u_status, "vendor_id": vendor_opts[u_vendor], "notes": u_notes or None}
                        if u_est:    payload["estimated_completion_date"] = u_est.isoformat()
                        if u_actual: payload["actual_completion_date"]    = u_actual.isoformat()
                        api("PATCH", f"/api/v1/rental/maintenance/requests/{rid}", json=payload)
                        st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: EXPENSES
# ─────────────────────────────────────────────────────────────────────────────

def page_expenses():
    st.title("💰 Expenses")

    # Shared data
    exp_types = api("GET", "/api/v1/rental/ref/expense-types") or []
    type_opts = {et["name"]: et["type_id"] for et in exp_types}
    expense_type_labels = list(type_opts.keys())

    today      = date.today()
    properties = api("GET", "/api/v1/rental/properties") or []
    prop_opts  = {"All Properties": None, **{p["address"]: p["property_id"] for p in properties}}

    tab_expenses, tab_fixed = st.tabs(["📋 Expenses", "📌 Fixed Costs"])

    with tab_expenses:
        MONTH_NAMES = {
            "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
            "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
            "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec"
        }
        month_display = ["All"] + list(MONTH_NAMES.values())
        month_values  = ["All"] + list(MONTH_NAMES.keys())

        fc1, fc2, fc3, fc4 = st.columns(4)
        sel_prop       = fc1.selectbox("Property", list(prop_opts.keys()))
        sel_type       = fc2.selectbox("Type", ["All"] + expense_type_labels)
        sel_year       = fc3.selectbox("Year", ["All"] + list(range(today.year, today.year - 5, -1)))
        sel_month_name = fc4.selectbox("Month", month_display)
        sel_month      = month_values[month_display.index(sel_month_name)]

        summary_params = {"year": sel_year if sel_year != "All" else today.year}
        if sel_month != "All":
            summary_params["month"] = int(sel_month)
        if prop_opts.get(sel_prop):
            summary_params["property_id"] = prop_opts[sel_prop]
        if sel_type != "All" and type_opts.get(sel_type):
            summary_params["expense_type_id"] = type_opts[sel_type]

        year_param = summary_params["year"]
        summary = api("GET", "/api/v1/rental/expenses/summary", params=summary_params)
        if summary and summary.get("by_type"):
            import plotly.express as px
            with st.expander("📊 Expense Insights — by category", expanded=False):
                filter_parts = []
                if sel_prop != "All Properties":
                    filter_parts.append(sel_prop)
                if sel_type != "All":
                    filter_parts.append(sel_type)
                if sel_month_name != "All":
                    filter_parts.append(sel_month_name)
                filter_parts.append(str(year_param))
                filter_label = " · ".join(filter_parts)
                st.metric(f"Total Expenses ({filter_label})", f"${summary['total']:,.0f}")
                chart_data = pd.DataFrame(summary["by_type"]).head(10)
                chart_data["total"] = chart_data["total"].astype(float)
                chart_data = chart_data.sort_values("total", ascending=True)
                fig = px.bar(chart_data, x="total", y="expense_type",
                             orientation="h", height=min(60 + len(chart_data) * 40, 350),
                             labels={"total": "", "expense_type": ""},
                             text=chart_data["total"].apply(lambda v: f"${v:,.0f}"))
                fig.update_traces(
                    textposition="outside",
                    hovertemplate="<b>%{y}</b> — $%{x:,.0f}<extra></extra>",
                )
                fig.update_layout(
                    xaxis=dict(visible=False, showticklabels=False, showgrid=False, zeroline=False),
                    yaxis_title="",
                    showlegend=False,
                    plot_bgcolor="rgba(0,0,0,0)",
                    margin=dict(l=120, r=60, t=10, b=10),
                    dragmode=False,
                )
                fig.update_xaxes(fixedrange=True)
                fig.update_yaxes(fixedrange=True)
                config = {
                    "displayModeBar": True,
                    "modeBarButtonsToRemove": [
                        "zoom2d", "pan2d", "select2d", "lasso2d", "zoomIn2d", "zoomOut2d",
                        "autoScale2d", "resetScale2d", "hoverClosestCartesian",
                        "hoverCompareCartesian", "toggleSpikelines", "toImage"
                    ],
                    "scrollZoom": False,
                    "displaylogo": False,
                }
                st.plotly_chart(fig, use_container_width=True, config=config)

        vendors = api("GET", "/api/v1/rental/vendors") or []
        vendor_opts = {"— None —": None, **{v["company_name"]: v["vendor_id"] for v in vendors}}

        with st.expander("➕ Add Expense"):
            with st.form("add_expense"):
                ac1, ac2, ac3 = st.columns(3)
                a_date   = ac1.date_input("Date*", value=today)
                a_type   = ac2.selectbox("Type*", expense_type_labels)
                a_amount = ac3.number_input("Amount ($)*", min_value=0.0, step=1.0, format="%.2f")
                ac4, ac5, ac6 = st.columns(3)
                a_prop    = ac4.selectbox("Property", list(prop_opts.keys()))
                a_vendor  = ac5.selectbox("Vendor (optional)", list(vendor_opts.keys()))
                a_receipt = ac6.text_input("Receipt #")
                a_drive   = st.text_input("Google Drive URL")
                a_notes   = st.text_area("Notes", height=68)
                if st.form_submit_button("Add Expense"):
                    if a_amount > 0:
                        r = api("POST", "/api/v1/rental/expenses", json={
                            "property_id":     prop_opts[a_prop],
                            "expense_date":    a_date.isoformat(),
                            "expense_type_id": type_opts.get(a_type),
                            "amount":          a_amount,
                            "vendor_id":       vendor_opts[a_vendor],
                            "receipt_number":  a_receipt or None,
                            "drive_url":       a_drive or None,
                            "notes":           a_notes or None,
                        })
                        if r:
                            st.success("Expense added.")
                            st.rerun()
                    else:
                        st.warning("Amount must be greater than zero.")

        params = {}
        if prop_opts[sel_prop]:
            params["property_id"] = prop_opts[sel_prop]
        if sel_type != "All":
            params["expense_type"] = sel_type
        if sel_year != "All":
            params["year"] = sel_year
        if sel_month != "All":
            params["month"] = int(sel_month)

        expenses = api("GET", "/api/v1/rental/expenses", params=params) or []
        if not expenses:
            st.info("No expenses found for the selected filters.")
        else:
            total_filtered = sum(float(e["amount"]) for e in expenses)
            st.markdown(f"**{len(expenses)} records — Total: ${total_filtered:,.0f}**")
            st.markdown("---")

            for e in expenses:
                eid         = e["expense_id"]
                prop        = e.get("property_address") or "General"
                receipt     = e.get("receipt_number") or ""
                drive       = e.get("drive_url")
                type_name   = e.get("type_name") or e.get("expense_type") or "—"
                vendor_name = e.get("vendor_name") or ""
                vendor_label   = f" | {vendor_name}" if vendor_name else ""
                receipt_header = f" | {receipt}" if receipt else ""
                with st.expander(f"**{e['expense_date']}** | {type_name} | **${float(e['amount']):,.2f}** | {prop}{vendor_label}{receipt_header}"):
                    if drive:
                        st.link_button(f"📄 Open Receipt {receipt}".strip(), url=drive)
                    if e.get("notes"):
                        st.caption(f"Notes: {e['notes']}")
                    with st.form(f"edit_expense_{eid}"):
                        ec1, ec2, ec3 = st.columns(3)
                        e_date   = ec1.date_input("Date", value=date.fromisoformat(e["expense_date"]), key=f"ed_{eid}")
                        _e_type_name = e.get("type_name") or e.get("expense_type", "")
                        e_type   = ec2.selectbox("Type", expense_type_labels,
                                                  index=expense_type_labels.index(_e_type_name) if _e_type_name in expense_type_labels else 0,
                                                  key=f"et_{eid}")
                        e_amount = ec3.number_input("Amount ($)", value=float(e["amount"]), min_value=0.0, step=1.0, format="%.2f", key=f"ea_{eid}")
                        ec4, ec5, ec6 = st.columns(3)
                        e_prop   = ec4.selectbox("Property", list(prop_opts.keys()),
                                                  index=list(prop_opts.keys()).index(e.get("property_address") or "All Properties")
                                                  if e.get("property_address") in prop_opts else 0,
                                                  key=f"ep_{eid}")
                        cur_vendor = e.get("vendor_name") or "— None —"
                        e_vendor = ec5.selectbox("Vendor", list(vendor_opts.keys()),
                                                  index=list(vendor_opts.keys()).index(cur_vendor)
                                                  if cur_vendor in vendor_opts else 0,
                                                  key=f"ev_{eid}")
                        e_receipt = ec6.text_input("Receipt #", value=e.get("receipt_number") or "", key=f"er_{eid}")
                        e_drive   = st.text_input("Google Drive URL", value=e.get("drive_url") or "", key=f"edr_{eid}")
                        e_notes   = st.text_area("Notes", value=e.get("notes") or "", height=68, key=f"en_{eid}")
                        sc1, sc2 = st.columns([1, 5])
                        if sc1.form_submit_button("Save"):
                            api("PATCH", f"/api/v1/rental/expenses/{eid}", json={
                                "property_id":     prop_opts[e_prop],
                                "expense_date":    e_date.isoformat(),
                                "expense_type_id": type_opts.get(e_type),
                                "amount":          e_amount,
                                "vendor_id":       vendor_opts[e_vendor],
                                "receipt_number":  e_receipt or None,
                                "drive_url":       e_drive or None,
                                "notes":           e_notes or None,
                            })
                            st.success("Saved.")
                            st.rerun()
                        if sc2.form_submit_button("🗑 Delete", type="secondary"):
                            api("DELETE", f"/api/v1/rental/expenses/{eid}")
                            st.rerun()

    # ═══════════════════════════════════════════════════════════════════════════
    # TAB 2 — FIXED COSTS
    # ═══════════════════════════════════════════════════════════════════════════
    with tab_fixed:
        vendors_fc = api("GET", "/api/v1/rental/vendors") or []
        vendor_opts_fc = {"— None —": None, **{v["company_name"]: v["vendor_id"] for v in vendors_fc}}
        prop_opts_fc   = {"— General (no property) —": None, **{p["address"]: p["property_id"] for p in properties}}

        # Generate strip
        gc1, gc2, gc3 = st.columns([2, 1, 3])
        gen_month_fc = gc1.selectbox(
            "Generate fixed costs for month",
            [f"{y}-{m:02d}" for y in [today.year, today.year + 1] for m in range(1, 13)],
            index=[f"{y}-{m:02d}" for y in [today.year, today.year + 1] for m in range(1, 13)].index(
                f"{today.year}-{today.month:02d}"
            ),
            key="gen_month_fc",
        )
        if gc2.button("⚡ Generate", use_container_width=True, key="gen_fc"):
            r = api("POST", f"/api/v1/rental/fixed-costs/generate", params={"month": gen_month_fc})
            if r is not None:
                created = r.get("created", 0)
                if created > 0:
                    gc3.success(f"✅ {created} expense entries generated for {gen_month_fc}.")
                else:
                    gc3.info(f"All fixed costs for {gen_month_fc} already exist — nothing new created.")

        st.markdown("---")

        with st.expander("➕ Add Fixed Cost"):
            with st.form("add_fixed_cost"):
                nc1, nc2 = st.columns(2)
                fc_name   = nc1.text_input("Name*", placeholder="e.g. TD Mortgage — 123 Main St")
                fc_type   = nc2.selectbox("Expense Type", expense_type_labels)
                nc3, nc4, nc5 = st.columns(3)
                fc_amount = nc3.number_input("Amount ($)*", min_value=0.0, step=1.0, format="%.2f")
                fc_freq   = nc4.selectbox("Frequency", ["monthly", "annual"])
                fc_start  = nc5.date_input("Starts", value=today.replace(day=1))
                nc6, nc7 = st.columns(2)
                fc_prop   = nc6.selectbox("Property", list(prop_opts_fc.keys()))
                fc_vendor = nc7.selectbox("Vendor (optional)", list(vendor_opts_fc.keys()))
                fc_notes  = st.text_input("Notes (optional)")
                if st.form_submit_button("Add Fixed Cost"):
                    if fc_name and fc_amount > 0:
                        r = api("POST", "/api/v1/rental/fixed-costs", json={
                            "name":            fc_name,
                            "expense_type_id": type_opts.get(fc_type),
                            "property_id":     prop_opts_fc[fc_prop],
                            "vendor_id":       vendor_opts_fc[fc_vendor],
                            "amount":          fc_amount,
                            "frequency":       fc_freq,
                            "start_date":      fc_start.isoformat(),
                            "notes":           fc_notes or None,
                        })
                        if r:
                            st.success("Fixed cost added.")
                            st.rerun()
                    else:
                        st.warning("Name and amount are required.")

        fixed_costs = api("GET", "/api/v1/rental/fixed-costs") or []

        if not fixed_costs:
            st.info("No fixed costs defined yet. Add one above.")
        else:
            active_costs   = [fc for fc in fixed_costs if fc.get("active")]
            inactive_costs = [fc for fc in fixed_costs if not fc.get("active")]

            monthly_total = sum(
                float(fc["amount"]) for fc in active_costs if fc["frequency"] == "monthly"
            )
            annual_total = sum(
                float(fc["amount"]) for fc in active_costs if fc["frequency"] == "annual"
            )
            sm1, sm2, sm3 = st.columns(3)
            sm1.metric("Active fixed costs", len(active_costs))
            sm2.metric("Monthly total", f"${monthly_total:,.0f}/mo")
            sm3.metric("Annual total", f"${annual_total:,.0f}/yr")
            st.markdown("---")

            for fc in active_costs + inactive_costs:
                fid      = fc["fixed_cost_id"]
                prop_lbl = fc.get("property_address") or "General"
                freq_lbl = "📅 Monthly" if fc["frequency"] == "monthly" else "🗓 Annual"
                active   = fc.get("active", True)
                status_icon = "" if active else " 🚫 Inactive"
                with st.expander(f"**{fc['name']}** | ${float(fc['amount']):,.0f} | {freq_lbl} | {prop_lbl}{status_icon}"):
                    with st.form(f"edit_fc_{fid}"):
                        ef1, ef2 = st.columns(2)
                        ef_name   = ef1.text_input("Name", value=fc["name"], key=f"fcn_{fid}")
                        ef_type   = ef2.selectbox("Type", expense_type_labels,
                                                   index=expense_type_labels.index(fc.get("expense_type_name", "")) if fc.get("expense_type_name") in expense_type_labels else 0,
                                                   key=f"fct_{fid}")
                        ef3, ef4, ef5 = st.columns(3)
                        ef_amount = ef3.number_input("Amount ($)", value=float(fc["amount"]), min_value=0.0, step=1.0, format="%.2f", key=f"fca_{fid}")
                        ef_freq   = ef4.selectbox("Frequency", ["monthly", "annual"],
                                                   index=0 if fc["frequency"] == "monthly" else 1,
                                                   key=f"fcf_{fid}")
                        ef_start  = ef5.date_input("Starts", value=date.fromisoformat(fc["start_date"]) if fc.get("start_date") else today, key=f"fcs_{fid}")
                        ef6, ef7 = st.columns(2)
                        ef_prop   = ef6.selectbox("Property", list(prop_opts_fc.keys()),
                                                   index=list(prop_opts_fc.keys()).index(fc.get("property_address") or "— General (no property) —")
                                                   if fc.get("property_address") in prop_opts_fc else 0,
                                                   key=f"fcp_{fid}")
                        cur_fc_vendor = fc.get("vendor_name") or "— None —"
                        ef_vendor = ef7.selectbox("Vendor", list(vendor_opts_fc.keys()),
                                                   index=list(vendor_opts_fc.keys()).index(cur_fc_vendor)
                                                   if cur_fc_vendor in vendor_opts_fc else 0,
                                                   key=f"fcv_{fid}")
                        ef_notes  = st.text_input("Notes", value=fc.get("notes") or "", key=f"fcno_{fid}")
                        ef_active = st.checkbox("Active", value=active, key=f"fcac_{fid}")
                        btn1, btn2 = st.columns([1, 5])
                        if btn1.form_submit_button("Save"):
                            api("PATCH", f"/api/v1/rental/fixed-costs/{fid}", json={
                                "name":            ef_name,
                                "expense_type_id": type_opts.get(ef_type),
                                "property_id":     prop_opts_fc[ef_prop],
                                "vendor_id":       vendor_opts_fc[ef_vendor],
                                "amount":          ef_amount,
                                "frequency":       ef_freq,
                                "start_date":      ef_start.isoformat(),
                                "notes":           ef_notes or None,
                                "active":          ef_active,
                            })
                            st.success("Saved.")
                            st.rerun()
                        if btn2.form_submit_button("🗑 Delete", type="secondary"):
                            api("DELETE", f"/api/v1/rental/fixed-costs/{fid}")
                            st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: VENDORS
# ─────────────────────────────────────────────────────────────────────────────

def page_vendors():
    st.title("🏪 Vendors")

    with st.expander("➕ Add Vendor"):
        with st.form("add_vendor"):
            c1, c2 = st.columns(2)
            v_company = c1.text_input("Company Name*")
            v_contact = c2.text_input("Contact Name")
            c3, c4, c5 = st.columns(3)
            v_phone = c3.text_input("Phone")
            v_email = c4.text_input("Email")
            v_trade = c5.selectbox("Trade", TRADES)
            v_notes = st.text_area("Notes", height=68)
            if st.form_submit_button("Add Vendor"):
                if v_company:
                    r = api("POST", "/api/v1/rental/vendors", json={
                        "company_name": v_company, "contact_name": v_contact or None,
                        "phone": v_phone or None, "email": v_email or None,
                        "trade": v_trade, "notes": v_notes or None,
                    })
                    if r:
                        st.success("Vendor added.")
                        st.rerun()

    vendors = api("GET", "/api/v1/rental/vendors") or []
    for v in vendors:
        vid = v["vendor_id"]
        with st.expander(f"**{v['company_name']}** — {v['trade']} | {v['contact_name'] or ''} | Invoices: {v['invoice_count']} | Paid: ${float(v['total_paid']):,.0f}"):
            with st.form(f"edit_vendor_{vid}"):
                c1, c2 = st.columns(2)
                nc = c1.text_input("Company", value=v["company_name"])
                nct = c2.text_input("Contact", value=v["contact_name"] or "")
                c3, c4, c5 = st.columns(3)
                np = c3.text_input("Phone", value=fmt_phone(v["phone"]) or "")
                ne = c4.text_input("Email", value=v["email"] or "")
                nt = c5.selectbox("Trade", TRADES, index=TRADES.index(v["trade"]) if v["trade"] in TRADES else 0)
                nn = st.text_area("Notes", value=v["notes"] or "", height=68)
                if st.form_submit_button("Save"):
                    api("PATCH", f"/api/v1/rental/vendors/{vid}", json={
                        "company_name": nc, "contact_name": nct or None,
                        "phone": np or None, "email": ne or None, "trade": nt, "notes": nn or None,
                    })
                    st.success("Saved.")
                    st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: LEASE TASKS & RENEWALS
# ─────────────────────────────────────────────────────────────────────────────

def page_lease_tasks():
    st.title("📅 Lease Tasks & Renewals")
    tasks = api("GET", "/api/v1/rental/lease-tasks") or []

    if not tasks:
        st.info("No open lease tasks.")
        return

    for t in tasks:
        tid = t["task_id"]
        days = (date.fromisoformat(t["due_date"]) - date.today()).days
        if days < 0:
            urgency = f"🔴 OVERDUE {abs(days)}d"
        elif days <= 14:
            urgency = f"🟡 {days}d remaining"
        else:
            urgency = f"🟢 {days}d remaining"

        header = f"{urgency} | **{t.get('task_type','').replace('_',' ').title()}** | {t.get('address','')} — {t.get('space_name','')} | Due: {t['due_date']}"
        with st.expander(header):
            if t.get('notes'):
                st.caption(t['notes'])
            with st.form(f"task_{tid}"):
                c1, c2 = st.columns(2)
                new_status = c1.selectbox("Status", ["open","done","dismissed"],
                    index=["open","done","dismissed"].index(t["status"]) if t["status"] in ["open","done","dismissed"] else 0)
                new_notes = c2.text_input("Notes", value=t.get("notes") or "")
                if st.form_submit_button("Update"):
                    api("PATCH", f"/api/v1/rental/lease-tasks/{tid}", json={"status": new_status, "notes": new_notes or None})
                    st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: LEGAL NOTICES
# ─────────────────────────────────────────────────────────────────────────────

def page_notices():
    st.title("⚖️ Legal Notices")

    # Load ref data
    notice_types = api("GET", "/api/v1/rental/ref/notice-types") or []
    service_methods = api("GET", "/api/v1/rental/ref/service-methods") or []
    leases = api("GET", "/api/v1/rental/leases") or []
    tenants = api("GET", "/api/v1/rental/tenants") or []

    notice_type_opts = {f"{n['code']} — {n['description']}": n["notice_type_id"] for n in notice_types}
    service_opts = {s["name"]: s["method_id"] for s in service_methods}
    lease_opts = {f"{l['address']} — {l['space_name']}": l["lease_id"] for l in leases}
    tenant_opts = {f"{t['first_name']} {t['last_name']}": t["tenant_id"] for t in tenants}

    # Add notice form
    with st.expander("➕ Issue Legal Notice"):
        with st.form("add_notice"):
            c1, c2 = st.columns(2)
            sel_lease = c1.selectbox("Lease*", list(lease_opts.keys()))
            sel_type = c2.selectbox("Notice Type*", list(notice_type_opts.keys()))
            c3, c4 = st.columns(2)
            notice_date = c3.date_input("Date of Notice*", value=date.today())
            sel_service = c4.selectbox("How Served*", list(service_opts.keys()))
            # Served by — pick from authorized persons or type manually
            persons = api("GET", "/api/v1/rental/persons") or []
            person_opts = {f"{p['first_name']} {p['last_name']} ({p['role']})": f"{p['first_name']} {p['last_name']}"
                           for p in persons}
            if person_opts:
                person_opts["✏️ Type manually…"] = "__manual__"
                sel_person = st.selectbox("Served By*", list(person_opts.keys()))
                if person_opts[sel_person] == "__manual__":
                    served_by = st.text_input("Enter name manually*")
                else:
                    served_by = person_opts[sel_person]
            else:
                served_by = st.text_input("Served By (landlord name or representative)*",
                                           help="Add people on the Persons page to use a dropdown here.")
            c5, c6 = st.columns(2)
            compliance_date = c5.date_input("Compliance Date (deadline to comply — optional)", value=None)
            drive_url = c6.text_input("Google Drive URL (PDF — optional)")

            # Tenant recipients
            selected_tenants = st.multiselect("Recipients (tenants)*", list(tenant_opts.keys()))
            notes = st.text_area("Notes", height=68)

            if st.form_submit_button("Issue Notice"):
                if served_by and selected_tenants:
                    r = api("POST", "/api/v1/rental/legal-notices", json={
                        "lease_id":          lease_opts[sel_lease],
                        "notice_type_id":    notice_type_opts[sel_type],
                        "notice_date":       notice_date.isoformat(),
                        "served_by":         served_by,
                        "service_method_id": service_opts[sel_service],
                        "compliance_date":   compliance_date.isoformat() if compliance_date else None,
                        "drive_url":         drive_url or None,
                        "notes":             notes or None,
                        "tenant_ids":        [tenant_opts[t] for t in selected_tenants]
                    })
                    if r:
                        st.success("Notice issued.")
                        st.rerun()
                else:
                    st.warning("Served by and at least one recipient are required.")

    # List existing notices
    notices = api("GET", "/api/v1/rental/legal-notices") or []
    if not notices:
        st.info("No legal notices on record.")
        return

    for n in notices:
        nid    = n["notice_id"]
        status = n.get("status", "active")
        status_icon = {"active": "🟡", "void": "⚪", "escalated": "🔴"}.get(status, "🟡")
        doc_icon = "📄 " if n.get("drive_url") else ""

        # Compliance date warning
        compliance_flag = ""
        if n.get("compliance_date") and status == "active":
            days_left = (date.fromisoformat(n["compliance_date"]) - date.today()).days
            if days_left < 0:
                compliance_flag = f" 🔴 OVERDUE {abs(days_left)}d"
            elif days_left <= 3:
                compliance_flag = f" 🟠 {days_left}d left"

        header = (f"{status_icon} {doc_icon}**{n.get('notice_type_code','?')}** | "
                  f"{n.get('address','')} — {n.get('space_name','')} | "
                  f"{n['notice_date']}{compliance_flag} | {status.upper()}")

        with st.expander(header):
            st.caption(n.get('notice_type_name', ''))

            ic1, ic2, ic3 = st.columns(3)
            ic1.markdown(f"**Served by:** {n['served_by']}")
            ic2.markdown(f"**Service Method:** {n.get('service_method_name','—')}")
            ic3.markdown(f"**Recipients:** {', '.join(n.get('recipients', []))}")

            if n.get("compliance_date"):
                st.markdown(f"**Compliance Deadline:** {n['compliance_date']}")

            if n.get("drive_url"):
                st.markdown(f"📄 **Notice Document:** [Open in Google Drive]({n['drive_url']})")

            if n.get("notes"):
                st.caption(f"Notes: {n['notes']}")

            st.markdown("---")
            ac1, ac2, ac3 = st.columns(3)

            # Mark as Void (tenant complied)
            if status != "void":
                if ac1.button("✅ Mark Void (complied)", key=f"void_{nid}"):
                    api("PATCH", f"/api/v1/rental/legal-notices/{nid}", json={"status": "void"})
                    st.rerun()

            # Mark as Escalated
            if status == "active":
                if ac2.button("⬆️ Mark Escalated", key=f"esc_{nid}"):
                    api("PATCH", f"/api/v1/rental/legal-notices/{nid}", json={"status": "escalated"})
                    st.rerun()

            # Delete
            confirm_key = f"confirm_del_notice_{nid}"
            if st.session_state.get(confirm_key):
                st.error("Permanently delete this notice record? This cannot be undone.")
                dc1, dc2 = st.columns(2)
                if dc1.button("Yes, delete", key=f"yes_del_notice_{nid}", type="primary"):
                    api("DELETE", f"/api/v1/rental/legal-notices/{nid}")
                    st.session_state.pop(confirm_key, None)
                    st.rerun()
                if dc2.button("Cancel", key=f"cancel_del_notice_{nid}"):
                    st.session_state.pop(confirm_key, None)
                    st.rerun()
            else:
                if ac3.button("🗑 Delete Record", key=f"del_notice_{nid}", type="secondary"):
                    st.session_state[confirm_key] = True
                    st.rerun()

            # Edit details
            with st.expander("✏️ Edit"):
                with st.form(f"edit_notice_{nid}"):
                    e_comp  = st.date_input("Compliance Date",
                                             value=date.fromisoformat(n["compliance_date"]) if n.get("compliance_date") else None)
                    e_url   = st.text_input("Google Drive URL", value=n.get("drive_url") or "")
                    e_notes = st.text_area("Notes", value=n.get("notes") or "", height=68)
                    if st.form_submit_button("Save"):
                        api("PATCH", f"/api/v1/rental/legal-notices/{nid}", json={
                            "compliance_date": e_comp.isoformat() if e_comp else None,
                            "drive_url":       e_url or None,
                            "notes":           e_notes or None,
                        })
                        st.success("Saved.")
                        st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# PAGE: AUTHORIZED PERSONS
# ─────────────────────────────────────────────────────────────────────────────

PERSON_ROLES = ["Landlord", "Property Manager", "Representative"]


def page_persons():
    st.title("👤 Landlords & Property Managers")
    st.caption("People authorized to act on behalf of the properties — used when issuing notices, completing tasks, etc.")

    properties = api("GET", "/api/v1/rental/properties") or []
    prop_opts  = {p["address"]: p["property_id"] for p in properties}

    with st.expander("➕ Add Person"):
        with st.form("add_person"):
            c1, c2, c3 = st.columns(3)
            first      = c1.text_input("First Name*")
            last       = c2.text_input("Last Name*")
            role       = c3.selectbox("Role", PERSON_ROLES)
            c4, c5 = st.columns(2)
            email      = c4.text_input("Email")
            phone      = c5.text_input("Phone")
            is_default = st.checkbox("Apply to all properties by default",
                                      help="If checked, this person appears in dropdowns for every property without needing manual assignment.")
            notes      = st.text_area("Notes", height=68)
            if st.form_submit_button("Add"):
                if first and last:
                    r = api("POST", "/api/v1/rental/persons", json={
                        "first_name": first, "last_name": last, "role": role,
                        "email": email or None, "phone": phone or None,
                        "is_default": is_default, "notes": notes or None,
                    })
                    if r:
                        st.success("Person added.")
                        st.rerun()
                else:
                    st.warning("First and last name are required.")

    persons = api("GET", "/api/v1/rental/persons") or []

    if not persons:
        st.info("No authorized persons yet. Add yourself above.")
        return

    for p in persons:
        pid    = p["person_id"]
        name   = f"{p['first_name']} {p['last_name']}"
        badge  = "🌐" if p["is_default"] else "🏠"
        header = f"{badge} **{name}** — {p['role']} {fmt_phone(p['phone']) or ''}"

        with st.expander(header):
            with st.form(f"edit_person_{pid}"):
                c1, c2, c3 = st.columns(3)
                nf   = c1.text_input("First Name", value=p["first_name"])
                nl   = c2.text_input("Last Name",  value=p["last_name"])
                nr   = c3.selectbox("Role", PERSON_ROLES,
                                     index=PERSON_ROLES.index(p["role"]) if p["role"] in PERSON_ROLES else 0)
                c4, c5 = st.columns(2)
                ne   = c4.text_input("Email", value=p["email"] or "")
                nph  = c5.text_input("Phone", value=fmt_phone(p["phone"]) or "")
                nd   = st.checkbox("Apply to all properties by default", value=p["is_default"])
                nn   = st.text_area("Notes", value=p["notes"] or "", height=68)
                sb1, sb2 = st.columns([1, 4])
                if sb1.form_submit_button("Save"):
                    api("PATCH", f"/api/v1/rental/persons/{pid}", json={
                        "first_name": nf, "last_name": nl, "role": nr,
                        "email": ne or None, "phone": nph or None,
                        "is_default": nd, "notes": nn or None,
                    })
                    st.success("Saved.")
                    st.rerun()

            # Property assignment (only relevant if not default)
            if not p["is_default"]:
                st.markdown("**Assigned Properties**")
                assigned_ids = set(p.get("property_ids") or [])
                for addr, prop_id in prop_opts.items():
                    is_assigned = prop_id in assigned_ids
                    ac1, ac2 = st.columns([4, 1])
                    ac1.markdown(f"{'✅' if is_assigned else '⬜'} {addr}")
                    if is_assigned:
                        if ac2.button("Remove", key=f"unassign_{pid}_{prop_id}"):
                            api("DELETE", f"/api/v1/rental/persons/{pid}/assign/{prop_id}")
                            st.rerun()
                    else:
                        if ac2.button("Assign", key=f"assign_{pid}_{prop_id}"):
                            api("POST", f"/api/v1/rental/persons/{pid}/assign/{prop_id}")
                            st.rerun()

            # Delete
            confirm_key = f"confirm_del_person_{pid}"
            if st.session_state.get(confirm_key):
                st.error(f"Delete **{name}**? This cannot be undone.")
                dc1, dc2 = st.columns(2)
                if dc1.button("Yes, delete", key=f"yes_del_p_{pid}", type="primary"):
                    api("DELETE", f"/api/v1/rental/persons/{pid}")
                    st.session_state.pop(confirm_key, None)
                    st.rerun()
                if dc2.button("Cancel", key=f"cancel_del_p_{pid}"):
                    st.session_state.pop(confirm_key, None)
                    st.rerun()
            else:
                if st.button("🗑 Remove Person", key=f"del_p_{pid}", type="secondary"):
                    st.session_state[confirm_key] = True
                    st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# TEAM (owner only)
# ─────────────────────────────────────────────────────────────────────────────

def page_team():
    st.title("👨‍👩‍👧 Team")

    dash = api("GET", "/api/v1/rental/dashboard") or {}
    plan_tier      = dash.get("plan_tier", "free")
    property_limit = dash.get("property_limit")
    properties_used = dash.get("properties_total", 0)

    if property_limit is not None:
        c1, c2 = st.columns([4, 1])
        c1.info(f"**{plan_tier.title()} plan** — {properties_used} of {property_limit} "
                f"propert{'y' if property_limit == 1 else 'ies'} used.")
        if c2.button("⬆️ Upgrade", use_container_width=True):
            st.info("Contact us to upgrade your plan — billing isn't set up yet.")
    else:
        st.success(f"**{plan_tier.title()} plan** — unlimited properties.")

    st.markdown("---")
    st.subheader("Teammates")

    users = api("GET", "/auth/users") or []
    if users:
        st.dataframe(
            [{"Name": u["full_name"], "Email": u["email"], "Role": u["role"].upper(),
              "Active": "✅" if u["is_active"] else "⛔",
              "Last Login": u["last_login"] or "—"} for u in users],
            use_container_width=True, hide_index=True,
        )
    else:
        st.info("No teammates yet.")

    with st.expander("➕ Add Teammate"):
        with st.form("add_teammate"):
            full_name = st.text_input("Full Name")
            email     = st.text_input("Email")
            password  = st.text_input("Temporary Password", type="password",
                                       help="Share this with the teammate directly — they can change it after signing in.")
            role      = st.selectbox("Role", ["owner", "staff"])
            if st.form_submit_button("Add Teammate"):
                if full_name and email and password:
                    if len(password) < 8:
                        st.error("Password must be at least 8 characters.")
                    else:
                        r = api("POST", "/auth/create-user", params={
                            "email": email, "full_name": full_name,
                            "password": password, "role": role,
                        })
                        if r:
                            st.success(f"Teammate added. Share the temporary password with {email} directly.")
                            st.rerun()
                else:
                    st.warning("All fields are required.")


# ─────────────────────────────────────────────────────────────────────────────
# SETTINGS — per-org reference types (maintenance categories, expense types, notice types)
# ─────────────────────────────────────────────────────────────────────────────

def api_delete_ok(path: str) -> bool:
    """Like api('DELETE', ...) but returns whether it actually succeeded,
    so callers can skip st.rerun() and let an error message (e.g. 'still in use') stay visible."""
    try:
        resp = requests.delete(f"{API_URL}{path}", headers=auth_headers(), timeout=10)
        if resp.status_code == 401:
            st.warning("Session expired. Please log in again.")
            logout()
            return False
        resp.raise_for_status()
        return True
    except requests.exceptions.HTTPError as e:
        detail = ""
        try:
            detail = e.response.json().get("detail", "")
        except Exception:
            pass
        st.error(detail or f"Delete failed: {e}")
        return False
    except requests.exceptions.ConnectionError:
        st.error("Cannot reach backend. Is uvicorn running on port 8000?")
        return False


def _editable_name_list(section_key, items, id_field, name_field, col_label, base_path, placeholder):
    """Editable table for a single-text-field ref list (categories, expense types).
    Click a cell to rename, use the row's trash icon to delete, or add a row at the bottom.
    Applies changes immediately — no separate Save button."""
    version_key = f"{section_key}_editor_version"
    st.session_state.setdefault(version_key, 0)

    orig_by_id = {item[id_field]: item[name_field] for item in items}
    df = pd.DataFrame([{"id": item[id_field], col_label: item[name_field]} for item in items])
    edited = st.data_editor(
        df, num_rows="dynamic", hide_index=True, use_container_width=True,
        column_order=(col_label,),
        column_config={col_label: st.column_config.TextColumn(col_label, help=f"e.g. {placeholder}")},
        key=f"{section_key}_editor_{st.session_state[version_key]}",
    )

    seen_ids = set()
    any_change = False
    for row in edited.to_dict("records"):
        name = (row.get(col_label) or "").strip()
        if pd.isna(row.get("id")):
            if name and api("POST", base_path, json={"name": name}):
                any_change = True
        else:
            rid = int(row["id"])
            seen_ids.add(rid)
            if name and name != orig_by_id.get(rid):
                if api("PATCH", f"{base_path}/{rid}", json={"name": name}):
                    any_change = True
    for rid in orig_by_id:
        if rid not in seen_ids:
            if api_delete_ok(f"{base_path}/{rid}"):
                any_change = True

    if any_change:
        st.session_state[version_key] += 1
        st.rerun()


def page_settings():
    st.title("⚙️ Settings")
    st.caption("Customize the dropdown options your org uses across Maintenance, Expenses, and Legal Notices. "
               "Click a cell to rename it, use the row's 🗑 to delete, or add a new row at the bottom.")

    st.subheader("🔧 Maintenance Categories")
    cats = api("GET", "/api/v1/rental/ref/maintenance-categories") or []
    _editable_name_list("cat", cats, "category_id", "name", "Category",
                        "/api/v1/rental/ref/maintenance-categories", "Snow Removal")
    st.markdown("---")

    st.subheader("💰 Expense Types")
    types = api("GET", "/api/v1/rental/ref/expense-types") or []
    _editable_name_list("etype", types, "type_id", "name", "Expense Type",
                        "/api/v1/rental/ref/expense-types", "Landscaping")
    st.markdown("---")

    # Legal notice types — two editable columns (code + description), same pattern as above.
    st.subheader("⚖️ Legal Notice Types")
    notices = api("GET", "/api/v1/rental/ref/notice-types") or []
    st.session_state.setdefault("notype_editor_version", 0)
    orig_notices = {n["notice_type_id"]: (n["code"], n["description"]) for n in notices}
    ndf = pd.DataFrame([{"id": n["notice_type_id"], "Code": n["code"], "Description": n["description"]}
                        for n in notices])
    nedited = st.data_editor(
        ndf, num_rows="dynamic", hide_index=True, use_container_width=True,
        column_order=("Code", "Description"),
        key=f"notype_editor_{st.session_state['notype_editor_version']}",
    )
    seen_ids, any_change = set(), False
    for row in nedited.to_dict("records"):
        code = (row.get("Code") or "").strip()
        desc = (row.get("Description") or "").strip()
        if pd.isna(row.get("id")):
            if code and desc and api("POST", "/api/v1/rental/ref/notice-types",
                                     json={"code": code, "description": desc}):
                any_change = True
        else:
            rid = int(row["id"])
            seen_ids.add(rid)
            orig_code, orig_desc = orig_notices.get(rid, (None, None))
            if code and desc and (code != orig_code or desc != orig_desc):
                if api("PATCH", f"/api/v1/rental/ref/notice-types/{rid}",
                      json={"code": code, "description": desc}):
                    any_change = True
    for rid in orig_notices:
        if rid not in seen_ids:
            if api_delete_ok(f"/api/v1/rental/ref/notice-types/{rid}"):
                any_change = True
    if any_change:
        st.session_state["notype_editor_version"] += 1
        st.rerun()


# ─────────────────────────────────────────────────────────────────────────────
# NAVIGATION
# ─────────────────────────────────────────────────────────────────────────────

PAGES = {
    "Dashboard":           page_dashboard,
    "Properties & Spaces": page_properties,
    "Tenants":             page_tenants,
    "Leases":              page_leases,
    "Payments":            page_payments,
    "Lease Tasks":         page_lease_tasks,
    "Legal Notices":       page_notices,
    "Maintenance":         page_maintenance,
    "Expenses":            page_expenses,
    "Vendors":             page_vendors,
    "Persons":             page_persons,
    "Team":                page_team,
    "Settings":            page_settings,
    "My Profile":          page_profile,
}

# ─── Gate entire app behind login ─────────────────────────────────────────────

# Check for Google OAuth token on first load
check_google_token_in_url()

if not get_token():
    # Render an empty sidebar so Streamlit tracks it as "expanded" state.
    # Without this, after login rerun the sidebar starts collapsed.
    with st.sidebar:
        st.empty()
    page_login()
else:
    apply_theme()
    # Define pages — store as named variables so dashboard can link to them
    pg_dashboard   = st.Page(page_dashboard,   title="Dashboard",           icon="🏠")
    pg_properties  = st.Page(page_properties,  title="Properties & Spaces", icon="🏢")
    pg_tenants     = st.Page(page_tenants,      title="Tenants",             icon="👥")
    pg_leases      = st.Page(page_leases,       title="Leases",              icon="📋")
    pg_payments    = st.Page(page_payments,     title="Payments",            icon="💳")
    pg_lease_tasks = st.Page(page_lease_tasks,  title="Lease Tasks",         icon="📅")
    pg_notices     = st.Page(page_notices,      title="Legal Notices",       icon="⚖️")
    pg_maintenance = st.Page(page_maintenance,  title="Maintenance",         icon="🔧")
    pg_expenses    = st.Page(page_expenses,     title="Expenses",            icon="💰")
    pg_vendors     = st.Page(page_vendors,      title="Vendors",             icon="🏪")
    pg_persons     = st.Page(page_persons,      title="Persons",             icon="👤")
    pg_team        = st.Page(page_team,         title="Team",                icon="👨‍👩‍👧")
    pg_settings    = st.Page(page_settings,     title="Settings",            icon="🏷️")
    pg_profile     = st.Page(page_profile,      title="My Profile",          icon="⚙️")

    # Store in session state so page_dashboard can reference them
    st.session_state["_pages"] = {
        "payments":    pg_payments,
        "maintenance": pg_maintenance,
        "lease_tasks": pg_lease_tasks,
    }

    pages = [pg_dashboard, pg_properties, pg_tenants, pg_leases, pg_payments,
             pg_lease_tasks, pg_notices, pg_maintenance, pg_expenses,
             pg_vendors, pg_persons, pg_settings]
    if (get_user() or {}).get("role") == "owner":
        pages.append(pg_team)
    pages.append(pg_profile)
    nav = st.navigation(pages)

    # Show user info and sign out in sidebar
    with st.sidebar:
        company = (get_user() or {}).get("company_name", "Property Management")
        st.markdown(f"## 🏠 {company}")
        user = get_user() or {}
        if user.get("avatar_url"):
            st.image(user["avatar_url"], width=40)
        st.markdown(f"**{user.get('name', '')}**")
        st.caption(user.get('role', '').upper())
        st.divider()
        if st.button("🚪 Sign Out", use_container_width=True):
            logout()

    # ── Top navigation bar ────────────────────────────────────────────────────
    st.markdown("""
        <style>
        /* Give the top nav row breathing room so icons aren't clipped */
        section.main > div:first-child { padding-top: 0.5rem !important; }
        div[data-testid="stHorizontalBlock"] { margin-top: 0.5rem; }
        div[data-testid="stHorizontalBlock"] > div { padding: 0 4px !important; }
        </style>
    """, unsafe_allow_html=True)

    # Equal-gap nav: CSS makes columns natural width with even spacing
    st.markdown("""
        <style>
        div[data-testid="stHorizontalBlock"]:first-of-type {
            display: flex !important;
            flex-wrap: nowrap !important;
            gap: 0px !important;
            justify-content: flex-start !important;
        }
        div[data-testid="stHorizontalBlock"]:first-of-type > div {
            flex: 0 0 auto !important;
            width: auto !important;
            min-width: 0 !important;
            padding: 0 6px !important;
        }
        </style>
    """, unsafe_allow_html=True)

    top_cols = st.columns(8)
    top_cols[0].page_link(pg_dashboard,   label="Home",        icon="🏠")
    top_cols[1].page_link(pg_properties,  label="Properties",  icon="🏢")
    top_cols[2].page_link(pg_tenants,     label="Tenants",     icon="👥")
    top_cols[3].page_link(pg_leases,      label="Leases",      icon="📋")
    top_cols[4].page_link(pg_payments,    label="Payments",    icon="💳")
    top_cols[5].page_link(pg_maintenance, label="Maintenance", icon="🔧")
    top_cols[6].page_link(pg_expenses,    label="Expenses",    icon="💰")
    top_cols[7].page_link(pg_profile,     label="Profile",     icon="⚙️")

    nav.run()
