from __future__ import annotations

import asyncio
import io
import json
import wave
from pathlib import Path
from typing import Any

import httpx
import pytest
from starlette.testclient import TestClient

from teller.api import create_app
from teller.config import AppConfig, save_config
from teller.models import Voice


def make_valid_wav() -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(b"\x00\x00" * 100)
    return buf.getvalue()


SAMPLE_WAV_BYTES = make_valid_wav()


class FakeLLM:
    provider_id = "fake-llm"
    model_id = "fake-model"

    def __init__(self, delay: float = 0.0):
        self.delay = delay

    async def generate(self, prompt: str, schema: dict[str, Any] | None = None) -> str:
        if self.delay > 0:
            await asyncio.sleep(self.delay)
        return json.dumps(
            {
                "characters": [
                    {"ref": "narrator", "name": "Narrator"},
                    {"ref": "alice", "name": "Alice", "gender": "female"},
                ],
                "assignments": [
                    {"unit_id": "u000000", "speaker_ref": "narrator", "emotion": "calm"},
                ],
            }
        )


class FakeTTS:
    provider_id = "fake-tts"
    model_id = "fake-tts-model"
    language = "en-us"

    async def list_voices(self) -> list[Voice]:
        return [
            Voice(id="voice-1", name="AliceVoice", gender="female", traits=["clear"]),
            Voice(id="voice-2", name="NarratorVoice", traits=["neutral"]),
        ]

    async def synthesize(
        self,
        text: str,
        voice_id: str,
        *,
        style: str | None = None,
        speed: float = 1.0,
    ) -> bytes:
        return SAMPLE_WAV_BYTES


@pytest.fixture
def test_env(tmp_path: Path) -> tuple[AppConfig, str, TestClient]:
    stories_dir = tmp_path / "stories"
    stories_dir.mkdir(parents=True, exist_ok=True)
    config = AppConfig()
    config.paths.stories_dir = stories_dir
    config_path = tmp_path / "config.toml"
    save_config(config, config_path)

    token = "secret-test-token"
    app = create_app(api_token=token, config=config)
    client = TestClient(app)
    return config, token, client


