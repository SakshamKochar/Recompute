from app.db import database_url


def test_postgres_url_selects_installed_driver():
    url = database_url("postgres://user:password@localhost:5432/recompute")
    assert url.drivername == "postgresql+psycopg"
    assert url.database == "recompute"


def test_supabase_pooler_requires_tls_and_preserves_credentials():
    url = database_url("postgresql://postgres.project:p%40ss@aws-0-us-west-1.pooler.supabase.com:5432/postgres?connect_timeout=10")
    assert url.password == "p@ss"
    assert url.query["sslmode"] == "require"
    assert url.query["connect_timeout"] == "10"


def test_local_sqlite_is_unchanged():
    assert str(database_url("sqlite:///./recompute.db")) == "sqlite:///./recompute.db"
