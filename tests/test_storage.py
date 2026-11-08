from pathlib import Path

from teller.models import Character, Segment
from teller.storage import StoryStore


def test_story_store_reopens_same_source_without_overwriting(tmp_path: Path) -> None:
    store = StoryStore(tmp_path / "stories")

    first = store.open_or_create("Once upon a time.", "A Story", "story.txt")
    second = store.open_or_create("Once upon a time.", "A Story", "story.txt")

    assert first.path == second.path
    assert first.manifest.source_sha256 == second.manifest.source_sha256
    assert store.story_text(second) == "Once upon a time."


def test_combined_analysis_remains_authoritative_if_mirror_write_is_interrupted(
    tmp_path: Path,
) -> None:
    store = StoryStore(tmp_path / "stories")
    project = store.open_or_create("Hello.", "Atomic")
    segments = [
        Segment(
            index=0,
            unit_ids=["u000000"],
            speaker_id="narrator",
            text="Hello.",
            source_start=0,
            source_end=6,
        )
    ]
    characters = [Character(id="narrator", name="Narrator")]
    store.save_analysis(project, segments, characters)
    (project.path / "segments.json").write_text("[]", encoding="utf-8")
    (project.path / "characters.json").write_text("[]", encoding="utf-8")

    loaded = store.load_analysis(project)

    assert loaded == (segments, characters)
