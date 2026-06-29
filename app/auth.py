"""Oura OAuth2 (authorization-code) auth.

Oura discontinued Personal Access Tokens in 2025, so connecting is a standard
OAuth2 flow: redirect the user to Oura, receive a code on our callback, exchange
it for an access + refresh token, and refresh transparently when it expires.
Tokens live in the local SQLite store. A legacy PAT in the environment is still
honoured as a fallback.
"""

from __future__ import annotations

import json
import secrets
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from . import db
from .config import get_settings

AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize"
TOKEN_URL = "https://api.ouraring.com/oauth/token"
DEFAULT_SCOPES = [
    "email", "personal", "daily", "heartrate", "workout", "tag", "session", "spo2",
]

_TOKEN_KEY = "oura_oauth_token"
_STATE_KEY = "oura_oauth_state"


class AuthError(RuntimeError):
    """Raised for OAuth configuration / flow problems."""


def oauth_configured() -> bool:
    s = get_settings()
    return bool(s.oura_client_id and s.oura_client_secret)


def _scopes() -> str:
    return " ".join(DEFAULT_SCOPES)


def _load_token() -> dict[str, Any] | None:
    raw = db.get_setting(_TOKEN_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def _save_token(tok: dict[str, Any]) -> None:
    db.set_setting(_TOKEN_KEY, json.dumps(tok))


def build_authorize_url() -> str:
    s = get_settings()
    if not oauth_configured():
        raise AuthError(
            "OURA_CLIENT_ID / OURA_CLIENT_SECRET are not configured. Create an "
            "application at cloud.ouraring.com and set them in .env."
        )
    state = secrets.token_urlsafe(24)
    db.set_setting(_STATE_KEY, state)
    params = {
        "response_type": "code",
        "client_id": s.oura_client_id,
        "redirect_uri": s.oura_redirect_uri,
        "scope": _scopes(),
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


async def _post_token(data: dict[str, str]) -> dict[str, Any]:
    s = get_settings()
    body = {**data, "client_id": s.oura_client_id, "client_secret": s.oura_client_secret}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            TOKEN_URL, data=body, headers={"Accept": "application/json"}
        )
    if resp.status_code >= 400:
        raise AuthError(
            f"Oura token endpoint error {resp.status_code}: {resp.text[:200]}"
        )
    return resp.json()


def _store_response(payload: dict[str, Any], prior: dict[str, Any] | None = None
                    ) -> dict[str, Any]:
    now = int(time.time())
    expires_in = payload.get("expires_in")
    prior = prior or {}
    tok = {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token") or prior.get("refresh_token"),
        "token_type": payload.get("token_type", "bearer"),
        "scope": payload.get("scope") or prior.get("scope"),
        "expires_at": (now + int(expires_in)) if expires_in else None,
        "obtained_at": now,
    }
    _save_token(tok)
    return tok


async def exchange_code(code: str, state: str | None) -> dict[str, Any]:
    expected = db.get_setting(_STATE_KEY)
    if not expected or state != expected:
        raise AuthError("OAuth state mismatch — please retry the connection.")
    db.set_setting(_STATE_KEY, "")
    s = get_settings()
    payload = await _post_token({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": s.oura_redirect_uri,
    })
    return _store_response(payload)


async def _refresh(tok: dict[str, Any]) -> dict[str, Any]:
    if not tok.get("refresh_token"):
        raise AuthError("Access token expired and no refresh token is available. "
                        "Reconnect Oura.")
    payload = await _post_token({
        "grant_type": "refresh_token",
        "refresh_token": tok["refresh_token"],
    })
    return _store_response(payload, tok)


async def get_access_token() -> str:
    """A valid bearer token, refreshing first if it's about to expire."""
    tok = _load_token()
    if tok:
        exp = tok.get("expires_at")
        if exp and time.time() >= exp - 60:
            tok = await _refresh(tok)
        return tok["access_token"]
    pat = get_settings().oura_personal_access_token
    if pat:
        return pat
    raise AuthError("Not connected to Oura. Connect via Settings.")


def connected() -> bool:
    return _load_token() is not None or bool(
        get_settings().oura_personal_access_token
    )


def disconnect() -> None:
    db.set_setting(_TOKEN_KEY, "")
    db.set_setting(_STATE_KEY, "")


def status() -> dict[str, Any]:
    tok = _load_token()
    s = get_settings()
    if tok:
        return {"connected": True, "mode": "oauth", "scope": tok.get("scope"),
                "expires_at": tok.get("expires_at")}
    if s.oura_personal_access_token:
        return {"connected": True, "mode": "pat", "scope": None, "expires_at": None}
    return {
        "connected": False, "mode": "none", "scope": None, "expires_at": None,
        "oauth_configured": oauth_configured(), "redirect_uri": s.oura_redirect_uri,
    }
