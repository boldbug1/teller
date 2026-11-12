from __future__ import annotations

import asyncio
import io
import threading
from pathlib import Path

from teller.models import Voice

_LANGUAGES = {
    "a": "en-us",
    "b": "en-gb",
    "e": "es",
    "f": "fr-fr",
    "h": "hi",
    "i": "it",
    "j": "ja",
    "p": "pt-br",
    "z": "zh",
}

_TRAITS = {
    "af_heart": ["warm", "storyteller", "narrator"],
    "af_bella": ["expressive", "dramatic"],
    "af_nicole": ["conversational", "clear"],
    "bf_emma": ["calm", "clear", "narrator"],
    "am_fenrir": ["excitable", "energetic"],
    "am_michael": ["clear", "steady"],
    "am_puck": ["upbeat", "friendly"],
    "bm_fable": ["storyteller", "warm", "narrator"],
}


def validate_kokoro_runtime() -> None:
    try:
        import kokoro_onnx
        from espeakng_loader import get_data_path, get_library_path
    except Exception as error:
        raise RuntimeError(f"Kokoro runtime is incomplete: {error}") from error

    required_paths = [
        Path(kokoro_onnx.__file__).with_name("config.json"),
        Path(get_library_path()),
        Path(get_data_path()),
    ]
    missing = [str(path) for path in required_paths if not path.exists()]
    if missing:
        raise RuntimeError(f"Kokoro runtime files are missing: {', '.join(missing)}")


class KokoroTTS:
    provider_id = "kokoro"

    def __init__(
        self,
        model_path: Path,
        voices_path: Path,
        *,
        language: str = "en-us",
        model: str = "kokoro-v1.0-int8",
    ):
        if not model_path.exists() or not voices_path.exists():
            raise RuntimeError("Kokoro model assets are missing; run: teller setup")
        validate_kokoro_runtime()
        self.model_id = model
        self.model_path = model_path
        self.voices_path = voices_path
        self.language = language
        self._engine: object | None = None
        self._lock = threading.Lock()

    def _get_engine(self) -> object:
        if self._engine is None:
            with self._lock:
                if self._engine is None:
                    try:
                        from kokoro_onnx import Kokoro

                        self._engine = Kokoro(str(self.model_path), str(self.voices_path))
                    except Exception as error:
                        raise RuntimeError(f"Kokoro failed to initialize: {error}") from error
        return self._engine

    def _voices(self) -> list[Voice]:
        engine = self._get_engine()
        names: list[str] = engine.get_voices()  # type: ignore[attr-defined]
        voices: list[Voice] = []
        for name in names:
            prefix = name.split("_", 1)[0]
            language = _LANGUAGES.get(prefix[0]) if prefix else None
            gender = None
            if len(prefix) > 1:
                gender = {"f": "female", "m": "male"}.get(prefix[1])
            voices.append(
                Voice(
                    id=name,
                    name=name,
                    language=language,
                    gender=gender,
                    traits=_TRAITS.get(name, []),
                )
            )
        return voices

    async def list_voices(self) -> list[Voice]:
        return await asyncio.to_thread(self._voices)

    def _synthesize(self, text: str, voice_id: str, speed: float) -> bytes:
        import soundfile as sound_file

        engine = self._get_engine()
        with self._lock:
            samples, sample_rate = engine.create(  # type: ignore[attr-defined]
                text,
                voice=voice_id,
                speed=speed,
                lang=self.language,
            )
        output = io.BytesIO()
        sound_file.write(output, samples, sample_rate, format="WAV", subtype="PCM_16")
        return output.getvalue()

    async def synthesize(
        self,
        text: str,
        voice_id: str,
        *,
        style: str | None = None,
        speed: float = 1.0,
    ) -> bytes:
        return await asyncio.to_thread(self._synthesize, text, voice_id, speed)
