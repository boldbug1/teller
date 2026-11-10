from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Coroutine
from pathlib import Path
from typing import Any, TypeVar

import typer
from rich.console import Console
from rich.table import Table

from teller.assets import (
    KOKORO_MODEL_SHA256,
    KOKORO_VOICES_SHA256,
    ensure_kokoro_assets,
    file_sha256,
    kokoro_asset_paths,
)
from teller.config import AppConfig, default_config_path, load_config, save_config
from teller.models import Character, Segment, StoryProject, VoiceAssignment
from teller.pipeline import TellerEngine
from teller.providers.factory import create_llm, create_tts
from teller.secrets import get_api_key, store_api_key
from teller.storage import StoryStore
from teller.voices import assign_voices

app = typer.Typer(
    name="teller",
    help="Turn stories into multi-voice audio.",
    no_args_is_help=True,
    pretty_exceptions_show_locals=False,
)
voices_app = typer.Typer(help="List and override character voices.")
app.add_typer(voices_app, name="voices")
console = Console()
ResultT = TypeVar("ResultT")


def _run(coroutine: Coroutine[Any, Any, ResultT]) -> ResultT:
    try:
        return asyncio.run(coroutine)
    except (RuntimeError, ValueError, FileNotFoundError, OSError) as error:
        console.print(f"[bold red]Error:[/bold red] {error}")
        raise typer.Exit(1) from error


def _project(config: AppConfig, source: str, title: str | None = None) -> StoryProject:
    store = StoryStore(config.paths.stories_dir)
    if source == "-":
        text = sys.stdin.read()
        if not text.strip():
            raise typer.BadParameter("No story text was supplied on standard input")
        return store.open_or_create(text, title or "Pasted story", "stdin")

    candidate = Path(source).expanduser()
    if candidate.is_file():
        text = candidate.read_text(encoding="utf-8-sig")
        if not text.strip():
            raise typer.BadParameter(f"{candidate} is empty")
        return store.open_or_create(text, title or candidate.stem, candidate.name)
    try:
        if candidate.is_dir():
            return store.find(candidate)
        return store.find(source)
    except FileNotFoundError as error:
        raise typer.BadParameter(str(error), param_hint="source") from None


def _needs_analysis(project: StoryProject, force: bool) -> bool:
    return force or not (project.path / "analysis.json").exists()


def _segments_table(segments: list[Segment], characters: list[Character]) -> Table:
    names = {character.id: character.name for character in characters}
    table = Table(title=f"{len(segments)} story segments")
    table.add_column("#", justify="right", style="dim")
    table.add_column("Speaker", style="cyan")
    table.add_column("Text")
    for segment in segments:
        text = " ".join(segment.text.split())
        table.add_row(
            str(segment.index + 1), names.get(segment.speaker_id, segment.speaker_id), text
        )
    return table


def _cast_table(characters: list[Character]) -> Table:
    table = Table(title="Cast")
    table.add_column("ID", style="dim")
    table.add_column("Character", style="cyan")
    table.add_column("Aliases")
    table.add_column("Traits")
    table.add_column("Voice", style="green")
    for character in characters:
        voice = character.voice.voice_id if character.voice else "unassigned"
        table.add_row(
            character.id,
            character.name,
            ", ".join(character.aliases),
            ", ".join(character.traits),
            voice,
        )
    return table


async def _analyze_project(
    config: AppConfig,
    project: StoryProject,
    *,
    force: bool,
) -> tuple[TellerEngine, list[Segment], list[Character]]:
    llm = create_llm(config) if _needs_analysis(project, force) else None
    engine = TellerEngine(config, llm=llm)
    segments, characters = await engine.analyze(project, force=force)
    return engine, segments, characters


