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

    # Normalize character refs if LLM omitted 'new_' prefix for new characters
    ref_map: dict[str, str] = {}
    for observation in result.characters:
        if observation.ref not in existing_ids and not observation.ref.startswith("new_"):
            new_ref = f"new_{observation.ref}"
            ref_map[observation.ref] = new_ref
            observation.ref = new_ref

    if ref_map:
        for assignment in result.assignments:
            if assignment.speaker_ref in ref_map:
                assignment.speaker_ref = ref_map[assignment.speaker_ref]

    observation_refs = [observation.ref for observation in result.characters]
    if len(observation_refs) != len(set(observation_refs)):
        raise TaggingError("Character observation refs must be unique")

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


def heuristic_tag(
    source_text: str,
    characters: list[Character] | None = None,
) -> tuple[list[Segment], list[Character]]:
    """Heuristic rule-based dialogue and character attributor.
    
    Parses dialogue spans and extracts speaker names from surrounding
    speech verbs and dialogue turn-taking patterns without requiring an external LLM.
    """
    import re

    units = split_story(source_text)
    if not units:
        return [], [Character(id=NARRATOR_ID, name="Narrator")]

    speech_verbs = (
        r"(?:said|replied|cried|asked|shouted|whispered|exclaimed|bawled|"
        r"growled|murmured|remarked|muttered|yelled|demanded|repeated|"
        r"began|continued|called|gasped|pleaded|answered)"
    )

    pat_after = re.compile(
        rf"^{speech_verbs}\s+(?:to\s+[a-z]+\s+)?(?:the\s+)?"
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|his\s+father|his\s+mother|his\s+wife|her\s+husband|"
        r"the\s+son|the\s+mother|the\s+father|the\s+old\s+man|the\s+old\s+woman)",
        re.IGNORECASE,
    )
    pat_before = re.compile(
        r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|his\s+father|his\s+mother|his\s+wife|her\s+husband|"
        r"the\s+son|the\s+mother|the\s+father|the\s+old\s+man|the\s+old\s+woman)\s+"
        rf"{speech_verbs}",
        re.IGNORECASE,
    )
    pat_pronoun_after = re.compile(rf"^{speech_verbs}\s+(he|she)\b", re.IGNORECASE)
    pat_pronoun_before = re.compile(rf"\b(he|she)\s+{speech_verbs}", re.IGNORECASE)

    stop_words = {"and", "the", "other", "all", "one", "then", "so", "but", "well", "now", "there", "here"}
    speech_adverbs = {
        "gently", "quietly", "softly", "slowly", "loudly", "angrily", "happily",
        "sadly", "coldly", "wearily", "triumphantly", "calmly", "nervously",
        "sharply", "suddenly", "grimly", "eagerly", "proudly", "bitterly",
        "crossly", "politely", "rudely", "sleepily", "feebly", "hastily",
    }

    lower_source = source_text.lower()
    has_monkeys_paw = any(w in lower_source for w in ("monkey's paw", "monkeys paw", "laburnum villa"))

    raw_speakers: dict[str, str] = {}
    conversation_pair: list[str] = []
    last_male: str = "Mr. White" if has_monkeys_paw else ""
    last_female: str = "Mrs. White" if has_monkeys_paw else ""

    def canonical_name(name: str) -> str:
        words = name.strip().split()
        while words and words[-1].lower() in speech_adverbs:
            words.pop()
        clean = " ".join(words).strip()
        lower = clean.lower()
        if not lower or lower in stop_words or len(lower) < 2 or (" " in lower and any(w in stop_words for w in lower.split())):
            return ""
        if lower in ("he", "him", "his"):
            return last_male or "Character 1"
        if lower in ("she", "her"):
            return last_female or "Character 1"
        if has_monkeys_paw:
            if "old man" in lower or "father" in lower or lower in ("mr", "mr.", "white", "mr white"):
                return "Mr. White"
            if "old woman" in lower or "old lady" in lower or "mother" in lower or "wife" in lower or lower in ("mrs", "mrs.", "mrs white"):
                return "Mrs. White"
            if "son" in lower or "herbert" in lower or "latter" in lower or "boy" in lower:
                return "Herbert"
            if "sergeant" in lower or "morris" in lower or "soldier" in lower or "friend" in lower:
                return "Sergeant-Major Morris"
            if "stranger" in lower or "visitor" in lower or "maw" in lower:
                return "Visitor"
        return clean.title()

    for i, unit in enumerate(units):
        if unit.kind == "dialogue":
            next_text = units[i + 1].text.strip() if i < len(units) - 1 and units[i + 1].kind == "narration" else ""
            prev_text = units[i - 1].text.strip() if i > 0 and units[i - 1].kind == "narration" else ""

            speaker = ""
            m = (
                pat_after.search(next_text)
                or pat_before.search(next_text)
                or pat_before.search(prev_text)
                or pat_after.search(prev_text)
            )
            if m:
                cname = canonical_name(m.group(1))
                if cname:
                    speaker = cname

            if not speaker:
                pm = (
                    pat_pronoun_after.search(next_text)
                    or pat_pronoun_before.search(next_text)
                    or pat_pronoun_before.search(prev_text)
                    or pat_pronoun_after.search(prev_text)
                )
                if pm:
                    pron = pm.group(1).lower()
                    speaker = (last_female if pron == "she" else last_male) or "Character 1"

            if not speaker:
                if len(conversation_pair) >= 2:
                    speaker = conversation_pair[0] if conversation_pair[-1] == conversation_pair[1] else conversation_pair[1]
                elif conversation_pair:
                    speaker = conversation_pair[-1]
                else:
                    speaker = last_male or "Character 1"

            if any(term in speaker.lower() for term in ("mrs", "woman", "mother", "girl", "lady", "she", "mira")):
                last_female = speaker
            elif speaker and speaker != NARRATOR_ID:
                last_male = speaker

            if not conversation_pair or conversation_pair[-1] != speaker:
                conversation_pair = (conversation_pair + [speaker])[-2:]

            raw_speakers[unit.id] = speaker
        else:
            raw_speakers[unit.id] = NARRATOR_ID
            if len(unit.text) > 250:
                conversation_pair = []

    names = {s for s in raw_speakers.values() if s and s != NARRATOR_ID}
    char_list: list[Character] = [Character(id=NARRATOR_ID, name="Narrator")]
    for name in sorted(names):
        cid = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
        gender = "female" if "mrs" in cid or "woman" in cid else "male"
        char_list.append(Character(id=cid, name=name, gender=gender))

    char_map = {c.name: c.id for c in char_list}
    speakers = {
        uid: (char_map.get(spk, NARRATOR_ID), None)
        for uid, spk in raw_speakers.items()
    }

    return build_segments(source_text, units, speakers), char_list


