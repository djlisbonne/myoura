"""SQLite storage for synced Oura data, app settings, and saved views.

Single-user, single-process: one connection guarded by a lock, WAL mode on so
reads never block. Plenty fast for a local home-server app.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Iterable

from .config import get_settings

_conn: sqlite3.Connection | None = None
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    settings = get_settings()
    settings.db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(
        settings.db_path, check_same_thread=False, isolation_level=None
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _conn = conn
    _init_schema(conn)
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS daily (
            day    TEXT NOT NULL,
            metric TEXT NOT NULL,
            value  REAL NOT NULL,
            PRIMARY KEY (day, metric)
        );
        CREATE INDEX IF NOT EXISTS idx_daily_metric ON daily(metric, day);

        CREATE TABLE IF NOT EXISTS documents (
            collection TEXT NOT NULL,
            doc_id     TEXT NOT NULL,
            day        TEXT,
            raw        TEXT NOT NULL,
            PRIMARY KEY (collection, doc_id)
        );

        CREATE TABLE IF NOT EXISTS heart_rate (
            ts     TEXT PRIMARY KEY,
            bpm    INTEGER NOT NULL,
            source TEXT
        );

        -- Generic sub-daily time series (overnight HR/HRV, MET, motion, etc.),
        -- parsed from Oura SampleModel objects and string-encoded sequences.
        CREATE TABLE IF NOT EXISTS samples (
            series    TEXT NOT NULL,
            ts        TEXT NOT NULL,
            value     REAL NOT NULL,
            period_id TEXT,
            PRIMARY KEY (series, ts)
        );
        CREATE INDEX IF NOT EXISTS idx_samples_series ON samples(series, ts);
        CREATE INDEX IF NOT EXISTS idx_samples_period ON samples(period_id);

        -- One row per sleep period (naps kept, unlike the daily aggregate).
        CREATE TABLE IF NOT EXISTS sleep_periods (
            id             TEXT PRIMARY KEY,
            day            TEXT NOT NULL,
            type           TEXT,
            bedtime_start  TEXT,
            bedtime_end    TEXT,
            hypnogram      TEXT,
            movement       TEXT,
            raw            TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sleep_periods_day ON sleep_periods(day);

        -- Timestamped Oura events (enhanced_tag, sessions, workouts).
        CREATE TABLE IF NOT EXISTS oura_events (
            id        TEXT PRIMARY KEY,
            kind      TEXT NOT NULL,
            start_ts  TEXT,
            end_ts    TEXT,
            day       TEXT,
            label     TEXT,
            comment   TEXT,
            raw       TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_oura_events_day ON oura_events(kind, day);

        CREATE TABLE IF NOT EXISTS sync_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at  TEXT NOT NULL,
            finished_at TEXT,
            status      TEXT NOT NULL,
            range_start TEXT,
            range_end   TEXT,
            detail      TEXT
        );

        CREATE TABLE IF NOT EXISTS saved_views (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            config     TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )


# --- settings ---------------------------------------------------------------

def get_setting(key: str, default: str | None = None) -> str | None:
    row = connect().execute(
        "SELECT value FROM settings WHERE key = ?", (key,)
    ).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with _lock:
        connect().execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


# --- daily metrics ----------------------------------------------------------

def upsert_daily(rows: Iterable[tuple[str, str, float]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    with _lock:
        connect().executemany(
            "INSERT INTO daily(day, metric, value) VALUES(?, ?, ?) "
            "ON CONFLICT(day, metric) DO UPDATE SET value = excluded.value",
            rows,
        )
    return len(rows)


def upsert_documents(rows: Iterable[tuple[str, str, str | None, str]]) -> None:
    rows = list(rows)
    if not rows:
        return
    with _lock:
        connect().executemany(
            "INSERT INTO documents(collection, doc_id, day, raw) VALUES(?, ?, ?, ?) "
            "ON CONFLICT(collection, doc_id) DO UPDATE SET "
            "day = excluded.day, raw = excluded.raw",
            rows,
        )


def upsert_heart_rate(rows: Iterable[tuple[str, int, str | None]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    with _lock:
        connect().executemany(
            "INSERT INTO heart_rate(ts, bpm, source) VALUES(?, ?, ?) "
            "ON CONFLICT(ts) DO UPDATE SET bpm = excluded.bpm, source = excluded.source",
            rows,
        )
    return len(rows)


def series(metric: str, start: str | None = None, end: str | None = None
           ) -> list[dict[str, Any]]:
    sql = "SELECT day, value FROM daily WHERE metric = ?"
    params: list[Any] = [metric]
    if start:
        sql += " AND day >= ?"
        params.append(start)
    if end:
        sql += " AND day <= ?"
        params.append(end)
    sql += " ORDER BY day"
    rows = connect().execute(sql, params).fetchall()
    return [{"day": r["day"], "value": r["value"]} for r in rows]


def heart_rate_series(start: str | None = None, end: str | None = None,
                      limit: int = 5000) -> list[dict[str, Any]]:
    sql = "SELECT ts, bpm, source FROM heart_rate WHERE 1=1"
    params: list[Any] = []
    if start:
        sql += " AND ts >= ?"
        params.append(start)
    if end:
        sql += " AND ts <= ?"
        params.append(end)
    sql += " ORDER BY ts DESC LIMIT ?"
    params.append(limit)
    rows = connect().execute(sql, params).fetchall()
    rows = list(reversed(rows))
    return [{"ts": r["ts"], "bpm": r["bpm"], "source": r["source"]} for r in rows]


# --- sub-daily samples -------------------------------------------------------

def upsert_samples(rows: Iterable[tuple[str, str, float, str | None]]) -> int:
    rows = list(rows)
    if not rows:
        return 0
    with _lock:
        connect().executemany(
            "INSERT INTO samples(series, ts, value, period_id) VALUES(?, ?, ?, ?) "
            "ON CONFLICT(series, ts) DO UPDATE SET "
            "value = excluded.value, period_id = excluded.period_id",
            rows,
        )
    return len(rows)


def samples_series(series: str, start: str | None = None, end: str | None = None,
                   limit: int = 20000) -> list[dict[str, Any]]:
    sql = "SELECT ts, value FROM samples WHERE series = ?"
    params: list[Any] = [series]
    if start:
        sql += " AND ts >= ?"
        params.append(start)
    if end:
        sql += " AND ts <= ?"
        params.append(end)
    sql += " ORDER BY ts LIMIT ?"
    params.append(limit)
    rows = connect().execute(sql, params).fetchall()
    return [{"ts": r["ts"], "value": r["value"]} for r in rows]


def sample_series_keys() -> list[str]:
    rows = connect().execute(
        "SELECT DISTINCT series FROM samples ORDER BY series"
    ).fetchall()
    return [r["series"] for r in rows]


# --- sleep periods -----------------------------------------------------------

def upsert_sleep_periods(
    rows: Iterable[tuple[str, str, str | None, str | None, str | None,
                         str | None, str | None, str]]
) -> int:
    rows = list(rows)
    if not rows:
        return 0
    with _lock:
        connect().executemany(
            "INSERT INTO sleep_periods"
            "(id, day, type, bedtime_start, bedtime_end, hypnogram, movement, raw) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "day=excluded.day, type=excluded.type, "
            "bedtime_start=excluded.bedtime_start, bedtime_end=excluded.bedtime_end, "
            "hypnogram=excluded.hypnogram, movement=excluded.movement, raw=excluded.raw",
            rows,
        )
    return len(rows)


def list_sleep_periods(start: str | None = None, end: str | None = None
                       ) -> list[dict[str, Any]]:
    sql = ("SELECT id, day, type, bedtime_start, bedtime_end, hypnogram, movement "
           "FROM sleep_periods WHERE 1=1")
    params: list[Any] = []
    if start:
        sql += " AND day >= ?"
        params.append(start)
    if end:
        sql += " AND day <= ?"
        params.append(end)
    sql += " ORDER BY bedtime_start"
    rows = connect().execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def get_sleep_period(period_id: str) -> dict[str, Any] | None:
    row = connect().execute(
        "SELECT * FROM sleep_periods WHERE id = ?", (period_id,)
    ).fetchone()
    return dict(row) if row else None


# --- oura events -------------------------------------------------------------

def upsert_oura_events(
    rows: Iterable[tuple[str, str, str | None, str | None, str | None,
                         str | None, str | None, str]]
) -> int:
    rows = list(rows)
    if not rows:
        return 0
    with _lock:
        connect().executemany(
            "INSERT INTO oura_events"
            "(id, kind, start_ts, end_ts, day, label, comment, raw) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET "
            "kind=excluded.kind, start_ts=excluded.start_ts, end_ts=excluded.end_ts, "
            "day=excluded.day, label=excluded.label, comment=excluded.comment, "
            "raw=excluded.raw",
            rows,
        )
    return len(rows)


def list_oura_events(kind: str | None = None, start: str | None = None,
                     end: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT id, kind, start_ts, end_ts, day, label, comment FROM oura_events WHERE 1=1"
    params: list[Any] = []
    if kind:
        sql += " AND kind = ?"
        params.append(kind)
    if start:
        sql += " AND day >= ?"
        params.append(start)
    if end:
        sql += " AND day <= ?"
        params.append(end)
    sql += " ORDER BY start_ts"
    rows = connect().execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def list_documents(collection: str) -> list[dict[str, Any]]:
    """All raw documents for a collection — used by the granular backfill."""
    rows = connect().execute(
        "SELECT collection, doc_id, day, raw FROM documents WHERE collection = ?",
        (collection,),
    ).fetchall()
    return [
        {"collection": r["collection"], "doc_id": r["doc_id"], "day": r["day"],
         "raw": r["raw"]}
        for r in rows
    ]


def coverage() -> dict[str, Any]:
    """Summary of what's stored: date span, row counts, per-metric coverage."""
    conn = connect()
    span = conn.execute(
        "SELECT MIN(day) AS first, MAX(day) AS last, COUNT(DISTINCT day) AS days "
        "FROM daily"
    ).fetchone()
    per_metric = conn.execute(
        "SELECT metric, COUNT(*) AS n, MIN(day) AS first, MAX(day) AS last "
        "FROM daily GROUP BY metric"
    ).fetchall()
    hr = conn.execute(
        "SELECT COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last FROM heart_rate"
    ).fetchone()
    return {
        "first_day": span["first"],
        "last_day": span["last"],
        "days": span["days"] or 0,
        "metrics": {
            r["metric"]: {"count": r["n"], "first": r["first"], "last": r["last"]}
            for r in per_metric
        },
        "heart_rate": {
            "count": hr["n"] or 0, "first": hr["first"], "last": hr["last"]
        },
    }


