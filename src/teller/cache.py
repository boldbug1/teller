from __future__ import annotations

import hashlib
import io
import json
import wave
from pathlib import Path
from typing import Any

from teller.storage import atomic_write_bytes

CACHE_VERSION = 1


def audio_cache_key(
    *,
    provider: str,
    model: str,
    voice_id: str,
    text: str,
    style: str | None,
    speed: float,
    language: str | None,
) -> str:
    payload = {
        "version": CACHE_VERSION,
        "provider": provider,
        "model": model,
        "voice_id": voice_id,
        "text": text,
        "style": style,
        "speed": speed,
        "language": language,
        "format": "wav",
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_wav(content: bytes) -> None:
    if not content:
        raise ValueError("TTS provider returned empty audio")
    try:
        with wave.open(io.BytesIO(content), "rb") as wav_file:
            if wav_file.getnframes() <= 0 or wav_file.getframerate() <= 0:
                raise ValueError("WAV file contains no playable frames")
    except (EOFError, wave.Error) as error:
        raise ValueError("TTS provider returned an invalid WAV file") from error


class AudioCache:
    def __init__(self, directory: Path):
        self.directory = directory

    def path(self, key: str) -> Path:
        return self.directory / f"{key}.wav"

    def get(self, key: str) -> bytes | None:
        path = self.path(key)
        if not path.exists():
            return None
        content = path.read_bytes()
        try:
            validate_wav(content)
        except ValueError:
            path.unlink(missing_ok=True)
            return None
        return content

    def has(self, key: str) -> bool:
        path = self.path(key)
        if not path.exists():
            return False
        try:
            with wave.open(str(path), "rb") as wav_file:
                valid = wav_file.getnframes() > 0 and wav_file.getframerate() > 0
        except (EOFError, OSError, wave.Error):
            valid = False
        if not valid:
            path.unlink(missing_ok=True)
        return valid

    def put(self, key: str, content: bytes) -> Path:
        validate_wav(content)
        path = self.path(key)
        atomic_write_bytes(path, content)
        return path

    def describe(self) -> dict[str, Any]:
        files = list(self.directory.glob("*.wav")) if self.directory.exists() else []
        return {"files": len(files), "bytes": sum(path.stat().st_size for path in files)}