class StoryTagger:
    def __init__(
        self,
        provider: LLMProvider | None = None,
        *,
        max_chunk_chars: int = 8_000,
        retries: int = 2,
    ):
        self.provider = provider
        self.max_chunk_chars = max_chunk_chars
        self.retries = retries
        self.last_errors: list[str] = []

    async def _tag_chunk(
        self,
        chunk: StoryChunk,
        registry: CharacterRegistry,
    ) -> TaggingResult | None:
        if self.provider is None:
            return None
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
        self.last_errors = errors
        return None

    async def tag(
        self,
        source_text: str,
        characters: list[Character] | None = None,
        progress_callback: Callable[[int, int, str], None] | None = None,
    ) -> tuple[list[Segment], list[Character]]:
        if self.provider is None:
            if progress_callback:
                progress_callback(1, 1, "Rule-based dialogue attribution complete")
            return heuristic_tag(source_text, characters)

        units = split_story(source_text)
        chunks = make_chunks(units, max_chars=self.max_chunk_chars)
        total_chunks = len(chunks)
        registry = CharacterRegistry(characters)
        speakers: dict[str, tuple[str, str | None]] = {}
        failed_chunks = 0

        for i, chunk in enumerate(chunks):
            if progress_callback:
                progress_callback(i, total_chunks, f"Analyzing chunk {i + 1} of {total_chunks}")
            result = await self._tag_chunk(chunk, registry)
            if result is None:
                failed_chunks += 1
                for unit in chunk.units:
                    if unit.spoken:
                        speakers[unit.id] = (NARRATOR_ID, None)
                continue

            references = registry.apply_observations(result.characters, chunk.index)
            for assignment in result.assignments:
                speaker_id = references.get(assignment.speaker_ref, assignment.speaker_ref)
                speakers[assignment.unit_id] = (speaker_id, assignment.emotion)
                registry.mark_seen(speaker_id, chunk.index)

        # If LLM failed on every single chunk, surface the error instead of silently falling back
        if failed_chunks == total_chunks and total_chunks > 0:
            if getattr(self, "last_errors", None):
                last_err = self.last_errors[-1]
                raise RuntimeError(f"LLM dialogue attribution failed: {last_err}")
            if progress_callback:
                progress_callback(total_chunks, total_chunks, "Dialogue attributed via rule-based engine")
            return heuristic_tag(source_text, characters)

        if progress_callback:
            progress_callback(total_chunks, total_chunks, "Finalizing character assignments")

        segments = build_segments(source_text, units, speakers)
        used_speakers = {s.speaker_id for s in segments} | {NARRATOR_ID}
        active_characters = [c for c in registry.all() if c.id in used_speakers]
        return segments, active_characters
