import io
import wave

import pytest

from teller.cache import AudioCache, audio_cache_key


def wav_bytes() -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setparams((1, 2, 8_000, 1, "NONE", "not compressed"))
        wav_file.writeframes(b"\0\0")
    return output.getvalue()


def test_cache_key_includes_model_and_exact_text() -> None:
    base = {
        "provider": "test",
        "model": "one",
        "voice_id": "voice",
        "text": "Hello.",
        "style": None,
        "speed": 1.0,
        "language": "en-us",
    }

    first = audio_cache_key(**base)
    assert first == audio_cache_key(**base)
    assert first != audio_cache_key(**{**base, "model": "two"})
    assert first != audio_cache_key(**{**base, "text": "Hello!"})


def test_cache_rejects_invalid_audio_and_reads_valid_audio(tmp_path) -> None:
    cache = AudioCache(tmp_path)

    with pytest.raises(ValueError, match="invalid WAV"):
        cache.put("bad", b"not audio")

    content = wav_bytes()
    cache.put("good", content)
    assert cache.get("good") == content
