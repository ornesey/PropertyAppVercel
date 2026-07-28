import os
from contextlib import contextmanager
import sqlalchemy
from sqlalchemy import text

_engine: sqlalchemy.engine.Engine | None = None
_connector = None


def get_engine() -> sqlalchemy.engine.Engine:
    global _engine, _connector
    if _engine is not None:
        return _engine

    if os.environ.get("ENV") == "local":
        db_user = os.environ["db_user"]
        db_password = os.environ["db_password"]
        db_name = os.environ["db_name"]
        db_host = os.environ.get("db_host", "localhost")
        db_port = os.environ.get("db_port", "5432")
        _engine = sqlalchemy.create_engine(
            f"postgresql+pg8000://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
        )
    else:
        from google.cloud.sql.connector import Connector, IPTypes
        _connector = Connector()

        def getconn():
            return _connector.connect(
                os.environ["db_conn"],
                "pg8000",
                user=os.environ["db_user"],
                db=os.environ["db_name"],
                enable_iam_auth=True,
                ip_type=IPTypes.PRIVATE,
            )

        _engine = sqlalchemy.create_engine(
            "postgresql+pg8000://",
            creator=getconn,
        )

    return _engine


def get_connection():
    return get_engine().connect()


def set_org_context(conn, org_id: int):
    """
    Sets app.current_org_id on an already-open connection/transaction, for RLS.
    Uses set_config(..., is_local=True) rather than SET LOCAL app.current_org_id = :oid
    — Postgres's SET command only accepts literal constants, not bind parameters,
    so a parameterized SET LOCAL fails with a syntax error under the extended
    query protocol. set_config() is a regular function call and accepts
    parameters, with the same transaction-scoped (is_local=True) behavior.

    Use this mid-transaction when a plain get_connection() needs to write to an
    RLS-protected table partway through — e.g. signup, which creates an org
    (unprotected) then must seed org-scoped reference rows (protected) for it,
    all within the same atomic transaction.
    """
    conn.execute(text("SELECT set_config('app.current_org_id', CAST(:oid AS text), true)"), {"oid": org_id})


@contextmanager
def get_connection_for_org(org_id: int):
    """
    Yields a SQLAlchemy connection with app.current_org_id set for the duration
    of the transaction — see set_org_context() for why set_config() is used
    instead of SET LOCAL.

    Use this for all /api/v1/rental/* endpoints. Auth endpoints that look up
    users before org context is known should use plain get_connection().
    """
    with get_engine().connect() as conn:
        set_org_context(conn, org_id)
        yield conn


def release_connection(conn):
    conn.close()
