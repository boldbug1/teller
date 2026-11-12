from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from teller.models import Character, Segment, StoryManifest


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"


class SetupStatusResponse(BaseModel):
    llm_provider: str
    tts_provider: str
    gemini_key_present: bool
    groq_key_present: bool = False
    elevenlabs_key_present: bool
    ollama_reachable: bool
    ollama_models: list[str] = Field(default_factory=list)
    ollama_model_available: bool
    kokoro_model_present: bool
    kokoro_voices_present: bool
    kokoro_runtime_available: bool = False
    audio_output_available: bool
    ready: bool


class DoctorCheckItem(BaseModel):
    name: str
    passed: bool
    details: str


class DoctorResponse(BaseModel):
    checks: list[DoctorCheckItem]
    all_passed: bool


class SecretPayload(BaseModel):
    key: str


class ConfigUpdatePayload(BaseModel):
    llm: dict[str, Any] | None = None
    tts: dict[str, Any] | None = None
    playback: dict[str, Any] | None = None
    paths: dict[str, Any] | None = None


class StorySummary(BaseModel):
    story_id: str
    title: str
    source_name: str | None = None
    created_at: str
    segment_count: int = 0
    character_count: int = 0
    rendered_segment_count: int = 0
    has_analysis: bool = False


class StoryDetailResponse(BaseModel):
    manifest: StoryManifest
    text: str
    segments: list[Segment] = Field(default_factory=list)
    characters: list[Character] = Field(default_factory=list)
    rendered_count: int = 0
    total_count: int = 0


class StoryImportRequest(BaseModel):
    path: str | None = None
    content_base64: str | None = None
    filename: str | None = None
    title: str | None = None


class StoryPasteRequest(BaseModel):
    text: str
    title: str | None = None


class CastUpdatePayload(BaseModel):
    voice_id: str
    provider: str | None = None
    model: str | None = None
    language: str | None = None


class VoiceItem(BaseModel):
    id: str
    name: str
    language: str | None = None
    gender: str | None = None
    age: str | None = None
    traits: list[str] = Field(default_factory=list)


class OperationEnvelope(BaseModel):
    operation_id: str
    kind: str
    state: str  # "pending", "running", "completed", "failed", "cancelled"
    completed: int = 0
    total: int = 0
    message_code: str = ""
    error: str | None = None


class OperationStartResponse(BaseModel):
    operation_id: str
    status: str = "started"


class StoryExportRequest(BaseModel):
    target_path: str | None = None


class StoryExportResponse(BaseModel):
    path: str
    filename: str
    size_bytes: int
    duration_seconds: float
    rendered_segments: int
