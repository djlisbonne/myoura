"""Runtime configuration, loaded once from the environment (.env supported)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the project root if present. Real environment variables win.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_PROJECT_ROOT / ".env")


class Settings:
    """Process-wide settings. Read from the environment at startup."""

    project_root: Path = _PROJECT_ROOT

    def __init__(self) -> None:
        self.host: str = os.getenv("HOST", "127.0.0.1")
        self.port: int = int(os.getenv("PORT", "8000"))

        # Oura: a Personal Access Token is the only credential needed.
        self.oura_personal_access_token: str | None = (
            os.getenv("OURA_PERSONAL_ACCESS_TOKEN") or None
        )

        # Anthropic (optional): drives the AI chat panel.
        self.anthropic_api_key: str | None = os.getenv("ANTHROPIC_API_KEY") or None
        self.anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-opus-4-8")

        db_path = os.getenv("OURA_DB_PATH", "data/oura.db")
        self.db_path: Path = (
            Path(db_path) if os.path.isabs(db_path) else _PROJECT_ROOT / db_path
        )

    @property
    def chat_enabled(self) -> bool:
        return self.anthropic_api_key is not None

    @property
    def oura_token_configured(self) -> bool:
        return self.oura_personal_access_token is not None


@lru_cache
def get_settings() -> Settings:
    return Settings()
