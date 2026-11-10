from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from typer.testing import CliRunner

from teller.cli import app
from teller.config import AppConfig, save_config
from teller.providers.factory import create_tts
from teller.providers.tts_elevenlabs import ElevenLabsTTS

# Standard minimum valid RIFF/WAVE header
SAMPLE_WAV_HEADER = (
    b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
    b"\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
)


@pytest.mark.asyncio
async def test_elevenlabs_list_voices_pagination_and_deduplication() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.headers["xi-api-key"] == "test-key"
        assert request.url.path == "/v2/voices"

        if "next_page_token" not in request.url.params:
            return httpx.Response(
                200,
                json={
                    "voices": [
                        {
                            "voice_id": "v1",
                            "name": "Rachel",
                            "labels": {
                                "gender": "female",
                                "age": "young",
                                "accent": "american",
                                "use_case": "narration",
                                "description": "calm",
                                "custom": "warm",
                            },
                            "category": "premade",
                        }
                    ],
                    "has_more": True,
                    "next_page_token": "token-page-2",
                },
            )
        else:
            assert request.url.params["next_page_token"] == "token-page-2"
            return httpx.Response(
                200,
                json={
                    "voices": [
                        {
                            "voice_id": "v2",
                            "name": "Domi",
                            "labels": None,
                            "category": "cloned",
                        }
                    ],
                    "has_more": False,
                    "next_page_token": None,
                },
            )

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    provider = ElevenLabsTTS("test-key", client=client, language="en-us")

    voices = await provider.list_voices()
    assert len(voices) == 2
    assert len(calls) == 2

    v1 = voices[0]
    assert v1.id == "v1"
    assert v1.name == "Rachel"
    assert v1.gender == "female"
    assert v1.age == "young"
    assert v1.language == "en-us"
    # Trait deduplication and collection
    assert "american" in v1.traits
    assert "narration" in v1.traits
    assert "calm" in v1.traits
    assert "premade" in v1.traits
    assert "warm" in v1.traits

    v2 = voices[1]
    assert v2.id == "v2"
    assert v2.name == "Domi"
    assert v2.gender is None
    assert v2.age is None
    assert v2.traits == ["cloned"]


@pytest.mark.asyncio
async def test_elevenlabs_synthesize_v2_payload_and_success() -> None:
    recorded_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append(request)
        assert request.headers["xi-api-key"] == "secret-key"
        assert request.headers["content-type"] == "application/json"
        assert request.url.path == "/v1/text-to-speech/v123"
        assert request.url.params["output_format"] == "wav_24000"

        body = json.loads(request.content)
        assert body["text"] == "Call me Ishmael."
        assert body["model_id"] == "eleven_multilingual_v2"
        assert body["voice_settings"]["speed"] == 1.1
        assert body["voice_settings"]["style"] == 0.0
        assert body["voice_settings"]["stability"] == 0.5
        assert body["voice_settings"]["similarity_boost"] == 0.75

        return httpx.Response(
            200,
            content=SAMPLE_WAV_HEADER,
            headers={"request-id": "req-xyz-123"},
        )

    transport = httpx.MockTransport(handler)
    client = httpx.AsyncClient(transport=transport)
    provider = ElevenLabsTTS("secret-key", "eleven_multilingual_v2", client=client)

    audio = await provider.synthesize(
        "Call me Ishmael.",
        "v123",
        style="melodramatic",  # Must be ignored / not mapped to numeric style
        speed=1.1,
    )
    assert audio == SAMPLE_WAV_HEADER
    assert len(recorded_requests) == 1


@pytest.mark.asyncio
async def test_elevenlabs_v2_speed_boundaries() -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(200, content=SAMPLE_WAV_HEADER))
    client = httpx.AsyncClient(transport=transport)
    provider = ElevenLabsTTS("key", "eleven_multilingual_v2", client=client)

    # Valid: 0.7, 1.0, 1.2
    await provider.synthesize("test", "v1", speed=0.7)
    await provider.synthesize("test", "v1", speed=1.2)

    # Invalid speed
    with pytest.raises(ValueError, match="between 0.7 and 1.2"):
        await provider.synthesize("test", "v1", speed=0.5)

    with pytest.raises(ValueError, match="between 0.7 and 1.2"):
        await provider.synthesize("test", "v1", speed=1.3)


