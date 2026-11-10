from pathlib import Path

from typer.testing import CliRunner

from teller.cli import app
from teller.config import AppConfig, save_config
from teller.models import Character, Segment
from teller.storage import StoryStore


def test_cli_help() -> None:
    result = CliRunner().invoke(app, ["--help"])

    assert result.exit_code == 0
    assert "Turn stories into multi-voice audio" in result.stdout


def test_missing_source_shows_simple_error(tmp_path: Path) -> None:
    config = AppConfig()
    config.paths.stories_dir = tmp_path / "stories"
    config_path = tmp_path / "config.toml"
    save_config(config, config_path)

    result = CliRunner().invoke(
        app,
        ["analyze", "missing.txt"],
        env={"TELLER_CONFIG": str(config_path)},
    )

    assert result.exit_code == 2
    output = result.stdout + result.stderr
    assert "No Teller story found" in output
    assert "Traceback" not in output


def test_cached_analysis_does_not_require_provider_credentials(tmp_path: Path) -> None:
    config = AppConfig()
    config.paths.stories_dir = tmp_path / "stories"
    config_path = tmp_path / "config.toml"
    save_config(config, config_path)
    store = StoryStore(config.paths.stories_dir)
    project = store.open_or_create("Hello.", "Cached")
    characters = [Character(id="narrator", name="Narrator")]
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
    store.save_analysis(project, segments, characters)

    result = CliRunner().invoke(
        app,
        ["analyze", str(project.path)],
        env={"TELLER_CONFIG": str(config_path)},
    )

    assert result.exit_code == 0
    assert "Narrator" in result.stdout