@app.command()
def setup(
    mode: str | None = typer.Option(None, help="cloud or local"),
    model: str | None = typer.Option(None, help="Override the default Ollama model"),
    tts: str | None = typer.Option(
        None, help="Override TTS provider: gemini, kokoro, or elevenlabs"
    ),
) -> None:
    """Configure a one-key cloud setup or a fully local setup."""
    selected = (mode or typer.prompt("Mode", default="cloud")).strip().casefold()
    if selected not in {"cloud", "local"}:
        raise typer.BadParameter("Mode must be 'cloud' or 'local'")
    config = load_config()

    if selected == "cloud":
        config.llm.provider = "gemini"
        config.llm.model = "gemini-3.8-flash"
        config.llm.api_key_env = "GEMINI_API_KEY"
        tts_choice = (tts or "gemini").strip().casefold()
        if tts_choice == "elevenlabs":
            config.tts.provider = "elevenlabs"
            config.tts.model = "eleven_multilingual_v2"
            config.tts.api_key_env = "ELEVENLABS_API_KEY"
        else:
            config.tts.provider = "gemini"
            config.tts.model = "gemini-3.8-flash-lite-tts"
            config.tts.api_key_env = "GEMINI_API_KEY"

        api_key = get_api_key("gemini", config.llm.api_key_env)
        if not api_key:
            api_key = typer.prompt("Gemini API key", hide_input=True).strip()
            if not api_key:
                raise typer.BadParameter("An API key is required for cloud mode")
            if not store_api_key("gemini", api_key):
                console.print(
                    "[yellow]Could not access the OS credential store. "
                    f"Set {config.llm.api_key_env} before running Teller.[/yellow]"
                )
                os.environ[config.llm.api_key_env] = api_key

        if config.tts.provider == "elevenlabs":
            el_key = get_api_key("elevenlabs", config.tts.api_key_env)
            if not el_key:
                el_key = typer.prompt("ElevenLabs API key", hide_input=True).strip()
                if not el_key:
                    raise typer.BadParameter("An API key is required for ElevenLabs TTS")
                if not store_api_key("elevenlabs", el_key):
                    console.print(
                        "[yellow]Could not access the OS credential store. "
                        f"Set {config.tts.api_key_env} before running Teller.[/yellow]"
                    )
                    os.environ[config.tts.api_key_env] = el_key
    else:
        config.llm.provider = "ollama"
        config.llm.model = model or "qwen3:8b"
        config.llm.base_url = "http://localhost:11434"
        tts_choice = (tts or "kokoro").strip().casefold()
        if tts_choice == "elevenlabs":
            config.tts.provider = "elevenlabs"
            config.tts.model = "eleven_multilingual_v2"
            config.tts.api_key_env = "ELEVENLABS_API_KEY"
            el_key = get_api_key("elevenlabs", config.tts.api_key_env)
            if not el_key:
                el_key = typer.prompt("ElevenLabs API key", hide_input=True).strip()
                if not el_key:
                    raise typer.BadParameter("An API key is required for ElevenLabs TTS")
                if not store_api_key("elevenlabs", el_key):
                    os.environ[config.tts.api_key_env] = el_key
        else:
            config.tts.provider = "kokoro"
            config.tts.model = "kokoro-v1.0-int8"
            config.tts.concurrency = 1
            console.print("Downloading Kokoro model assets once for offline use...")
            last_message = ""

            def progress(message: str) -> None:
                nonlocal last_message
                if message != last_message:
                    console.print(f"\r{message}", end="")
                    last_message = message

            ensure_kokoro_assets(config.paths.assets_dir, progress)
            if last_message:
                console.print()

    path = save_config(config)
    console.print(f"[green]Configuration saved:[/green] {path}")
    console.print("Run [bold]teller doctor[/bold] to verify the setup.")


@app.command()
def doctor() -> None:
    """Check configuration, providers, model assets, and audio output."""
    config = load_config()
    checks: list[tuple[str, bool, str]] = []
    checks.append(("Config", default_config_path().exists(), str(default_config_path())))

    # LLM Provider check (independent)
    if config.llm.provider == "gemini":
        present = bool(get_api_key("gemini", config.llm.api_key_env))
        checks.append(("Gemini LLM key", present, config.llm.api_key_env))
        try:
            create_llm(config)
            checks.append(("Gemini LLM SDK", True, "available"))
        except (RuntimeError, ImportError) as error:
            checks.append(("Gemini LLM SDK", False, str(error)))
    elif config.llm.provider == "ollama":
        try:
            from ollama import Client

            response = Client(host=config.llm.base_url or "http://localhost:11434").list()
            available = [str(item.model) for item in response.models if item.model]
            checks.append(
                (
                    "Ollama",
                    config.llm.model in available,
                    f"models: {', '.join(available) or 'none'}",
                )
            )
        except Exception as error:  # Ollama exposes transport-specific exceptions.
            checks.append(("Ollama", False, str(error)))
    else:
        checks.append(("LLM Provider", False, f"Unknown LLM provider: {config.llm.provider}"))

    # TTS Provider check (independent)
    if config.tts.provider == "gemini":
        present = bool(get_api_key("gemini", config.tts.api_key_env))
        checks.append(("Gemini TTS key", present, config.tts.api_key_env))
        try:
            create_tts(config)
            checks.append(("Gemini TTS SDK", True, "available"))
        except (RuntimeError, ImportError) as error:
            checks.append(("Gemini TTS SDK", False, str(error)))
    elif config.tts.provider == "kokoro":
        model_path, voices_path = kokoro_asset_paths(config.paths.assets_dir)
        model_ok = model_path.exists() and file_sha256(model_path) == KOKORO_MODEL_SHA256
        voices_ok = voices_path.exists() and file_sha256(voices_path) == KOKORO_VOICES_SHA256
        checks.append(("Kokoro model", model_ok, str(model_path)))
        checks.append(("Kokoro voices", voices_ok, str(voices_path)))
        try:
            import kokoro_onnx  # noqa: F401

            create_tts(config)
            checks.append(("Kokoro SDK", True, "available"))
        except (RuntimeError, ImportError) as error:
            checks.append(("Kokoro SDK", False, str(error)))
    elif config.tts.provider == "elevenlabs":
        env_var = (
            config.tts.api_key_env
            if config.tts.api_key_env and config.tts.api_key_env != "GEMINI_API_KEY"
            else "ELEVENLABS_API_KEY"
        )
        present = bool(get_api_key("elevenlabs", env_var))
        checks.append(("ElevenLabs TTS key", present, env_var))
        try:
            create_tts(config)
            checks.append(("ElevenLabs TTS SDK", True, "available"))
        except (RuntimeError, ImportError, ValueError) as error:
            checks.append(("ElevenLabs TTS SDK", False, str(error)))
    else:
        checks.append(("TTS Provider", False, f"Unknown TTS provider: {config.tts.provider}"))

    try:
        import sounddevice

        output = sounddevice.query_devices(kind="output")
        checks.append(("Audio output", bool(output), str(output.get("name", "available"))))
    except Exception as error:
        checks.append(("Audio output", False, str(error)))

    table = Table(title="Teller doctor")
    table.add_column("Check")
    table.add_column("Status")
    table.add_column("Details")
    for name, passed, details in checks:
        status = "[green]OK[/green]" if passed else "[red]FAILED[/red]"
        table.add_row(name, status, details)
    console.print(table)
    if not all(passed for _, passed, _ in checks):
        raise typer.Exit(1)


