from __future__ import annotations

import json
from collections.abc import Callable, Iterable

from pydantic import ValidationError

from teller.characters import CharacterRegistry
from teller.chunker import make_chunks, split_story
from teller.models import (
    NARRATOR_ID,
    Character,
    Segment,
    SourceUnit,
    StoryChunk,
    TaggingResult,
)
from teller.providers.protocols import LLMProvider


class TaggingError(ValueError):
    pass


def _unit_prompt_data(units: Iterable[SourceUnit]) -> list[dict[str, str]]:
    return [{"id": unit.id, "kind": unit.kind, "text": unit.text} for unit in units if unit.spoken]


def build_prompt(chunk: StoryChunk, registry: CharacterRegistry) -> str:
    payload = {
        "known_characters": registry.prompt_data(),
        "context_before": _unit_prompt_data(chunk.context_before),
        "units_to_label": _unit_prompt_data(chunk.units),
        "context_after": _unit_prompt_data(chunk.context_after),
    }
    return (
        "You attribute immutable pieces of a story to speakers. Label every unit in "
        "units_to_label exactly once. Use 'narrator' for prose and narration. For dialogue, "
        "use an existing character ID when possible. Create a temporary ref beginning with "
        "'new_' only for a genuinely new speaker, and describe it in characters. Resolve "
        "aliases such as a name and 'the girl' to one existing character. Do not invent facts: "
        "leave gender or age null unless the story supports it. Do not quote, rewrite, split, "
        "merge, or omit any unit text. Return only data matching the supplied JSON schema.\n\n"
        + json.dumps(payload, ensure_ascii=False, indent=2)
    )


def _validate_result(
    result: TaggingResult,
    chunk: StoryChunk,
    existing_ids: set[str],
) -> None:
    expected = {unit.id for unit in chunk.units if unit.spoken}
    assigned = [assignment.unit_id for assignment in result.assignments]
    if len(assigned) != len(set(assigned)):
        raise TaggingError("The response assigned at least one unit more than once")
    if set(assigned) != expected:
        missing = sorted(expected - set(assigned))
        extra = sorted(set(assigned) - expected)
        raise TaggingError(f"Assignment IDs do not match; missing={missing}, extra={extra}")

    observation_refs = [observation.ref for observation in result.characters]
    if len(observation_refs) != len(set(observation_refs)):
        raise TaggingError("Character observation refs must be unique")
    for observation in result.characters:
        if observation.ref not in existing_ids and not observation.ref.startswith("new_"):
            raise TaggingError(f"New character ref must start with 'new_': {observation.ref}")

    allowed = existing_ids | set(observation_refs) | {NARRATOR_ID}
    unknown = sorted({assignment.speaker_ref for assignment in result.assignments} - allowed)
    if unknown:
        raise TaggingError(f"Assignments reference unknown characters: {unknown}")


def build_segments(
    source_text: str,
    units: list[SourceUnit],
    speakers: dict[str, tuple[str, str | None]],
    max_segment_chars: int = 1_200,
) -> list[Segment]:
    segments: list[Segment] = []
    for unit in units:
        if not unit.spoken:
            continue
        speaker_id, emotion = speakers.get(unit.id, (NARRATOR_ID, None))
        previous = segments[-1] if segments else None
        can_join = (
            previous is not None
            and previous.speaker_id == speaker_id
            and previous.emotion == emotion
            and unit.end - previous.source_start <= max_segment_chars
        )
        if can_join and previous is not None:
            previous.unit_ids.append(unit.id)
            previous.source_end = unit.end
            previous.text = source_text[previous.source_start : unit.end]
            continue
        segments.append(
            Segment(
                index=len(segments),
                unit_ids=[unit.id],
                speaker_id=speaker_id,
                text=unit.text,
                source_start=unit.start,
                source_end=unit.end,
                emotion=emotion,
            )
        )
    return segments


class StoryTagger:
    def __init__(
        self,
        provider: LLMProvider,
        *,
        max_chunk_chars: int = 8_000,
        retries: int = 2,
    ):
        self.provider = provider
        self.max_chunk_chars = max_chunk_chars
        self.retries = retries

    async def _tag_chunk(
        self,
        chunk: StoryChunk,
        registry: CharacterRegistry,
    ) -> TaggingResult | None:
        if not any(unit.spoken for unit in chunk.units):
            return TaggingResult(assignments=[])
        prompt = build_prompt(chunk, registry)
        errors: list[str] = []
        for attempt in range(self.retries + 1):
            retry_prompt = prompt
            if errors:
                retry_prompt += (
                    "\n\nYour previous response was invalid. Correct these errors:\n- "
                    + "\n- ".join(errors[-2:])
                )
            try:
                raw = await self.provider.generate(
                    retry_prompt,
                    schema=TaggingResult.model_json_schema(),
                )
                result = TaggingResult.model_validate_json(raw)
                _validate_result(result, chunk, registry.ids)
                return result
            except (ValidationError, ValueError, RuntimeError) as error:
                errors.append(f"attempt {attempt + 1}: {error}")
        return None

    async def tag(
        self,
        source_text: str,
        characters: list[Character] | None = None,
        progress_callback: Callable[[int, int, str], None] | None = None,
    ) -> tuple[list[Segment], list[Character]]:
        units = split_story(source_text)
        chunks = make_chunks(units, max_chars=self.max_chunk_chars)
        total_chunks = len(chunks)
        registry = CharacterRegistry(characters)
        speakers: dict[str, tuple[str, str | None]] = {}

        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(i, total_chunks, f"Analyzing chunk {i + 1} of {total_chunks}")
            result = await self._tag_chunk(chunk, registry)
            if result is None:
                for unit in chunk.units:
                    if unit.spoken:
                        speakers[unit.id] = (NARRATOR_ID, None)
                continue

            references = registry.apply_observations(result.characters, chunk.index)
            for assignment in result.assignments:
                speaker_id = references.get(assignment.speaker_ref, assignment.speaker_ref)
                speakers[assignment.unit_id] = (speaker_id, assignment.emotion)
                registry.mark_seen(speaker_id, chunk.index)

        if progress_callback:
            progress_callback(total_chunks, total_chunks, "Finalizing character assignments")

        return build_segments(source_text, units, speakers), registry.all()
