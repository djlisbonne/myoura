"""High-granularity (sub-daily) Oura data: parsing, catalog, and backfill.

Most of Oura's high-resolution data already sits in the local ``documents``
table as raw JSON — it was just never parsed out. This module turns those raw
docs into queryable time series (``samples``), per-period sleep rows
(``sleep_periods``), and timestamped events (``oura_events``), with no extra
API calls.

Oura encodes sub-daily data two ways:
  * SampleModel: ``{interval: seconds, items: [..], timestamp: ISO}`` — used for
    sleep heart_rate / hrv and activity met.
  * Fixed-width digit strings — ``sleep_phase_5_min`` (5-min hypnogram),
    ``movement_30_sec`` (30-sec motion), ``daily_activity.class_5_min`` (5-min
    activity class). One digit per window.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta
from typing import Any, Iterable

from . import db

# --- decode maps (exposed to the UI for labelling) --------------------------

SLEEP_STAGE_LABELS = {1: "Deep", 2: "Light", 3: "REM", 4: "Awake"}
MOVEMENT_LABELS = {1: "No motion", 2: "Restless", 3: "Tossing", 4: "Active"}
ACTIVITY_CLASS_LABELS = {
    0: "Non-wear", 1: "Rest", 2: "Inactive", 3: "Low", 4: "Medium", 5: "High",
}

# --- the intraday series catalog (parallel to metrics.CATALOG) --------------

SERIES_CATALOG: list[dict[str, Any]] = [
    {"key": "sleep_hr", "label": "Overnight HR", "unit": "bpm",
     "resolution": "~5 min", "source": "sleep", "kind": "line"},
    {"key": "sleep_hrv", "label": "Overnight HRV", "unit": "ms",
     "resolution": "~5 min", "source": "sleep", "kind": "line"},
    {"key": "sleep_stage", "label": "Sleep Stage", "unit": "stage",
     "resolution": "5 min", "source": "sleep", "kind": "stage",
     "labels": SLEEP_STAGE_LABELS},
    {"key": "sleep_movement", "label": "Restlessness", "unit": "level",
     "resolution": "30 sec", "source": "sleep", "kind": "stage",
     "labels": MOVEMENT_LABELS},
    {"key": "met", "label": "Metabolic Rate (MET)", "unit": "MET",
     "resolution": "~1 min", "source": "daily_activity", "kind": "line"},
    {"key": "activity_class", "label": "Activity Class", "unit": "class",
     "resolution": "5 min", "source": "daily_activity", "kind": "stage",
     "labels": ACTIVITY_CLASS_LABELS},
]

SERIES_BY_KEY = {s["key"]: s for s in SERIES_CATALOG}


def series_catalog() -> list[dict[str, Any]]:
    return SERIES_CATALOG


# --- parsers ----------------------------------------------------------------

def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def parse_sample_model(sample: dict[str, Any] | None, series: str,
                       period_id: str | None = None
                       ) -> list[tuple[str, str, float, str | None]]:
    """Expand an Oura SampleModel into (series, ts, value, period_id) rows."""
    if not sample:
        return []
    start = _parse_dt(sample.get("timestamp"))
    interval = sample.get("interval")
    items = sample.get("items")
    if start is None or not interval or not isinstance(items, list):
        return []
    rows: list[tuple[str, str, float, str | None]] = []
    for i, item in enumerate(items):
        if item is None:
            continue
        try:
            value = float(item)
        except (TypeError, ValueError):
            continue
        ts = (start + timedelta(seconds=i * interval)).isoformat()
        rows.append((series, ts, value, period_id))
    return rows


def parse_digit_string(seq: str | None, interval_sec: int, start: datetime | None,
                       series: str, period_id: str | None = None
                       ) -> list[tuple[str, str, float, str | None]]:
    """Expand a fixed-width digit string (hypnogram/movement/class) into rows."""
    if not seq or start is None:
        return []
    rows: list[tuple[str, str, float, str | None]] = []
    for i, ch in enumerate(seq):
        if not ch.isdigit():
            continue
        ts = (start + timedelta(seconds=i * interval_sec)).isoformat()
        rows.append((series, ts, float(int(ch)), period_id))
    return rows


# --- per-collection extraction ----------------------------------------------

def _sleep_rows(doc: dict[str, Any]):
    """Return (period_row, sample_rows) for one sleep document/period.

    Prefers the 30-second hypnogram (``sleep_phase_30_sec``, present in real
    responses though absent from Oura's published OpenAPI spec) over the 5-minute
    one — 10x finer sleep staging.
    """
    period_id = doc.get("id") or f"sleep:{doc.get('day')}:{doc.get('bedtime_start')}"
    start = _parse_dt(doc.get("bedtime_start"))
    hyp30 = doc.get("sleep_phase_30_sec")
    if hyp30:
        hyp, hyp_interval = hyp30, 30
    else:
        hyp, hyp_interval = doc.get("sleep_phase_5_min"), 300
    period_row = (
        period_id, doc.get("day"), doc.get("type"),
        doc.get("bedtime_start"), doc.get("bedtime_end"),
        hyp, hyp_interval, doc.get("movement_30_sec"),
        json.dumps(doc),
    )
    sample_rows: list[tuple[str, str, float, str | None]] = []
    sample_rows += parse_sample_model(doc.get("heart_rate"), "sleep_hr", period_id)
    sample_rows += parse_sample_model(doc.get("hrv"), "sleep_hrv", period_id)
    sample_rows += parse_digit_string(hyp, hyp_interval, start, "sleep_stage", period_id)
    sample_rows += parse_digit_string(
        doc.get("movement_30_sec"), 30, start, "sleep_movement", period_id)
    return period_row, sample_rows


def _activity_sample_rows(doc: dict[str, Any]):
    rows: list[tuple[str, str, float, str | None]] = []
    rows += parse_sample_model(doc.get("met"), "met", None)
    rows += parse_digit_string(
        doc.get("class_5_min"), 300, _parse_dt(doc.get("timestamp")),
        "activity_class", None)
    return rows


def _enhanced_tag_row(doc: dict[str, Any]):
    tag_id = doc.get("id") or f"tag:{doc.get('start_time')}"
    label = doc.get("custom_name") or doc.get("tag_type_code") or "tag"
    return (
        tag_id, "enhanced_tag", doc.get("start_time"), doc.get("end_time"),
        doc.get("start_day") or doc.get("day"), label, doc.get("comment"),
        json.dumps(doc),
    )


def _session_event_row(doc: dict[str, Any]):
    sid = doc.get("id") or f"session:{doc.get('start_datetime')}"
    return (
        sid, "session", doc.get("start_datetime"), doc.get("end_datetime"),
        doc.get("day"), doc.get("type"), doc.get("mood"), json.dumps(doc),
    )


def store_sleep_docs(docs: Iterable[dict[str, Any]]) -> dict[str, int]:
    period_rows = []
    sample_rows: list[tuple[str, str, float, str | None]] = []
    for doc in docs:
        if not doc.get("day"):
            continue
        period_row, s_rows = _sleep_rows(doc)
        period_rows.append(period_row)
        sample_rows += s_rows
    return {
        "periods": db.upsert_sleep_periods(period_rows),
        "samples": db.upsert_samples(sample_rows),
    }


def store_activity_docs(docs: Iterable[dict[str, Any]]) -> int:
    sample_rows: list[tuple[str, str, float, str | None]] = []
    for doc in docs:
        sample_rows += _activity_sample_rows(doc)
    return db.upsert_samples(sample_rows)


def store_enhanced_tags(docs: Iterable[dict[str, Any]]) -> int:
    return db.upsert_oura_events([_enhanced_tag_row(d) for d in docs])


def store_sessions(docs: Iterable[dict[str, Any]]) -> dict[str, int]:
    event_rows = []
    sample_rows: list[tuple[str, str, float, str | None]] = []
    for doc in docs:
        event_rows.append(_session_event_row(doc))
        sid = doc.get("id") or f"session:{doc.get('start_datetime')}"
        sample_rows += parse_sample_model(doc.get("heart_rate"), "session_hr", sid)
        sample_rows += parse_sample_model(
            doc.get("heart_rate_variability"), "session_hrv", sid)
    return {
        "events": db.upsert_oura_events(event_rows),
        "samples": db.upsert_samples(sample_rows),
    }


# --- backfill from already-stored documents (no API calls) ------------------

def backfill_from_documents() -> dict[str, Any]:
    """Re-parse stored raw docs into samples / sleep_periods / events.

    Also re-runs daily-metric extraction so newly-added catalog metrics
    (contributors, BDI, day_summary, …) populate without a re-sync.
    """
    from .metrics import extract_daily, DAILY_ENDPOINTS  # local import: avoid cycle

    result: dict[str, Any] = {"daily_metric_rows": 0}

    # Re-extract daily metrics for every collection from stored docs.
    daily_rows: list[tuple[str, str, float]] = []
    for collection in DAILY_ENDPOINTS:
        for d in db.list_documents(collection):
            doc = json.loads(d["raw"])
            day = doc.get("day")
            if not day:
                continue
            for key, value in extract_daily(collection, doc).items():
                daily_rows.append((day, key, value))
    result["daily_metric_rows"] = db.upsert_daily(daily_rows)

    # Sleep periods + overnight samples (every period, naps included).
    sleep_docs = [json.loads(d["raw"]) for d in db.list_documents("sleep")]
    result["sleep"] = store_sleep_docs(sleep_docs)

    # Activity MET + 5-min activity class.
    act_docs = [json.loads(d["raw"]) for d in db.list_documents("daily_activity")]
    result["activity_samples"] = store_activity_docs(act_docs)

    # Events already stored as docs (if sessions/tags were synced).
    tag_docs = [json.loads(d["raw"]) for d in db.list_documents("enhanced_tag")]
    result["enhanced_tags"] = store_enhanced_tags(tag_docs)
    session_docs = [json.loads(d["raw"]) for d in db.list_documents("session")]
    result["sessions"] = store_sessions(session_docs)

    return result


# --- background runner (backfill is slow for large histories) ----------------

_state: dict[str, Any] = {"running": False, "result": None, "error": None,
                          "started_at": None, "finished_at": None}
_state_lock = threading.Lock()


def backfill_status() -> dict[str, Any]:
    with _state_lock:
        return dict(_state)


def start_backfill_async() -> dict[str, Any]:
    """Kick off backfill in a daemon thread; returns immediately."""
    with _state_lock:
        if _state["running"]:
            return {"started": False, "running": True}
        _state.update(running=True, error=None, result=None,
                      started_at=time.time(), finished_at=None)

    def _run() -> None:
        try:
            res = backfill_from_documents()
            with _state_lock:
                _state.update(running=False, result=res, finished_at=time.time())
        except Exception as exc:  # noqa: BLE001
            with _state_lock:
                _state.update(running=False, error=str(exc), finished_at=time.time())

    threading.Thread(target=_run, daemon=True, name="granular-backfill").start()
    return {"started": True, "running": True}
