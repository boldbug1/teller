from __future__ import annotations

import io
import wave
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from teller.api import create_app
from teller.audio_export import slugify_filename, stitch_story_audio
from teller.cache import AudioCache, audio_cache_key
from teller.config import AppConfig, save_config
from teller.models import Character, Segment, StoryManifest, StoryProject, VoiceAssignment
from teller.storage import StoryStore


def _make_wav(duration_ms: int = 100, framerate: int = 24000, nchannels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(nchannels)
        w.setsampwidth(2)
        w.setframerate(framerate)
        frames_count = int(framerate * (duration_ms / 1000.0))
        w.writeframes(b"\x10\x00" * (frames_count * nchannels))
    return buf.getvalue()


def test_slugify_filename() -> None:
    assert slugify_filename("The Monkey's Paw") == "The_Monkeys_Paw.wav"
    assert slugify_filename("Chapter 1: The Dark & Stormy Night!") == "Chapter_1_The_Dark_Stormy_Night.wav"
    assert slugify_filename("  ---  ") == "story.wav"
    assert slugify_filename("Audio Story", ext="mp3") == "Audio_Story.mp3"


def test_stitch_story_audio(tmp_path: Path) -> None:
    story_dir = tmp_path / "test-story"
    story_dir.mkdir(parents=True)
    audio_dir = story_dir / "audio"
    audio_dir.mkdir()

    config = AppConfig()
    project = StoryProject(
        path=story_dir,
        manifest=StoryManifest(
            story_id="test-story",
            title="A Grand Tale",
            source_sha256="abc12345",
            created_at="2026-01-01T00:00:00Z",
        ),
    )

    chars = [
        Character(
            id="narrator",
            name="Narrator",
            voice=VoiceAssignment(provider="test-tts", model="model-1", voice_id="v-narrator"),
        ),
        Character(
            id="alice",
            name="Alice",
            voice=VoiceAssignment(provider="test-tts", model="model-1", voice_id="v-alice"),
        ),
    ]

    segments = [
        Segment(index=0, unit_ids=["u0"], speaker_id="narrator", text="It was a dark night.", source_start=0, source_end=19),
        Segment(index=1, unit_ids=["u1"], speaker_id="alice", text="Who goes there?", source_start=20, source_end=35),
    ]

    cache = AudioCache(audio_dir)
    wav1 = _make_wav(duration_ms=200, framerate=24000)
    wav2 = _make_wav(duration_ms=300, framerate=24000)

    key1 = audio_cache_key(provider="test-tts", model="model-1", voice_id="v-narrator", text="It was a dark night.", style=None, speed=config.tts.speed, language=config.tts.language)
    key2 = audio_cache_key(provider="test-tts", model="model-1", voice_id="v-alice", text="Who goes there?", style=None, speed=config.tts.speed, language=config.tts.language)

    cache.put(key1, wav1)
    cache.put(key2, wav2)

    stitched, duration, count = stitch_story_audio(
        project,
        segments,
        chars,
        config,
        speaker_pause_ms=250,
        same_speaker_pause_ms=100,
    )

    assert count == 2
    # 200ms + 250ms (pause) + 300ms = 750ms = 0.75s
    assert abs(duration - 0.75) < 0.05
    assert len(stitched) > 0

    with wave.open(io.BytesIO(stitched), "rb") as check_wave:
        assert check_wave.getframerate() == 24000
        assert check_wave.getnchannels() == 1


def test_stitch_story_audio_raises_when_empty(tmp_path: Path) -> None:
    story_dir = tmp_path / "empty-story"
    story_dir.mkdir(parents=True)
    (story_dir / "audio").mkdir()

    config = AppConfig()
    project = StoryProject(
        path=story_dir,
        manifest=StoryManifest(
            story_id="empty-story",
            title="Empty",
            source_sha256="abc12345",
            created_at="2026-01-01T00:00:00Z",
        ),
    )

    with pytest.raises(ValueError, match="No rendered audio"):
        stitch_story_audio(project, [], [], config)


def test_api_download_and_export(tmp_path: Path) -> None:
    stories_dir = tmp_path / "stories"
    stories_dir.mkdir(parents=True)
    config = AppConfig()
    config.paths.stories_dir = stories_dir
    save_config(config, tmp_path / "config.toml")

    token = "test-token"
    app = create_app(api_token=token, config=config)
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token}"}

    # Import story
    resp = client.post("/v1/stories/paste", json={"title": "The Golden Key", "text": "Once upon a time. Hello said Key."}, headers=headers)
    assert resp.status_code == 200
    story_id = resp.json()["story_id"]

    # Trying to download before analysis/render -> 400
    err_resp = client.get(f"/v1/stories/{story_id}/download", headers=headers)
    assert err_resp.status_code == 400

    # Manually populate analysis & audio cache for testing
    store = StoryStore(stories_dir)
    project = store.find(story_id)
    chars = [
        Character(id="narrator", name="Narrator", voice=VoiceAssignment(provider="fake-tts", model="model", voice_id="v1")),
    ]
    segs = [
        Segment(index=0, unit_ids=["u0"], speaker_id="narrator", text="Once upon a time.", source_start=0, source_end=17),
    ]
    store.save_analysis(project, segs, chars)

    wav_bytes = _make_wav(duration_ms=500)
    cache = AudioCache(project.path / "audio")
    key = audio_cache_key(provider="fake-tts", model="model", voice_id="v1", text="Once upon a time.", style=None, speed=config.tts.speed, language=config.tts.language)
    cache.put(key, wav_bytes)

    # Now download should succeed
    dl_resp = client.get(f"/v1/stories/{story_id}/download", headers=headers)
    assert dl_resp.status_code == 200
    assert dl_resp.headers["content-type"] == "audio/wav"
    assert "attachment; filename=\"The_Golden_Key.wav\"" in dl_resp.headers["content-disposition"]
    assert len(dl_resp.content) > 0

    # Also test POST export endpoint
    export_target = tmp_path / "exported" / "custom_key.wav"
    exp_resp = client.post(
        f"/v1/stories/{story_id}/export",
        json={"target_path": str(export_target)},
        headers=headers,
    )
    assert exp_resp.status_code == 200
    data = exp_resp.json()
    assert data["filename"] == "The_Golden_Key.wav"
    assert export_target.exists()
    assert export_target.stat().st_size > 0