def test_health_check_requires_no_auth(test_env: tuple[AppConfig, str, TestClient]) -> None:
    _, _, client = test_env
    response = client.get("/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


def test_auth_rejection_and_acceptance(test_env: tuple[AppConfig, str, TestClient]) -> None:
    _, token, client = test_env

    # Missing auth
    res_no_auth = client.get("/v1/config")
    assert res_no_auth.status_code == 401

    # Invalid token
    res_bad_auth = client.get("/v1/config", headers={"Authorization": "Bearer bad-token"})
    assert res_bad_auth.status_code == 401

    # Valid token
    res_good_auth = client.get("/v1/config", headers={"Authorization": f"Bearer {token}"})
    assert res_good_auth.status_code == 200


def test_story_paste_and_listing_with_malformed_isolation(
    test_env: tuple[AppConfig, str, TestClient],
) -> None:
    config, token, client = test_env
    auth = {"Authorization": f"Bearer {token}"}

    # Paste a story
    paste_res = client.post(
        "/v1/stories/paste",
        json={"text": "It was a dark and stormy night.", "title": "Stormy Night"},
        headers=auth,
    )
    assert paste_res.status_code == 200
    pasted = paste_res.json()
    assert pasted["title"] == "Stormy Night"
    assert pasted["story_id"].startswith("stormy-night-")

    # Create a malformed story directory
    malformed_dir = config.paths.stories_dir / "corrupted-story"
    malformed_dir.mkdir(parents=True, exist_ok=True)
    (malformed_dir / "manifest.json").write_text("{invalid json", encoding="utf-8")

    # Listing must succeed and isolate the malformed one
    list_res = client.get("/v1/stories", headers=auth)
    assert list_res.status_code == 200
    stories = list_res.json()
    assert len(stories) == 1
    assert stories[0]["story_id"] == pasted["story_id"]


def test_story_import_validation(
    test_env: tuple[AppConfig, str, TestClient], tmp_path: Path
) -> None:
    _, token, client = test_env
    auth = {"Authorization": f"Bearer {token}"}

    # Import non-existent file
    res_not_found = client.post(
        "/v1/stories/import",
        json={"path": str(tmp_path / "nonexistent.txt")},
        headers=auth,
    )
    assert res_not_found.status_code == 400

    # Import empty file
    empty_file = tmp_path / "empty.txt"
    empty_file.write_text("   \n  ", encoding="utf-8")
    res_empty = client.post(
        "/v1/stories/import",
        json={"path": str(empty_file)},
        headers=auth,
    )
    assert res_empty.status_code == 400

    # Import valid file with explicit title
    valid_file = tmp_path / "valid.txt"
    valid_file.write_text("Once upon a time in a distant land.", encoding="utf-8")
    res_valid = client.post(
        "/v1/stories/import",
        json={"path": str(valid_file), "title": "Distant Land"},
        headers=auth,
    )
    assert res_valid.status_code == 200
    assert res_valid.json()["title"] == "Distant Land"

    # Auto title extraction from markdown header without user title
    md_file = tmp_path / "story_with_header.md"
    md_file.write_text("# The Whispering Woods\n\nThe trees seemed alive.", encoding="utf-8")
    res_auto = client.post(
        "/v1/stories/import",
        json={"path": str(md_file)},
        headers=auth,
    )
    assert res_auto.status_code == 200
    assert res_auto.json()["title"] == "The Whispering Woods"

    # Auto title extraction from pasted text without user title
    res_paste = client.post(
        "/v1/stories/paste",
        json={"text": "A Midnight Encounter\n\nIt was a dark stormy night."},
        headers=auth,
    )
    assert res_paste.status_code == 200
    assert res_paste.json()["title"] == "A Midnight Encounter"


def test_secrets_and_config_endpoints(test_env: tuple[AppConfig, str, TestClient]) -> None:
    _, token, client = test_env
    auth = {"Authorization": f"Bearer {token}"}

    # Set secret
    res_set = client.post("/v1/secrets/gemini", json={"key": "my-gemini-key"}, headers=auth)
    assert res_set.status_code == 200
    assert res_set.json()["provider"] == "gemini"

    # Delete secret
    res_del = client.delete("/v1/secrets/gemini", headers=auth)
    assert res_del.status_code == 200

    # Patch config
    patch_res = client.patch(
        "/v1/config",
        json={"playback": {"lookahead": 5}},
        headers=auth,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["playback"]["lookahead"] == 5


@pytest.mark.asyncio
async def test_vertical_slice_analyze_render_and_fetch_audio(
    test_env: tuple[AppConfig, str, TestClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config, token, _ = test_env
    auth = {"Authorization": f"Bearer {token}"}

    monkeypatch.setattr("teller.api.create_llm", lambda cfg: FakeLLM(delay=0.08))
    monkeypatch.setattr("teller.api.create_tts", lambda cfg: FakeTTS())

    app = create_app(api_token=token, config=config)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        # 1. Paste story
        paste_res = await client.post(
            "/v1/stories/paste",
            json={"text": "Hello world from Teller desktop.", "title": "Desktop Story"},
            headers=auth,
        )
        assert paste_res.status_code == 200
        story_id = paste_res.json()["story_id"]

        # 2. Trigger analysis & test de-duplication
        analyze_res1 = await client.post(f"/v1/stories/{story_id}/analyze", headers=auth)
        assert analyze_res1.status_code == 200
        op_id1 = analyze_res1.json()["operation_id"]

        analyze_res2 = await client.post(f"/v1/stories/{story_id}/analyze", headers=auth)
        assert analyze_res2.status_code == 200
        op_id2 = analyze_res2.json()["operation_id"]
        assert op_id1 == op_id2

        # Wait for operation completion
        for _ in range(50):
            res = await client.get(f"/v1/operations/{op_id1}", headers=auth)
            op_status = res.json()
            if op_status["state"] in ("completed", "failed"):
                break
            await asyncio.sleep(0.05)

        assert op_status["state"] == "completed", f"Analysis failed: {op_status.get('error')}"

        # 3. Check cast and update voice
        cast_res = await client.get(f"/v1/stories/{story_id}/cast", headers=auth)
        assert cast_res.status_code == 200
        cast = cast_res.json()
        assert len(cast) >= 1

        # 4. Auto-cast replaces incompatible saved providers and persists every voice.
        char_id = cast[0]["id"]
        incompatible_res = await client.patch(
            f"/v1/stories/{story_id}/cast/{char_id}",
            json={"voice_id": "legacy", "provider": "other-tts", "model": "old-model"},
            headers=auth,
        )
        assert incompatible_res.status_code == 200

        # Unrelated cache files from a previous provider must not mark the new cast as rendered.
        stale_audio = config.paths.stories_dir / story_id / "audio" / "stale-provider.wav"
        stale_audio.write_bytes(SAMPLE_WAV_BYTES)
        detail_res = await client.get(f"/v1/stories/{story_id}", headers=auth)
        assert detail_res.status_code == 200
        assert detail_res.json()["rendered_count"] == 0

        reassign_res = await client.post(
            f"/v1/stories/{story_id}/reassign-voices", headers=auth
        )
        assert reassign_res.status_code == 200
        reassign_op_id = reassign_res.json()["operation_id"]
        for _ in range(50):
            res = await client.get(f"/v1/operations/{reassign_op_id}", headers=auth)
            op_status = res.json()
            if op_status["state"] in ("completed", "failed"):
                break
            await asyncio.sleep(0.05)
        assert op_status["state"] == "completed", f"Auto-cast failed: {op_status.get('error')}"

        cast_res = await client.get(f"/v1/stories/{story_id}/cast", headers=auth)
        cast = cast_res.json()
        assert all(character["voice"]["provider"] == "fake-tts" for character in cast)
        assert all(character["voice"]["model"] == "fake-tts-model" for character in cast)

        # 5. A manual override remains available after auto-casting.
        patch_cast_res = await client.patch(
            f"/v1/stories/{story_id}/cast/{char_id}",
            json={"voice_id": "voice-2", "provider": "fake-tts", "model": "fake-tts-model"},
            headers=auth,
        )
        assert patch_cast_res.status_code == 200
        assert patch_cast_res.json()["voice"]["voice_id"] == "voice-2"

        # 6. Trigger render
        render_res = await client.post(f"/v1/stories/{story_id}/render", headers=auth)
        assert render_res.status_code == 200
        render_op_id = render_res.json()["operation_id"]

        for _ in range(50):
            res = await client.get(f"/v1/operations/{render_op_id}", headers=auth)
            op_status = res.json()
            if op_status["state"] in ("completed", "failed"):
                break
            await asyncio.sleep(0.05)

        assert op_status["state"] == "completed", f"Render failed: {op_status.get('error')}"

        # 7. Fetch audio segment
        audio_res = await client.get(f"/v1/stories/{story_id}/segments/0/audio", headers=auth)
        assert audio_res.status_code == 200
        assert audio_res.headers["content-type"] == "audio/wav"
        assert audio_res.content == SAMPLE_WAV_BYTES

        # 6. Delete story
        del_res = await client.delete(f"/v1/stories/{story_id}", headers=auth)
        assert del_res.status_code == 200

        # Verify deleted
        not_found_res = await client.get(f"/v1/stories/{story_id}", headers=auth)
        assert not_found_res.status_code == 404
