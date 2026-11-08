from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

SCHEMA_VERSION = 1
NARRATOR_ID = "narrator"


class Voice(BaseModel):
    id: str
    name: str
    language: str | None = None
    gender: str | None = None
    age: str | None = None
    traits: list[str] = Field(default_factory=list)


class VoiceAssignment(BaseModel):
    provider: str
    model: str
    voice_id: str
    language: str | None = None


class Character(BaseModel):
    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    gender: str | None = None
    age: str | None = None
    traits: list[str] = Field(default_factory=list)
    voice: VoiceAssignment | None = None
    last_seen_chunk: int = 0

    @field_validator("aliases", "traits")
    @classmethod
    def unique_strings(cls, values: list[str]) -> list[str]:
        seen: set[str] = set()
        result: list[str] = []
        for value in values:
            clean = value.strip()
            key = clean.casefold()
            if clean and key not in seen:
                seen.add(key)
                result.append(clean)
        return result


class SourceUnit(BaseModel):
    id: str
    index: int
    text: str
    kind: Literal["narration", "dialogue"]
    start: int
    end: int

    @property
    def spoken(self) -> bool:
        return bool(self.text.strip())


class StoryChunk(BaseModel):
    index: int
    units: list[SourceUnit]
    context_before: list[SourceUnit] = Field(default_factory=list)
    context_after: list[SourceUnit] = Field(default_factory=list)


class CharacterObservation(BaseModel):
    ref: str = Field(description="Existing character ID or a new_ prefixed temporary reference")
    name: str
    aliases: list[str] = Field(default_factory=list)
    gender: str | None = None
    age: str | None = None
    traits: list[str] = Field(default_factory=list)


class UnitAssignment(BaseModel):
    unit_id: str
    speaker_ref: str
    emotion: str | None = None


class TaggingResult(BaseModel):
    assignments: list[UnitAssignment]
    characters: list[CharacterObservation] = Field(default_factory=list)


class Segment(BaseModel):
    index: int
    unit_ids: list[str]
    speaker_id: str
    text: str
    source_start: int
    source_end: int
    emotion: str | None = None
    audio_file: str | None = None


class StoryManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    story_id: str
    title: str
    source_name: str | None = None
    source_sha256: str
    schema_version: int = SCHEMA_VERSION
    tagger_revision: int = 1
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")
    )


class StoryProject(BaseModel):
    path: Path
    manifest: StoryManifest


class AnalysisSnapshot(BaseModel):
    source_sha256: str
    schema_version: int = SCHEMA_VERSION
    characters: list[Character]
    segments: list[Segment]


class RenderStats(BaseModel):
    cache_hits: int = 0
    generated: int = 0
    characters: int = 0
