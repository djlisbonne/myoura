"""Pull Oura data into the local store. Incremental and tolerant of gaps."""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from . import db, oura
from .metrics import DAILY_ENDPOINTS, extract_daily

# A daily summary endpoint failing shouldn't abort the whole sync — health
# accounts differ in which collections have data.
DEFAULT_LOOKBACK_DAYS = 90
HEARTRATE_LOOKBACK_DAYS = 7
OVERLAP_DAYS = 2  # re-pull a couple recent days so late-finalised data updates


def _today() -> date:
    return date.today()


def _aggregate_sleep(docs: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """One sleep record per day — the longest period (the main night's sleep)."""
    best: dict[str, dict[str, Any]] = {}
    for doc in docs:
        day = doc.get("day")
        if not day:
            continue
        dur = doc.get("total_sleep_duration") or 0
        if day not in best or dur > (best[day].get("total_sleep_duration") or 0):
            best[day] = doc
    return best


def _resolve_range(start: str | None, end: str | None) -> tuple[str, str]:
    end_d = date.fromisoformat(end) if end else _today()
    if start:
        start_d = date.fromisoformat(start)
    else:
        cov = db.coverage()
        if cov["last_day"]:
            start_d = date.fromisoformat(cov["last_day"]) - timedelta(days=OVERLAP_DAYS)
        else:
            start_d = end_d - timedelta(days=DEFAULT_LOOKBACK_DAYS)
    if start_d > end_d:
        start_d = end_d
    return start_d.isoformat(), end_d.isoformat()


async def run_sync(start: str | None = None, end: str | None = None,
                   heartrate_days: int = HEARTRATE_LOOKBACK_DAYS) -> dict[str, Any]:
    start_s, end_s = _resolve_range(start, end)
    run_id = db.start_sync_run(start_s, end_s)

    summary: dict[str, Any] = {
        "range": {"start": start_s, "end": end_s},
        "collections": {},
        "errors": {},
        "metrics_written": 0,
        "heart_rate_points": 0,
    }

    try:
        for collection, path in DAILY_ENDPOINTS.items():
            try:
                docs = await oura.fetch_daily(path, start_s, end_s)
            except oura.OuraError as exc:
                summary["errors"][collection] = str(exc)
                # 401 is fatal (bad token) — stop early with a clear message.
                if exc.status == 401:
                    db.finish_sync_run(run_id, "error", summary)
                    raise
                continue

            if collection == "sleep":
                by_day = _aggregate_sleep(docs)
                docs_for_metrics = list(by_day.values())
            else:
                docs_for_metrics = docs

            daily_rows: list[tuple[str, str, float]] = []
            doc_rows: list[tuple[str, str, str | None, str]] = []
            for doc in docs_for_metrics:
                day = doc.get("day")
                if not day:
                    continue
                for key, value in extract_daily(collection, doc).items():
                    daily_rows.append((day, key, value))
                doc_id = doc.get("id") or f"{collection}:{day}"
                doc_rows.append((collection, doc_id, day, json.dumps(doc)))

            written = db.upsert_daily(daily_rows)
            db.upsert_documents(doc_rows)
            summary["collections"][collection] = {
                "documents": len(docs), "metric_rows": written,
            }
            summary["metrics_written"] += written

        # Heart-rate time series (high volume — keep the window short).
        if heartrate_days > 0:
            hr_start = (date.fromisoformat(end_s) - timedelta(days=heartrate_days))
            hr_start_dt = f"{hr_start.isoformat()}T00:00:00+00:00"
            hr_end_dt = f"{end_s}T23:59:59+00:00"
            try:
                hr_docs = await oura.fetch_heartrate(hr_start_dt, hr_end_dt)
                hr_rows = [
                    (d["timestamp"], int(d["bpm"]), d.get("source"))
                    for d in hr_docs
                    if d.get("timestamp") and d.get("bpm") is not None
                ]
                summary["heart_rate_points"] = db.upsert_heart_rate(hr_rows)
            except oura.OuraError as exc:
                summary["errors"]["heartrate"] = str(exc)

        db.finish_sync_run(run_id, "ok", summary)
        return summary
    except oura.OuraError:
        raise
    except Exception as exc:  # noqa: BLE001 — record then re-raise
        summary["errors"]["fatal"] = str(exc)
        db.finish_sync_run(run_id, "error", summary)
        raise