@app.command()
def analyze(
    source: str = typer.Argument(..., help="Text file, story folder/ID, or - for stdin"),
    title: str | None = typer.Option(None, help="Title for a new story"),
    retag: bool = typer.Option(False, help="Discard saved attribution and run the LLM again"),
) -> None:
    """Find narrators, characters, and dialogue without generating audio."""
    config = load_config()
    project = _project(config, source, title)

    async def operation() -> None:
        _, segments, characters = await _analyze_project(config, project, force=retag)
        console.print(_segments_table(segments, characters))
        console.print(_cast_table(characters))
        console.print(f"Saved in [bold]{project.path}[/bold]")

    _run(operation())


async def _prepare_audio(
    config: AppConfig,
    project: StoryProject,
    *,
    retag: bool,
    reassign_voices: bool,
) -> tuple[TellerEngine, list[Segment], list[Character]]:
    llm = create_llm(config) if _needs_analysis(project, retag) else None
    engine = TellerEngine(config, llm=llm)
    segments, characters = await engine.analyze(project, force=retag)
    needs_voices = reassign_voices or any(character.voice is None for character in characters)
    if needs_voices:
        engine.tts = create_tts(config)
        characters = await engine.prepare_voices(
            project,
            segments,
            characters,
            force=reassign_voices,
        )
    misses, _ = await engine.estimate(project, segments, characters)
    if misses and engine.tts is None:
        engine.tts = create_tts(config)
        # Validate saved assignments against the active provider and model.
        await assign_voices(characters, engine.tts)
    return engine, segments, characters


@app.command()
def render(
    source: str = typer.Argument(..., help="Text file or saved story folder/ID"),
    title: str | None = typer.Option(None, help="Title for a new story"),
    retag: bool = typer.Option(False, help="Run speaker attribution again"),
    reassign_voices: bool = typer.Option(False, help="Choose new voices for every character"),
) -> None:
    """Generate and cache all story audio without playing it."""
    config = load_config()
    project = _project(config, source, title)

    async def operation() -> None:
        engine, segments, characters = await _prepare_audio(
            config,
            project,
            retag=retag,
            reassign_voices=reassign_voices,
        )
        misses, character_count = await engine.estimate(project, segments, characters)
        console.print(
            f"Need to generate [bold]{misses}[/bold] segments "
            f"([bold]{character_count:,}[/bold] characters); cached segments are free."
        )
        stats = await engine.render(project, segments, characters)
        console.print(
            f"[green]Audio ready.[/green] Generated {stats.generated}, "
            f"cache hits {stats.cache_hits}."
        )

    _run(operation())


