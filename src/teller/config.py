from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from platformdirs import PlatformDirs
from pydantic import BaseModel, Field

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10 only
    import tomli as tomllib  # type: ignore[no-redef]


APP_DIRS = PlatformDirs("teller", appauthor=False)


class LLMConfig(BaseModel):
    provider: str = "gemini"
    model: str = "gemini-3.8-flash"
    base_url: str | None = None
    api_key_env: str = "GEMINI_API_KEY"
    max_chunk_chars: int = Field(default=8_000, ge=1_000)
    retries: int = Field(default=2, ge=0, le=5)


class TTSConfig(BaseModel):
    provider: str = "gemini"
    model: str = "gemini-3.8-flash-lite-tts"
    api_key_env: str = "GEMINI_API_KEY"
    language: str = "en-us"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    concurrency: int = Field(default=3, ge=1, le=16)


class PlaybackConfig(BaseModel):
    lookahead: int = Field(default=3, ge=1, le=20)
    speaker_pause_ms: int = Field(default=180, ge=0, le=5_000)


class PathsConfig(BaseModel):
    stories_dir: Path = Path("stories")
    assets_dir: Path = Path(APP_DIRS.user_data_dir) / "models"


class AppConfig(BaseModel):
    llm: LLMConfig = Field(default_factory=LLMConfig)
    tts: TTSConfig = Field(default_factory=TTSConfig)
    playback: PlaybackConfig = Field(default_factory=PlaybackConfig)
    paths: PathsConfig = Field(default_factory=PathsConfig)


def default_config_path() -> Path:
    override = os.environ.get("TELLER_CONFIG")
    return (
        Path(override).expanduser() if override else Path(APP_DIRS.user_config_dir) / "config.toml"
    )


def load_config(path: Path | None = None) -> AppConfig:
    config_path = path or default_config_path()
    if not config_path.exists():
        return AppConfig()
    with config_path.open("rb") as handle:
        data = tomllib.load(handle)
    return AppConfig.model_validate(data)


def _toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def save_config(config: AppConfig, path: Path | None = None) -> Path:
    config_path = path or default_config_path()
    config_path.parent.mkdir(parents=True, exist_ok=True)
    data = config.model_dump(mode="json")
    lines: list[str] = []
    for section in ("llm", "tts", "playback", "paths"):
        lines.append(f"[{section}]")
        for key, value in data[section].items():
            if value is not None:
                lines.append(f"{key} = {_toml_value(value)}")
        lines.append("")
    temporary = config_path.with_suffix(".tmp")
    temporary.write_text("\n".join(lines), encoding="utf-8")
    temporary.replace(config_path)
    return config_path
