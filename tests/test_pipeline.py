import io
import wave
from pathlib import Path

import pytest

from teller.config import AppConfig
from teller.models import Character, Segment, Voice, VoiceAssignment
from teller.pipeline import TellerEngine
from teller.player import NullPlayer
from teller.storage import StoryStore


def wav_bytes(sample: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setparams((1, 2, 8_000, 1, "NONE", "not compressed"))
        wav_file.writeframes(sample.to_bytes(2, "little", signed=True))
    return output.getvalue()


class CountingTTS:
    provider_id = "fake"
    model_id = "fake-model"
    language = "en-us"

    def __init__(self) -> None:
        self.calls = 0

    async def list_voices(self) -> list[Voice]:
        return [Voice(id="one", name="One"), Voice(id="two", name="Two")]

    async def synthesize(
        self,
        text: str,
        voice_id: str,
        *,
        style: str | None = None,
        speed: float = 1.0,
    ) -> bytes:
        self.calls += 1
        return wav_bytes(self.calls)


@pytest.mark.asyncio
async def test_second_render_and_playback_make_zero_tts_calls(tmp_path: Path) -> None:
    config = AppConfig()
    config.paths.stories_dir = tmp_path / "stories"
    config.tts.provider = "fake"
    config.tts.model = "fake-model"
    config.tts.concurrency = 2
    store = StoryStore(config.paths.stories_dir)
    project = store.open_or_create('Mira said, "Hello."', "Cache test")
    characters = [
        Character(
            id="narrator",
            name="Narrator",
            voice=VoiceAssignment(
                provider="fake", model="fake-model", voice_id="one", language="en-us"
            ),
        ),
        Character(
            id="mira",
            name="Mira",
            voice=VoiceAssignment(
                provider="fake", model="fake-model", voice_id="two", language="en-us"
            ),
        ),
    ]
    segments = [
        Segment(
            index=0,
            unit_ids=["u000000"],
            speaker_id="narrator",
            text="Mira said, ",
            source_start=0,
            source_end=11,
        ),
        Segment(
            index=1,
            unit_ids=["u000001"],
            speaker_id="mira",
            text='"Hello."',
            source_start=11,
            source_end=19,
        ),
    ]
    tts = CountingTTS()
    player = NullPlayer()
    engine = TellerEngine(config, tts=tts, player=player)

    first = await engine.render(project, segments, characters)
    second = await engine.render(project, segments, characters)
    played = await engine.play(project, segments, characters)

    offline_player = NullPlayer()
    offline_engine = TellerEngine(config, player=offline_player)
    offline = await offline_engine.play(project, segments, characters)

    assert first.generated == 2
    assert second.cache_hits == 2
    assert played.cache_hits == 2
    assert offline.cache_hits == 2
    assert tts.calls == 2
    assert len(player.played) == 2
    assert len(offline_player.played) == 2


@pytest.mark.asyncio
async def test_identical_segments_share_one_inflight_generation(tmp_path: Path) -> None:
    config = AppConfig()
    config.paths.stories_dir = tmp_path / "stories"
    config.tts.provider = "fake"
    config.tts.model = "fake-model"
    character = Character(
        id="narrator",
        name="Narrator",
        voice=VoiceAssignment(
            provider="fake", model="fake-model", voice_id="one", language="en-us"
        ),
    )
    segments = [
        Segment(
            index=index,
            unit_ids=[f"u{index:06d}"],
            speaker_id="narrator",
            text="Repeated line.",
            source_start=index * 14,
            source_end=(index + 1) * 14,
        )
        for index in range(2)
    ]
    store = StoryStore(config.paths.stories_dir)
    project = store.open_or_create("Repeated line. Repeated line.", "Duplicates")
    tts = CountingTTS()
    engine = TellerEngine(config, tts=tts, player=NullPlayer())

    stats = await engine.render(project, segments, [character])

    assert tts.calls == 1
    assert stats.generated == 1
    assert stats.cache_hits == 1