@app.command()
def play(
    source: str = typer.Argument(..., help="Text file or saved story folder/ID"),
    title: str | None = typer.Option(None, help="Title for a new story"),
    retag: bool = typer.Option(False, help="Run speaker attribution again"),
    reassign_voices: bool = typer.Option(False, help="Choose new voices for every character"),
) -> None:
    """Generate missing segments ahead of playback and play the story."""
    config = load_config()
    project = _project(config, source, title)

    async def operation() -> None:
        engine, segments, characters = await _prepare_audio(
            config,
            project,
            retag=retag,
            reassign_voices=reassign_voices,
        )
        console.print(_cast_table(characters))
        misses, character_count = await engine.estimate(project, segments, characters)
        console.print(
            f"Playing {len(segments)} segments; {misses} need generation "
            f"({character_count:,} characters)."
        )
        stats = await engine.play(project, segments, characters)
        console.print(
            f"[green]Playback complete.[/green] Generated {stats.generated}, "
            f"cache hits {stats.cache_hits}."
        )

    _run(operation())


@app.command("run")
def run_story(
    source: str = typer.Argument(..., help="Text file or - for piped/pasted text"),
    title: str | None = typer.Option(None, help="Title for a new story"),
) -> None:
    """Analyze, assign voices, generate, and play a story."""
    play(source=source, title=title, retag=False, reassign_voices=False)


@app.command()
def export(
    source: str = typer.Argument(..., help="Saved story folder or ID"),
    output: Path | None = typer.Option(None, "--output", "-o", help="Target output WAV path"),
) -> None:
    """Stitch rendered story audio segments and export a single WAV file."""
    config = load_config()
    project = _project(config, source)
    store = StoryStore(config.paths.stories_dir)
    analysis = store.load_analysis(project)
    if analysis is None:
        raise typer.BadParameter("This story has not been analyzed yet")

    segments, characters = analysis
    from teller.audio_export import slugify_filename, stitch_story_audio

    try:
        wav_bytes, duration, count = stitch_story_audio(
            project,
            segments,
            characters,
            config,
            speaker_pause_ms=config.playback.speaker_pause_ms,
        )
    except ValueError as err:
        console.print(f"[red]Export failed:[/red] {err}")
        raise typer.Exit(1) from err

    target = output or (Path.cwd() / slugify_filename(project.manifest.title))
    if target.is_dir():
        target = target / slugify_filename(project.manifest.title)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(wav_bytes)

    console.print(
        f"[green]Exported story audio to {target}[/green] "
        f"({count} segments, {duration:.1f}s, {len(wav_bytes)/1024/1024:.2f} MB)"
    )



@app.command()
def cast(source: str = typer.Argument(..., help="Saved story folder or ID")) -> None:
    """Show the saved character and voice table."""
    config = load_config()
    project = _project(config, source)
    characters = StoryStore(config.paths.stories_dir).load_characters(project)
    if characters is None:
        raise typer.BadParameter("This story has not been analyzed yet")
    console.print(_cast_table(characters))


@voices_app.command("list")
def list_voices() -> None:
    """List voices from the configured TTS provider."""
    config = load_config()

    async def operation() -> None:
        provider = create_tts(config)
        voices = await provider.list_voices()
        table = Table(title=f"{provider.provider_id} voices")
        table.add_column("ID", style="cyan")
        table.add_column("Language")
        table.add_column("Gender")
        table.add_column("Traits")
        for voice in voices:
            table.add_row(
                voice.id,
                voice.language or "",
                voice.gender or "",
                ", ".join(voice.traits),
            )
        console.print(table)

    _run(operation())


@voices_app.command("set")
def set_voice(
    source: str = typer.Argument(..., help="Saved story folder or ID"),
    character: str = typer.Argument(..., help="Character ID or exact name"),
    voice_id: str = typer.Argument(..., help="Provider voice ID"),
) -> None:
    """Override one character's persistent voice assignment."""
    config = load_config()
    project = _project(config, source)

    async def operation() -> None:
        provider = create_tts(config)
        available = {voice.id for voice in await provider.list_voices()}
        if voice_id not in available:
            raise ValueError(f"Unknown {provider.provider_id} voice: {voice_id}")
        store = StoryStore(config.paths.stories_dir)
        characters = store.load_characters(project)
        if characters is None:
            raise ValueError("This story has not been analyzed yet")
        matches = [
            item
            for item in characters
            if item.id == character or item.name.casefold() == character.casefold()
        ]
        if len(matches) != 1:
            raise ValueError(f"Could not find exactly one character matching: {character}")
        matches[0].voice = VoiceAssignment(
            provider=provider.provider_id,
            model=provider.model_id,
            voice_id=voice_id,
            language=provider.language,
        )
        segments = store.load_segments(project)
        if segments is None:
            raise ValueError("This story has no saved segments")
        store.save_analysis(project, segments, characters)
        console.print(f"[green]{matches[0].name} now uses {voice_id}.[/green]")

    _run(operation())
