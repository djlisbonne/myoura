"""The metric catalog.

A single source of truth that drives sync, the API, and the UI. Each daily
metric knows which Oura collection it comes from, how to pull its value out of a
document, and how it should be labelled / scaled for display.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

# --- Oura collections we pull from -----------------------------------------
# Daily-summary collections are keyed by their ``day`` field. ``sleep`` is the
# detailed (per-period) collection and is aggregated to one record per day.
# ``heartrate`` is a high-resolution time series handled on its own path.

DAILY_ENDPOINTS: dict[str, str] = {
    "daily_sleep": "/v2/usercollection/daily_sleep",
    "sleep": "/v2/usercollection/sleep",
    "daily_readiness": "/v2/usercollection/daily_readiness",
    "daily_activity": "/v2/usercollection/daily_activity",
    "daily_stress": "/v2/usercollection/daily_stress",
    "daily_spo2": "/v2/usercollection/daily_spo2",
    "daily_resilience": "/v2/usercollection/daily_resilience",
    "daily_cardiovascular_age": "/v2/usercollection/daily_cardiovascular_age",
}

HEARTRATE_ENDPOINT = "/v2/usercollection/heartrate"


@dataclass(frozen=True)
class Metric:
    key: str
    label: str
    group: str
    collection: str
    unit: str = ""
    decimals: int = 0
    # Dotted path into the document, e.g. "contributors.deep_sleep".
    path: str = ""
    # Multiply the raw value by this (e.g. seconds -> hours = 1/3600).
    scale: float = 1.0
    description: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "group": self.group,
            "unit": self.unit,
            "decimals": self.decimals,
            "description": self.description,
        }


_SEC_TO_HOURS = 1.0 / 3600.0
_SEC_TO_MIN = 1.0 / 60.0


# Order here is the order shown in the UI metric browser.
CATALOG: list[Metric] = [
    # --- Sleep -------------------------------------------------------------
    Metric("sleep_score", "Sleep Score", "Sleep", "daily_sleep", "", 0, "score",
           description="Overall nightly sleep score (0–100)."),
    Metric("total_sleep", "Total Sleep", "Sleep", "sleep", "h", 2,
           "total_sleep_duration", _SEC_TO_HOURS, "Time actually asleep."),
    Metric("time_in_bed", "Time in Bed", "Sleep", "sleep", "h", 2,
           "time_in_bed", _SEC_TO_HOURS),
    Metric("rem_sleep", "REM Sleep", "Sleep", "sleep", "h", 2,
           "rem_sleep_duration", _SEC_TO_HOURS),
    Metric("deep_sleep", "Deep Sleep", "Sleep", "sleep", "h", 2,
           "deep_sleep_duration", _SEC_TO_HOURS),
    Metric("light_sleep", "Light Sleep", "Sleep", "sleep", "h", 2,
           "light_sleep_duration", _SEC_TO_HOURS),
    Metric("awake_time", "Awake Time", "Sleep", "sleep", "h", 2,
           "awake_time", _SEC_TO_HOURS),
    Metric("sleep_efficiency", "Sleep Efficiency", "Sleep", "sleep", "%", 0,
           "efficiency"),
    Metric("sleep_latency", "Sleep Latency", "Sleep", "sleep", "min", 0,
           "latency", _SEC_TO_MIN, "Time taken to fall asleep."),
    Metric("restless_periods", "Restless Periods", "Sleep", "sleep", "", 0,
           "restless_periods"),

    # --- Readiness ---------------------------------------------------------
    Metric("readiness_score", "Readiness Score", "Readiness", "daily_readiness",
           "", 0, "score", description="Daily readiness score (0–100)."),
    Metric("temp_deviation", "Temperature Deviation", "Readiness",
           "daily_readiness", "°C", 2, "temperature_deviation",
           description="Skin temperature deviation from your baseline."),
    Metric("temp_trend", "Temperature Trend", "Readiness", "daily_readiness",
           "°C", 2, "temperature_trend_deviation"),

    # --- Vitals (from the night's sleep record) ---------------------------
    Metric("resting_hr", "Lowest Resting HR", "Vitals", "sleep", "bpm", 0,
           "lowest_heart_rate", description="Lowest heart rate during sleep."),
    Metric("avg_hr", "Average HR (sleep)", "Vitals", "sleep", "bpm", 0,
           "average_heart_rate"),
    Metric("avg_hrv", "Average HRV", "Vitals", "sleep", "ms", 0, "average_hrv",
           description="Average heart-rate variability (rMSSD) overnight."),
    Metric("avg_breath", "Respiratory Rate", "Vitals", "sleep", "/min", 1,
           "average_breath"),
    Metric("spo2", "Blood Oxygen (SpO₂)", "Vitals", "daily_spo2", "%", 1,
           "spo2_percentage.average"),
    Metric("vascular_age", "Cardiovascular Age", "Vitals",
           "daily_cardiovascular_age", "yrs", 0, "vascular_age"),

    # --- Activity ----------------------------------------------------------
    Metric("activity_score", "Activity Score", "Activity", "daily_activity",
           "", 0, "score"),
    Metric("steps", "Steps", "Activity", "daily_activity", "", 0, "steps"),
    Metric("active_calories", "Active Calories", "Activity", "daily_activity",
           "kcal", 0, "active_calories"),
    Metric("total_calories", "Total Calories", "Activity", "daily_activity",
           "kcal", 0, "total_calories"),
    Metric("walking_distance", "Walking Equivalent", "Activity",
           "daily_activity", "m", 0, "equivalent_walking_distance"),
    Metric("met_minutes", "Average MET Minutes", "Activity", "daily_activity",
           "", 1, "average_met_minutes"),
    Metric("high_activity", "High Activity", "Activity", "daily_activity",
           "min", 0, "high_activity_time", _SEC_TO_MIN),
    Metric("medium_activity", "Medium Activity", "Activity", "daily_activity",
           "min", 0, "medium_activity_time", _SEC_TO_MIN),
    Metric("low_activity", "Low Activity", "Activity", "daily_activity",
           "min", 0, "low_activity_time", _SEC_TO_MIN),
    Metric("sedentary_time", "Sedentary Time", "Activity", "daily_activity",
           "min", 0, "sedentary_time", _SEC_TO_MIN),
    Metric("resting_time", "Resting Time", "Activity", "daily_activity",
           "min", 0, "resting_time", _SEC_TO_MIN),
    Metric("inactivity_alerts", "Inactivity Alerts", "Activity",
           "daily_activity", "", 0, "inactivity_alerts"),

    # --- Stress & Recovery -------------------------------------------------
    Metric("stress_high", "Stress (high)", "Stress & Recovery", "daily_stress",
           "min", 0, "stress_high", _SEC_TO_MIN,
           "Time spent in a high-stress physiological state."),
    Metric("recovery_high", "Recovery (high)", "Stress & Recovery",
           "daily_stress", "min", 0, "recovery_high", _SEC_TO_MIN),
    Metric("resilience_sleep", "Resilience: Sleep Recovery", "Stress & Recovery",
           "daily_resilience", "", 1, "contributors.sleep_recovery"),
    Metric("resilience_daytime", "Resilience: Daytime Recovery",
           "Stress & Recovery", "daily_resilience", "", 1,
           "contributors.daytime_recovery"),
    Metric("resilience_stress", "Resilience: Stress", "Stress & Recovery",
           "daily_resilience", "", 1, "contributors.stress"),
]

CATALOG_BY_KEY: dict[str, Metric] = {m.key: m for m in CATALOG}

# collection -> metrics sourced from it
_METRICS_BY_COLLECTION: dict[str, list[Metric]] = {}
for _m in CATALOG:
    _METRICS_BY_COLLECTION.setdefault(_m.collection, []).append(_m)


def _dotted(doc: dict[str, Any], path: str) -> Any:
    cur: Any = doc
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
        if cur is None:
            return None
    return cur


def extract_daily(collection: str, doc: dict[str, Any]) -> dict[str, float]:
    """Return ``{metric_key: value}`` for one document of ``collection``."""
    out: dict[str, float] = {}
    for metric in _METRICS_BY_COLLECTION.get(collection, []):
        raw = _dotted(doc, metric.path)
        if raw is None or isinstance(raw, bool):
            continue
        try:
            out[metric.key] = float(raw) * metric.scale
        except (TypeError, ValueError):
            continue
    return out


def catalog_payload() -> list[dict[str, Any]]:
    """Serializable catalog grouped for the UI, in declared order."""
    return [m.as_dict() for m in CATALOG]


def groups() -> list[str]:
    seen: list[str] = []
    for m in CATALOG:
        if m.group not in seen:
            seen.append(m.group)
    return seen
