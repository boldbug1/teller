from __future__ import annotations

from typing import Any, Protocol

from teller.models import Voice


class LLMProvider(Protocol):
    provider_id: str
    model_id: str

    async def generate(self, prompt: str, schema: dict[str, Any] | None = None) -> str: ...


class TTSProvider(Protocol):
    provider_id: str
    model_id: str

    @property
    def language(self) -> str | None: ...

    async def list_voices(self) -> list[Voice]: ...

    async def synthesize(
        self,
        text: str,
        voice_id: str,
        *,
        style: str | None = None,
        speed: float = 1.0,
    ) -> bytes: ...


class AudioPlayer(Protocol):
    async def play(self, wav_audio: bytes) -> None: ...
