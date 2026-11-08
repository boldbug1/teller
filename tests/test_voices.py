import io
import wave

import pytest

from teller.models import Character, Voice, VoiceAssignment
from teller.voices import assign_voices


class FakeTTS:
    provider_id = "fake"
    model_id = "fake-model"
    language = None

    async def list_voices(self) -> list[Voice]:
        return [
            Voice(id="narrator", name="Narrator", traits=["warm", "storyteller"]),
            Voice(id="female", name="Female", gender="female", traits=["calm"]),
            Voice(id="male", name="Male", gender="male", traits=["bold"]),
        ]

    async def synthesize(
        self,
        text: str,
        voice_id: str,
        *,
        style: str | None = None,
        speed: float = 1.0,
    ) -> bytes:
        output = io.BytesIO()
        with wave.open(output, "wb") as wav_file:
            wav_file.setparams((1, 2, 8_000, 1, "NONE", "not compressed"))
            wav_file.writeframes(b"\0\0")
        return output.getvalue()


@pytest.mark.asyncio
async def test_voice_assignment_is_distinct_and_persistent() -> None:
    characters = [
        Character(id="narrator", name="Narrator"),
        Character(id="mira", name="Mira", gender="female", traits=["calm"]),
    ]
    provider = FakeTTS()

    assigned = await assign_voices(characters, provider)
    first = [character.voice for character in assigned]
    assigned_again = await assign_voices(assigned, provider)

    assert assigned[0].voice is not None
    assert assigned[0].voice.voice_id == "narrator"
    assert assigned[1].voice is not None
    assert assigned[1].voice.voice_id == "female"
    assert [character.voice for character in assigned_again] == first


@pytest.mark.asyncio
async def test_different_provider_requires_explicit_reassignment() -> None:
    character = Character(
        id="narrator",
        name="Narrator",
        voice=VoiceAssignment(provider="other", model="x", voice_id="x"),
    )

    with pytest.raises(RuntimeError, match="--reassign-voices"):
        await assign_voices([character], FakeTTS())


@pytest.mark.asyncio
async def test_voice_assignment_filters_to_provider_language() -> None:
    provider = FakeTTS()
    provider.language = "en-us"

    async def voices() -> list[Voice]:
        return [
            Voice(id="english", name="English", language="en-us"),
            Voice(id="japanese", name="Japanese", language="ja"),
        ]

    provider.list_voices = voices  # type: ignore[method-assign]
    assigned = await assign_voices([Character(id="narrator", name="Narrator")], provider)

    assert assigned[0].voice is not None
    assert assigned[0].voice.voice_id == "english"


@pytest.mark.asyncio
async def test_voice_assignment_rejects_unsupported_language() -> None:
    provider = FakeTTS()
    provider.language = "de"

    async def voices() -> list[Voice]:
        return [Voice(id="english", name="English", language="en-us")]

    provider.list_voices = voices  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="No voices support"):
        await assign_voices([Character(id="narrator", name="Narrator")], provider)
