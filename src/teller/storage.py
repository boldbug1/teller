from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Sequence
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from teller.models import AnalysisSnapshot, Character, Segment, StoryManifest, StoryProject

ModelT = TypeVar("ModelT", bound=BaseModel)


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def safe_slug(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return slug[:60] or "story"


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def atomic_write_bytes(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(content)
    temporary.replace(path)


def write_models(path: Path, models: Sequence[BaseModel]) -> None:
    data = [model.model_dump(mode="json", exclude_none=True) for model in models]
    atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def read_models(path: Path, model_type: type[ModelT]) -> list[ModelT]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [model_type.model_validate(item) for item in data]


class StoryStore:
    def __init__(self, root: Path):
        self.root = root.expanduser().resolve()

    def open_or_create(
        self,
        text: str,
        title: str,
        source_name: str | None = None,
    ) -> StoryProject:
        source_hash = sha256_text(text)
        story_id = f"{safe_slug(title)}-{source_hash[:8]}"
        path = self.root / story_id
        manifest_path = path / "manifest.json"
        if manifest_path.exists():
            manifest = StoryManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
            if manifest.source_sha256 != source_hash:
                raise ValueError(f"Story folder {path} contains different source text")
            return StoryProject(path=path, manifest=manifest)

        path.mkdir(parents=True, exist_ok=True)
        manifest = StoryManifest(
            story_id=story_id,
            title=title,
            source_name=source_name,
            source_sha256=source_hash,
        )
        atomic_write_text(path / "story.txt", text)
        atomic_write_text(
            manifest_path,
            manifest.model_dump_json(indent=2, exclude_none=True) + "\n",
        )
        (path / "audio").mkdir(exist_ok=True)
        return StoryProject(path=path, manifest=manifest)

    @staticmethod
    def story_text(project: StoryProject) -> str:
        return (project.path / "story.txt").read_text(encoding="utf-8")

    @staticmethod
    def save_analysis(
        project: StoryProject,
        segments: list[Segment],
        characters: list[Character],
    ) -> None:
        snapshot = AnalysisSnapshot(
            source_sha256=project.manifest.source_sha256,
            segments=segments,
            characters=characters,
        )
        # This combined snapshot is authoritative. The separate files remain
        # convenient for people and tools to inspect.
        atomic_write_text(
            project.path / "analysis.json",
            snapshot.model_dump_json(indent=2, exclude_none=True) + "\n",
        )
        write_models(project.path / "characters.json", characters)
        write_models(project.path / "segments.json", segments)

    @staticmethod
    def load_analysis(project: StoryProject) -> tuple[list[Segment], list[Character]] | None:
        path = project.path / "analysis.json"
        if not path.exists():
            return None
        snapshot = AnalysisSnapshot.model_validate_json(path.read_text(encoding="utf-8"))
        if snapshot.source_sha256 != project.manifest.source_sha256:
            raise ValueError("Saved analysis belongs to different story text")
        return snapshot.segments, snapshot.characters

    @staticmethod
    def save_characters(project: StoryProject, characters: list[Character]) -> None:
        analysis = StoryStore.load_analysis(project)
        if analysis is None:
            raise ValueError("Cannot save characters before story analysis")
        StoryStore.save_analysis(project, analysis[0], characters)

    @staticmethod
    def load_characters(project: StoryProject) -> list[Character] | None:
        analysis = StoryStore.load_analysis(project)
        return analysis[1] if analysis else None

    @staticmethod
    def save_segments(project: StoryProject, segments: list[Segment]) -> None:
        analysis = StoryStore.load_analysis(project)
        if analysis is None:
            raise ValueError("Cannot save segments before story analysis")
        StoryStore.save_analysis(project, segments, analysis[1])

    @staticmethod
    def load_segments(project: StoryProject) -> list[Segment] | None:
        analysis = StoryStore.load_analysis(project)
        return analysis[0] if analysis else None

    def find(self, story: str | Path) -> StoryProject:
        candidate = Path(story)
        path = candidate if candidate.is_dir() else self.root / str(story)
        manifest_path = path.expanduser().resolve() / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError(f"No Teller story found at {path}")
        manifest = StoryManifest.model_validate_json(manifest_path.read_text(encoding="utf-8"))
        return StoryProject(path=manifest_path.parent, manifest=manifest)
