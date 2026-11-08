import json
from typing import Any

import pytest

from teller.models import TaggingResult
from teller.tagger import StoryTagger


class QueueLLM:
    provider_id = "fake"
    model_id = "fake-model"

    def __init__(self, outputs: list[str]):
        self.outputs = outputs
        self.calls = 0

    async def generate(self, prompt: str, schema: dict[str, Any] | None = None) -> str:
        self.calls += 1
        return self.outputs.pop(0)


def result(assignments: list[tuple[str, str]], characters: list[dict[str, Any]]) -> str:
    return json.dumps(
        {
            "assignments": [
                {"unit_id": unit_id, "speaker_ref": speaker} for unit_id, speaker in assignments
            ],
            "characters": characters,
        }
    )


@pytest.mark.asyncio
async def test_tagger_retries_invalid_json_and_attributes_dialogue() -> None:
    story = 'Mira stopped. "Who is there?"'
    valid = result(
        [("u000000", "narrator"), ("u000001", "new_mira")],
        [{"ref": "new_mira", "name": "Mira", "aliases": [], "traits": ["alert"]}],
    )
    provider = QueueLLM(["not json", valid])

    segments, characters = await StoryTagger(provider, retries=1).tag(story)

    assert provider.calls == 2
    assert [segment.speaker_id for segment in segments] == ["narrator", "mira"]
    assert {character.id for character in characters} == {"narrator", "mira"}


@pytest.mark.asyncio
async def test_tagger_falls_back_to_narrator_after_invalid_assignments() -> None:
    provider = QueueLLM(["{}", "{}"])

    segments, _ = await StoryTagger(provider, retries=1).tag('"Hello," Mira said.')

    assert provider.calls == 2
    assert all(segment.speaker_id == "narrator" for segment in segments)


def test_tagging_schema_is_json_serializable() -> None:
    json.dumps(TaggingResult.model_json_schema())
