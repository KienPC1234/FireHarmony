"""PostgreSQL connection and a small audit table.

The dashboard does not need an account and does not require a database to serve
NASA data. PostgreSQL is used for two operational things:

* ``query_events``: question, answer mode, source count, latency and whether the
  citation/numeric audit passed. This is how an operator can see what the demo
  was asked without putting user accounts in the product.
* a health endpoint so PM2 / a reverse proxy can tell whether the DB is reachable.

If ``DATABASE_URL`` is unset, the driver is missing or the server is down, every
function degrades quietly. The API must remain usable without a database.
"""
from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from prometheus.configs import _settings

DATABASE_URL = str(_settings.get("DATABASE_URL", "") or "").strip()
LOG_QUERIES = str(_settings.get("DB_LOG_QUERIES", "1")).strip().lower() in {
    "1", "true", "yes", "on",
}
# How many days of questions to keep. The table would otherwise grow without
# bound on a long-running deployment.
RETENTION_DAYS = int(_settings.get("DB_RETENTION_DAYS", "30") or 30)

try:  # optional dependency: the dashboard must work without PostgreSQL
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - exercised only on a minimal install
    psycopg = None
    dict_row = None

try:  # optional: the pool is an optimisation, not a requirement
    from psycopg_pool import ConnectionPool
except ImportError:  # pragma: no cover - exercised only on a minimal install
    ConnectionPool = None

logger = logging.getLogger("aab.db")

_last_failure = 0.0
_failure_reason = ""
_FAILURE_COOLDOWN = 30.0

_pool = None
_pool_lock = threading.Lock()

SCHEMA = [
    """
    create table if not exists query_events (
        id bigserial primary key,
        created_at timestamptz not null default now(),
        question text not null,
        answer_mode text,
        cached boolean not null default false,
        documents integer not null default 0,
        latency_ms integer,
        citations_ok boolean,
        numeric_ok boolean
    )
    """,
    "create index if not exists query_events_created_at_idx on query_events (created_at desc)",
]


def configured() -> bool:
    return bool(DATABASE_URL)


def available() -> bool:
    """True when the driver and a DSN are present (does not open a connection)."""
    return bool(DATABASE_URL) and psycopg is not None


def _get_pool():
    """A lazily created connection pool, or None when the pool is unavailable.

    Every audited question used to open and close its own TCP connection, and
    the audit runs on its own thread, so one question meant one thread and one
    handshake with PostgreSQL. A pool reuses the connections instead.

    The pool opens itself in the background, so importing this module never
    touches the database and a database that is briefly unavailable does not
    leave the pool permanently dead. Passing ``open=False`` would leave it
    closed for good, and every use would raise ``PoolClosed``.
    """
    global _pool
    if _pool is not None or ConnectionPool is None or not available():
        return _pool
    with _pool_lock:
        if _pool is None:
            try:
                _pool = ConnectionPool(
                    DATABASE_URL,
                    min_size=1,
                    max_size=4,
                    timeout=5,        # how long a caller waits for a connection
                    max_waiting=8,    # and how many may wait at once
                    open=True,        # open in the background, do not block
                )
                # The pool worker retries a dead database forever and logs
                # every attempt at WARNING — hundreds of identical lines that
                # bury real log output. Our own audit backoff still reports
                # each failure, and /api/db/health still reports the state,
                # so nothing an operator needs is lost by quieting the worker.
                logging.getLogger("psycopg.pool").setLevel(logging.ERROR)
                logger.info("PostgreSQL connection pool ready (max_size=4)")
            except Exception as e:  # noqa: BLE001 - fall back to direct connects
                logger.warning("pool unavailable, using direct connections: %s", e)
                _pool = None
    return _pool


