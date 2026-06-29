"""Context-grounded AI chat over the user's Oura data, powered by Claude.

The server pulls the series for whatever metrics are in view and hands Claude a
compact, factual summary so answers stay grounded in real data rather than
guesses. Responses stream token-by-token over SSE.
"""

from __future__ import annotations

import statistics
from typing import Any, AsyncGenerator

from . import db
from .config import get_settings
from .metrics import CATALOG_BY_KEY

SYSTEM_PROMPT = """\
You are an analyst embedded in a personal Oura Ring dashboard. You help the user \
explore and interpret their own health data.

Ground every claim in the DATA IN VIEW provided with the question. The data is \
real, pulled live from the user's local store. Rules:
- Only reference metrics and values present in the provided data. Never invent \
numbers or metrics that weren't given.
- When useful, point out trends, correlations between metrics, anomalies, and \
plausible physiological explanations — but flag correlation vs. causation.
- Be concise and concrete. Lead with the answer, then the supporting detail.
- Units and date ranges are given; respect them.
- You are not a doctor; for anything clinical, suggest consulting one rather than \
diagnosing.
If the data needed to answer isn't in view, say so and suggest which metric or \
date range to add."""

_MAX_POINTS_PER_METRIC = 180


def _summarize_metric(key: str, start: str | None, end: str | None
                      ) -> dict[str, Any] | None:
    metric = CATALOG_BY_KEY.get(key)
    if metric is None:
        return None
    points = db.series(key, start, end)
    if not points:
        return {"key": key, "label": metric.label, "unit": metric.unit,
                "count": 0, "series": []}
    values = [p["value"] for p in points]
    # Thin out long series so the prompt stays small but still representative.
    if len(points) > _MAX_POINTS_PER_METRIC:
        step = len(points) // _MAX_POINTS_PER_METRIC + 1
        sampled = points[::step]
    else:
        sampled = points
    return {
        "key": key,
        "label": metric.label,
        "unit": metric.unit,
        "count": len(values),
        "mean": round(statistics.fmean(values), 3),
        "min": round(min(values), 3),
        "max": round(max(values), 3),
        "latest": {"day": points[-1]["day"], "value": round(values[-1], 3)},
        "series": [[p["day"], round(p["value"], 3)] for p in sampled],
    }


def build_context(metric_keys: list[str], start: str | None, end: str | None
                  ) -> str:
    cov = db.coverage()
    blocks: list[dict[str, Any]] = []
    for key in metric_keys:
        summary = _summarize_metric(key, start, end)
        if summary is not None:
            blocks.append(summary)

    import json

    header = {
        "date_range": {"start": start, "end": end},
        "store_coverage": {
            "first_day": cov["first_day"], "last_day": cov["last_day"],
            "days_with_data": cov["days"],
        },
    }
    return (
        "DATA IN VIEW\n"
        + json.dumps(header)
        + "\n\nMETRICS (series is [day, value] pairs):\n"
        + json.dumps(blocks)
    )


async def stream_answer(question: str, metric_keys: list[str],
                        start: str | None, end: str | None,
                        history: list[dict[str, str]] | None = None
                        ) -> AsyncGenerator[str, None]:
    settings = get_settings()
    # Imported lazily: the anthropic SDK is a large, slow import, and the chat
    # feature is optional and used on demand — keep it off the startup path so
    # the server boots fast even on a busy machine.
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    context = build_context(metric_keys, start, end)
    messages: list[dict[str, Any]] = []
    for turn in (history or [])[-6:]:
        role = "assistant" if turn.get("role") == "assistant" else "user"
        content = turn.get("content", "")
        if content:
            messages.append({"role": role, "content": content})
    messages.append({
        "role": "user",
        "content": f"{context}\n\nQUESTION: {question}",
    })

    async with client.messages.stream(
        model=settings.anthropic_model,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        thinking={"type": "adaptive"},
        messages=messages,
    ) as stream:
        async for event in stream:
            if event.type == "content_block_delta" and event.delta.type == "text_delta":
                yield event.delta.text
