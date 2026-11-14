#!/usr/bin/env python3
"""Create the PostgreSQL database and audit schema from backend/.env.

Run from backend/:  ../.venv/bin/python scripts/init_db.py

The script connects to the maintenance database ``postgres``, creates the target
database if it does not exist, then creates the ``query_events`` table. It never
prints the password.
"""
from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import urlparse

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app import db  # noqa: E402


def _redacted(dsn: str) -> str:
    parts = urlparse(dsn)
    user = parts.username or "?"
    host = parts.hostname or "?"
    port = parts.port or 5432
    name = (parts.path or "/?").lstrip("/")
    return f"postgresql://{user}:***@{host}:{port}/{name}"


def main() -> int:
    if not db.configured():
        print("DATABASE_URL is not set. Copy backend/.env.example to backend/.env "
              "and fill in the PostgreSQL connection string.")
        return 1
    if db.psycopg is None:
        print("psycopg is not installed. Run: "
              "../.venv/bin/python -m pip install -r requirements-serve.txt")
        return 1

    dsn = db.DATABASE_URL
    parts = urlparse(dsn)
    database = (parts.path or "").lstrip("/")
    if not database or not database.replace("_", "").isalnum():
        print(f"Refusing unsafe database name in DATABASE_URL: {database!r}")
        return 1

    print(f"target: {_redacted(dsn)}")
    maintenance = parts._replace(path="/postgres").geturl()
    try:
        with db.psycopg.connect(maintenance, autocommit=True, connect_timeout=5) as conn:
            exists = conn.execute(
                "select 1 from pg_database where datname = %s", (database,)
            ).fetchone()
            if exists:
                print(f"database {database!r} already exists")
            else:
                conn.execute(f'create database "{database}"')
                print(f"created database {database!r}")
    except Exception as e:  # noqa: BLE001
        print(f"could not connect/create database: {type(e).__name__}: {e}")
        print("\nIs PostgreSQL installed and running on this machine?")
        print("  sudo apt install postgresql")
        print("  sudo systemctl enable --now postgresql")
        print("Then create the role/database, or adjust DATABASE_URL in backend/.env.")
        return 1

    try:
        print(db.ensure_schema())
    except Exception as e:  # noqa: BLE001
        print(f"database exists but schema creation failed: {type(e).__name__}: {e}")
        return 1
    print("database ready. Try: curl http://127.0.0.1:8000/api/db/health")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
