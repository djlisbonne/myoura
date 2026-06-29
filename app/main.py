"""FastAPI application: REST API + static frontend, served by uvicorn."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__, auth, chat, db, oura, sync
from .config import get_settings
from .metrics import CATALOG_BY_KEY, catalog_payload, groups

app = FastAPI(title="Oura Local", version=__version__)

_STATIC_DIR = Path(__file__).resolve().parent / "static"


@app.on_event("startup")
def _startup() -> None:
    db.connect()


# --- request models ---------------------------------------------------------

class SyncBody(BaseModel):
    start: str | None = None
    end: str | None = None
    heartrate_days: int = 7


class SavedViewBody(BaseModel):
    name: str
    config: dict[str, Any]


class ChatBody(BaseModel):
    question: str
    metrics: list[str] = []
    start: str | None = None
    end: str | None = None
    history: list[dict[str, str]] = []


# --- status & settings ------------------------------------------------------

@app.get("/api/status")
async def status() -> dict[str, Any]:
    settings = get_settings()
    auth_status = auth.status()
    info: dict[str, Any] | None = None
    info_error: str | None = None
    if auth_status["connected"]:
        try:
            info = await oura.personal_info()
        except oura.OuraError as exc:
            info_error = str(exc)
    runs = db.recent_sync_runs(1)
    return {
        "version": __version__,
        "oura_connected": auth_status["connected"],
        "oura_auth": auth_status,
        "oauth_configured": auth.oauth_configured(),
        "redirect_uri": settings.oura_redirect_uri,
        "oura_personal_info": info,
        "oura_error": info_error,
        "chat_enabled": settings.chat_enabled,
        "model": settings.anthropic_model if settings.chat_enabled else None,
        "coverage": db.coverage(),
        "last_sync": runs[0] if runs else None,
    }


# --- Oura OAuth -------------------------------------------------------------

@app.get("/api/auth/login")
def auth_login() -> RedirectResponse:
    try:
        return RedirectResponse(auth.build_authorize_url())
    except auth.AuthError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/auth/callback")
async def auth_callback(code: str | None = None, state: str | None = None,
                        error: str | None = None) -> RedirectResponse:
    if error:
        return RedirectResponse(f"/?oura=error&reason={error}")
    if not code:
        return RedirectResponse("/?oura=error&reason=missing_code")
    try:
        await auth.exchange_code(code, state)
    except auth.AuthError as exc:
        return RedirectResponse(f"/?oura=error&reason={exc}")
    return RedirectResponse("/?oura=connected")


@app.post("/api/auth/disconnect")
def auth_disconnect() -> dict[str, Any]:
    auth.disconnect()
    return {"ok": True}


# --- catalog & data ---------------------------------------------------------

@app.get("/api/catalog")
def catalog() -> dict[str, Any]:
    return {"metrics": catalog_payload(), "groups": groups()}


@app.get("/api/series")
def get_series(metrics: str, start: str | None = None, end: str | None = None
               ) -> dict[str, Any]:
    keys = [k for k in metrics.split(",") if k]
    out: dict[str, Any] = {}
    for key in keys:
        if key not in CATALOG_BY_KEY:
            continue
        out[key] = db.series(key, start, end)
    return {"series": out}


@app.get("/api/heart-rate")
def get_heart_rate(start: str | None = None, end: str | None = None,
                   limit: int = 5000) -> dict[str, Any]:
    return {"points": db.heart_rate_series(start, end, limit)}


@app.get("/api/coverage")
def get_coverage() -> dict[str, Any]:
    return db.coverage()


# --- sync -------------------------------------------------------------------

@app.post("/api/sync")
async def trigger_sync(body: SyncBody) -> dict[str, Any]:
    if not oura.token_configured():
        raise HTTPException(400, "No Oura token configured.")
    try:
        return await sync.run_sync(body.start, body.end, body.heartrate_days)
    except oura.OuraError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.get("/api/sync/runs")
def sync_runs() -> dict[str, Any]:
    return {"runs": db.recent_sync_runs(10)}


# --- saved views ------------------------------------------------------------

@app.get("/api/views")
def get_views() -> dict[str, Any]:
    return {"views": db.list_saved_views()}


@app.post("/api/views")
def add_view(body: SavedViewBody) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Name is required.")
    return db.create_saved_view(name, body.config)


@app.delete("/api/views/{view_id}")
def remove_view(view_id: int) -> dict[str, Any]:
    db.delete_saved_view(view_id)
    return {"ok": True}


# --- chat (SSE) -------------------------------------------------------------

@app.post("/api/chat")
async def post_chat(body: ChatBody) -> StreamingResponse:
    if not get_settings().chat_enabled:
        raise HTTPException(400, "AI chat is not configured (set ANTHROPIC_API_KEY).")
    if not body.question.strip():
        raise HTTPException(400, "Question is empty.")

    async def event_stream():
        try:
            async for chunk in chat.stream_answer(
                body.question, body.metrics, body.start, body.end, body.history
            ):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except Exception as exc:  # noqa: BLE001 — surface error to the client
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- static frontend --------------------------------------------------------

@app.get("/")
def index() -> FileResponse:
    return FileResponse(_STATIC_DIR / "index.html")


app.mount("/", StaticFiles(directory=_STATIC_DIR), name="static")
