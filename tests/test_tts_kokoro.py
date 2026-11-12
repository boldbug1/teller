from __future__ import annotations

import asyncio
import io
import wave
from pathlib import Path

import numpy as np
import pytest

from teller.providers.tts_kokoro import KokoroTTS


class FakeKokoroEngine:
    def get_voices(self) -> list[str]:
        return ["af_heart", "am_michael", "bf_emma", "jf_alpha"]

    def create(
        self,
        text: str,
        *,
        voice: str,
        speed: float,
        lang: str,
    ) -> tuple[np.ndarray, int]:
        assert text == "Hello from Teller"
        assert voice == "af_heart"
        assert speed == 1.0
        assert lang == "en-us"
        return np.zeros(240, dtype=np.float32), 24_000


@pytest.fixture
def kokoro_provider(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> KokoroTTS:
    model_path = tmp_path / "model.onnx"
    voices_path = tmp_path / "voices.bin"
    model_path.write_bytes(b"model")
    voices_path.write_bytes(b"voices")
    monkeypatch.setattr("teller.providers.tts_kokoro.validate_kokoro_runtime", lambda: None)
    provider = KokoroTTS(model_path, voices_path)
    provider._engine = FakeKokoroEngine()
    return provider


def test_kokoro_voice_metadata_supports_auto_cast(kokoro_provider: KokoroTTS) -> None:
    voices = asyncio.run(kokoro_provider.list_voices())

    assert [(voice.id, voice.language, voice.gender) for voice in voices] == [
        ("af_heart", "en-us", "female"),
        ("am_michael", "en-us", "male"),
        ("bf_emma", "en-gb", "female"),
        ("jf_alpha", "ja", "female"),
    ]
    assert "narrator" in voices[0].traits


def test_kokoro_synthesis_returns_pcm_wav(kokoro_provider: KokoroTTS) -> None:
    audio = asyncio.run(kokoro_provider.synthesize("Hello from Teller", "af_heart"))

    with wave.open(io.BytesIO(audio), "rb") as wav_file:
        assert wav_file.getframerate() == 24_000
        assert wav_file.getnchannels() == 1
        assert wav_file.getsampwidth() == 2
        assert wav_file.getnframes() == 240
