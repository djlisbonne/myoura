"""Thin async client for the Oura Cloud API v2 (Personal Access Token auth)."""

from __future__ import annotations

from typing import Any

import httpx

from . import auth

BASE_URL = "https://api.ouraring.com"
_PERSONAL_INFO = "/v2/usercollection/personal_info"


class OuraError(RuntimeError):
    """Raised when the Oura API rejects a request or no token is configured."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def token_configured() -> bool:
    return auth.connected()


def _client(token: str) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=BASE_URL,
        headers={"Authorization": f"Bearer {token}"},
        timeout=httpx.Timeout(30.0, connect=10.0),
    )


async def _get(client: httpx.AsyncClient, path: str,
               params: dict[str, Any]) -> dict[str, Any]:
    resp = await client.get(path, params=params)
    if resp.status_code == 401:
        raise OuraError("Oura rejected the access token (401). Check your PAT.", 401)
    if resp.status_code == 429:
        raise OuraError("Oura rate limit reached (429). Try again shortly.", 429)
    if resp.status_code >= 400:
        raise OuraError(
            f"Oura API error {resp.status_code}: {resp.text[:200]}", resp.status_code
        )
    return resp.json()


async def _token() -> str:
    try:
        return await auth.get_access_token()
    except auth.AuthError as exc:
        raise OuraError(str(exc), 401) from exc


async def fetch_collection(path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch every page of a paginated Oura collection endpoint."""
    token = await _token()
    docs: list[dict[str, Any]] = []
    async with _client(token) as client:
        page_params = dict(params)
        while True:
            payload = await _get(client, path, page_params)
            docs.extend(payload.get("data", []))
            next_token = payload.get("next_token")
            if not next_token:
                break
            page_params = dict(params)
            page_params["next_token"] = next_token
    return docs


async def fetch_daily(path: str, start_date: str, end_date: str
                      ) -> list[dict[str, Any]]:
    return await fetch_collection(
        path, {"start_date": start_date, "end_date": end_date}
    )


async def fetch_heartrate(start_datetime: str, end_datetime: str
                          ) -> list[dict[str, Any]]:
    return await fetch_collection(
        "/v2/usercollection/heartrate",
        {"start_datetime": start_datetime, "end_datetime": end_datetime},
    )


async def personal_info() -> dict[str, Any]:
    """Lightweight call used to validate a token and show whose data this is."""
    token = await _token()
    async with _client(token) as client:
        return await _get(client, _PERSONAL_INFO, {})
