import os
from contextlib import contextmanager
import sqlalchemy
from sqlalchemy import text

_engine: sqlalchemy.engine.Engine | None = None


def get_engine() -> sqlalchemy.engine.Engine:
    global _engine
    if _engine is not None:
        return _engine

    # Option 1: Use a single DATABASE_URL environment variable (Recommended for Vercel/Supabase)
    database_url = os.environ.get("DATABASE_URL")

    if database_url:
        # Supabase URIs start with postgresql:// or postgres://
        # If using pg8000 driver, ensure the prefix is postgresql+pg8000://
        if database_url.startswith("postgres://"):
            database_url = database_url.replace("postgres://", "postgresql+pg8000://", 1)
        elif database_url.startswith("postgresql://"):
            database_url = database_url.replace("postgresql://", "postgresql+pg8000://", 1)

        _engine = sqlalchemy.create_engine(
            database_url,
            pool_pre_ping=True,  # Keeps connections fresh
        )
    else:
        # Option 2: Fallback to individual credentials
        db_user = os.environ.get("db_user", "postgres")
        db_password = os.environ["db_password"]
        db_host = os.environ["db_host"]  # e.g., db.xxxx.supabase.co or aws-0-xx.pooler.supabase.com
        db_port = os.environ.get("db_port", "5432")  # 5432 or 6543 (transaction pooler)
        db_name = os.environ.get("db_name", "postgres")

        connection_str = (
            f"postgresql+pg8000://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
        )

        _engine = sqlalchemy.create_engine(
            connection_str,
            pool_pre_ping=True,
        )

    return _engine


def get_connection():
    return get_engine().connect()


def set_org_context(conn, org_id: int):
    conn.execute(
        text("SELECT set_config('app.current_org_id', CAST(:oid AS text), true)"),
        {"oid": org_id},
    )


@contextmanager
def get_connection_for_org(org_id: int):
    with get_engine().connect() as conn:
        set_org_context(conn, org_id)
        yield conn


def release_connection(conn):
    conn.close()