# --- sync runs --------------------------------------------------------------

def start_sync_run(range_start: str | None, range_end: str | None) -> int:
    with _lock:
        cur = connect().execute(
            "INSERT INTO sync_runs(started_at, status, range_start, range_end) "
            "VALUES(?, 'running', ?, ?)",
            (_now(), range_start, range_end),
        )
        return int(cur.lastrowid)


def finish_sync_run(run_id: int, status: str, detail: dict[str, Any]) -> None:
    with _lock:
        connect().execute(
            "UPDATE sync_runs SET finished_at = ?, status = ?, detail = ? "
            "WHERE id = ?",
            (_now(), status, json.dumps(detail), run_id),
        )


def recent_sync_runs(limit: int = 10) -> list[dict[str, Any]]:
    rows = connect().execute(
        "SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?", (limit,)
    ).fetchall()
    out = []
    for r in rows:
        out.append({
            "id": r["id"],
            "started_at": r["started_at"],
            "finished_at": r["finished_at"],
            "status": r["status"],
            "range_start": r["range_start"],
            "range_end": r["range_end"],
            "detail": json.loads(r["detail"]) if r["detail"] else None,
        })
    return out


# --- saved views ------------------------------------------------------------

def list_saved_views() -> list[dict[str, Any]]:
    rows = connect().execute(
        "SELECT id, name, config, created_at FROM saved_views ORDER BY id DESC"
    ).fetchall()
    return [
        {"id": r["id"], "name": r["name"], "config": json.loads(r["config"]),
         "created_at": r["created_at"]}
        for r in rows
    ]


def create_saved_view(name: str, config: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        cur = connect().execute(
            "INSERT INTO saved_views(name, config, created_at) VALUES(?, ?, ?)",
            (name, json.dumps(config), _now()),
        )
        view_id = int(cur.lastrowid)
    return {"id": view_id, "name": name, "config": config}


def delete_saved_view(view_id: int) -> None:
    with _lock:
        connect().execute("DELETE FROM saved_views WHERE id = ?", (view_id,))