@pytest.mark.asyncio
async def test_elevenlabs_v4_settings_behavior() -> None:
    recorded_requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        recorded_requests.append(request)
        body = json.loads(request.content)
        assert "voice_settings" not in body
        assert body["model_id"] == "eleven_v4"
        assert body["text"] == "Hello world"
        return httpx.Response(200, content=SAMPLE_WAV_HEADER)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = ElevenLabsTTS("key", "eleven_v4", client=client)

    # Valid default speed
    await provider.synthesize("Hello world", "v1", speed=1.0)
    assert len(recorded_requests) == 1

    # Non-default speed raises configuration error
    with pytest.raises(ValueError, match="does not support custom speed"):
        await provider.synthesize("Hello world", "v1", speed=1.1)


@pytest.mark.asyncio
async def test_elevenlabs_non_wav_response_rejection() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b'{"error": "something disguised as json"}',
            headers={"request-id": "req-fake-wav"},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = ElevenLabsTTS("key", client=client)

    with pytest.raises(RuntimeError, match="not a valid WAV file"):
        await provider.synthesize("test", "v1")


@pytest.mark.asyncio
async def test_elevenlabs_structured_and_unstructured_errors() -> None:
    # Structured error with detail dict
    def handler_structured(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"detail": {"status": "quota_exceeded", "message": "Out of credits"}},
            headers={"request-id": "req-quota"},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler_structured))
    provider = ElevenLabsTTS("key", client=client)
    with pytest.raises(RuntimeError) as exc_info:
        await provider.synthesize("test", "v1")
    assert "Out of credits" in str(exc_info.value)
    assert "req-quota" in str(exc_info.value)

    # Array error
    def handler_array(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            422,
            json={"detail": [{"msg": "Field required"}]},
            headers={"x-request-id": "req-arr"},
        )

    client_arr = httpx.AsyncClient(transport=httpx.MockTransport(handler_array))
    provider_arr = ElevenLabsTTS("key", client=client_arr)
    with pytest.raises(RuntimeError) as exc_info:
        await provider_arr.synthesize("test", "v1")
    assert "Field required" in str(exc_info.value)
    assert "req-arr" in str(exc_info.value)


def test_factory_creates_elevenlabs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-factory-key")
    config = AppConfig()
    config.tts.provider = "elevenlabs"
    config.tts.model = "eleven_multilingual_v2"
    config.tts.api_key_env = "ELEVENLABS_API_KEY"

    tts = create_tts(config)
    assert isinstance(tts, ElevenLabsTTS)
    assert tts.model_id == "eleven_multilingual_v2"


def test_factory_raises_when_key_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.setattr("teller.providers.factory.get_api_key", lambda provider, env: None)
    config = AppConfig()
    config.tts.provider = "elevenlabs"
    config.tts.api_key_env = "ELEVENLABS_API_KEY"

    with pytest.raises(RuntimeError, match="ElevenLabs API key not found"):
        create_tts(config)


def test_mixed_provider_doctor_check(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "fake-gemini")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "fake-eleven")

    config = AppConfig()
    config.llm.provider = "gemini"
    config.llm.api_key_env = "GEMINI_API_KEY"
    config.tts.provider = "elevenlabs"
    config.tts.api_key_env = "ELEVENLABS_API_KEY"

    config_path = tmp_path / "config.toml"
    save_config(config, config_path)

    result = CliRunner().invoke(
        app,
        ["doctor"],
        env={"TELLER_CONFIG": str(config_path)},
    )

    # Check that both Gemini LLM and ElevenLabs TTS were inspected independently
    assert "Gemini LLM key" in result.stdout
    assert "ElevenLabs TTS key" in result.stdout