@contextmanager
def _connection(timeout: int = 3):
    """Yield a connection, from the pool when there is one.

    The connection is returned to the pool on the way out. Without a pool a
    fresh connection is opened and closed again, which is what happened before.
    """
    pool = _get_pool()
    if pool is not None:
        with pool.connection() as conn:
            yield conn
        return
    conn = psycopg.connect(DATABASE_URL, connect_timeout=timeout)
    try:
        yield conn
    finally:
        conn.close()


def health() -> dict:
    """Explicit health check used by /api/db/health and PM2 operators."""
    if not configured():
        return {
            "configured": False,
            "ok": False,
            "error": "DATABASE_URL is not set; see backend/.env.example",
        }
    if psycopg is None:
        return {
            "configured": True,
            "ok": False,
            "error": "psycopg is not installed; pip install -r requirements-serve.txt",
        }
    started = time.perf_counter()
    try:
        with _connection(timeout=3) as conn:
            row = conn.execute("select current_database(), version()").fetchone()
        return {
            "configured": True,
            "ok": True,
            "database": row[0] if row else None,
            "version": (row[1] if row else "").split(",")[0],
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        }
    except Exception as e:  # noqa: BLE001 - health must report, not crash
        return {
            "configured": True,
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        }


def ensure_schema() -> dict:
    """Create the audit table. Safe to run repeatedly."""
    with _connection(timeout=5) as conn:
        for statement in SCHEMA:
            conn.execute(statement)
        conn.commit()
    return {"ok": True, "tables": ["query_events"]}


def prune(days: int | None = None) -> int:
    """Delete audit rows older than the retention window. Returns the count.

    Without this the table only ever grows. The delete is cheap because of the
    created_at index.
    """
    keep_days = RETENTION_DAYS if days is None else days
    if keep_days <= 0 or not available():
        return 0
    try:
        with _connection(timeout=5) as conn:
            row = conn.execute(
                "delete from query_events where created_at < now() - make_interval(days => %s)"
                " returning id",
                (keep_days,),
            ).fetchall()
            conn.commit()
        return len(row)
    except Exception as e:  # noqa: BLE001 - pruning must never break a request
        logger.warning("prune failed: %s", e)
        return 0


def log_query(question: str, *, mode: str | None = None, cached: bool = False,
              documents: int = 0, latency_ms: int | None = None,
              citations_ok: bool | None = None,
              numeric_ok: bool | None = None) -> bool:
    """Best-effort insert. Never raises into a request handler."""
    global _last_failure, _failure_reason
    if not LOG_QUERIES or not available():
        return False
    now = time.time()
    if now - _last_failure < _FAILURE_COOLDOWN:
        return False
    try:
        with _connection(timeout=2) as conn:
            conn.execute(
                """
                insert into query_events
                    (question, answer_mode, cached, documents, latency_ms,
                     citations_ok, numeric_ok)
                values (%s, %s, %s, %s, %s, %s, %s)
                """,
                (question[:2000], mode, cached, documents, latency_ms,
                 citations_ok, numeric_ok),
            )
            conn.commit()
        return True
    except Exception as e:  # noqa: BLE001 - auditing must not break the answer
        _last_failure = now
        _failure_reason = f"{type(e).__name__}: {e}"
        # The circuit breaker used to swallow the reason, so an operator saw an
        # empty audit table with no way to learn why.
        logger.warning("audit write failed, pausing for %.0fs: %s",
                       _FAILURE_COOLDOWN, _failure_reason)
        return False


def stats() -> dict:
    if not available():
        return {"configured": configured(), "ok": False,
                "error": "PostgreSQL is not configured"}
    try:
        with _connection(timeout=3) as conn:
            row = conn.execute(
                "select count(*), max(created_at) from query_events"
            ).fetchone()
        return {
            "configured": True,
            "ok": True,
            "queries": int(row[0]) if row else 0,
            "last_query_at": (
                row[1].isoformat() if row and row[1] else None
            ),
            "now": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
    except Exception as e:  # noqa: BLE001
        return {"configured": True, "ok": False,
                "error": f"{type(e).__name__}: {e}"}
