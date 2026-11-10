from __future__ import annotations

import asyncio
from collections.abc import Callable

from teller.cache import AudioCache, audio_cache_key
from teller.config import AppConfig
from teller.models import Character, RenderStats, Segment, StoryProject
from teller.player import SoundDevicePlayer
from teller.providers.protocols import AudioPlayer, LLMProvider, TTSProvider
from teller.storage import StoryStore
from teller.tagger import StoryTagger
from teller.voices import assign_voices


class TellerEngine:
    def __init__(
        self,
        config: AppConfig,
        *,
        llm: LLMProvider | None = None,
        tts: TTSProvider | None = None,
        player: AudioPlayer | None = None,
    ):
        self.config = config
        self.llm = llm
        self.tts = tts
        self.player = player or SoundDevicePlayer()
        self.store = StoryStore(config.paths.stories_dir)
        tts_concurrency = config.tts.concurrency
        if getattr(tts, "provider_id", "") == "elevenlabs" or config.tts.provider == "elevenlabs":
            tts_concurrency = 1
        self._tts_semaphore = asyncio.Semaphore(tts_concurrency)
        self._inflight_lock = asyncio.Lock()
        self._inflight: dict[str, asyncio.Task[bytes]] = {}

    async def analyze(
        self,
        project: StoryProject,
        *,
        force: bool = False,
        progress_callback: Callable[[int, int, str], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> tuple[list[Segment], list[Character]]:
        if is_cancelled and is_cancelled():
            raise asyncio.CancelledError()
        existing = self.store.load_analysis(project)
        if existing is not None and not force:
            if progress_callback:
                progress_callback(1, 1, "analysis_loaded")
            return existing
        if self.llm is None and self.config.llm.provider not in ("rule_based", "heuristic", "offline"):
            raise RuntimeError("This story needs analysis, but no LLM provider is configured")
        if progress_callback:
            progress_callback(0, 1, "starting_analysis")
        tagger = StoryTagger(
            self.llm,
            max_chunk_chars=self.config.llm.max_chunk_chars,
            retries=self.config.llm.retries,
        )
        source = self.store.story_text(project)
        prior_characters = existing[1] if existing else None
        if is_cancelled and is_cancelled():
            raise asyncio.CancelledError()
        segments, characters = await tagger.tag(
            source,
            prior_characters,
            progress_callback=progress_callback,
        )
        if is_cancelled and is_cancelled():
            raise asyncio.CancelledError()
        self.store.save_analysis(project, segments, characters)
        if progress_callback:
            progress_callback(1, 1, "analysis_complete")
        return segments, characters

    async def prepare_voices(
        self,
        project: StoryProject,
        segments: list[Segment],
        characters: list[Character],
        *,
        force: bool = False,
        progress_callback: Callable[[int, int, str], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> list[Character]:
        if is_cancelled and is_cancelled():
            raise asyncio.CancelledError()
        if not force and all(character.voice is not None for character in characters):
            if self.tts is None:
                return characters
            await assign_voices(characters, self.tts)
            if progress_callback:
                progress_callback(len(characters), len(characters), "voices_ready")
            return characters
        if self.tts is None:
            raise RuntimeError("No TTS provider is configured")
        if progress_callback:
            progress_callback(0, len(characters), "assigning_voices")
        characters = await assign_voices(characters, self.tts, force=force)
        if is_cancelled and is_cancelled():
            raise asyncio.CancelledError()
        self.store.save_analysis(project, segments, characters)
        if progress_callback:
            progress_callback(len(characters), len(characters), "voices_assigned")
        return characters

    async def _generate_audio(
        self,
        cache: AudioCache,
        key: str,
        segment: Segment,
        voice_id: str,
    ) -> bytes:
        if self.tts is None:
            raise RuntimeError("No TTS provider is configured")
        async with self._tts_semaphore:
            audio = await self.tts.synthesize(
                segment.text.strip(),
                voice_id,
                style=segment.emotion,
                speed=self.config.tts.speed,
            )
        cache.put(key, audio)
        return audio

    async def _audio_for_segment(
        self,
        project: StoryProject,
        segment: Segment,
        characters: dict[str, Character],
    ) -> tuple[bytes, bool]:
        character = characters[segment.speaker_id]
        if character.voice is None:
            raise RuntimeError(f"{character.name} has no assigned voice")
        cache = AudioCache(project.path / "audio")
        key = audio_cache_key(
            provider=character.voice.provider,
            model=character.voice.model,
            voice_id=character.voice.voice_id,
            text=segment.text.strip(),
            style=segment.emotion,
            speed=self.config.tts.speed,
            language=self.config.tts.language,
        )
        cached = cache.get(key)
        if cached is not None:
            segment.audio_file = f"audio/{key}.wav"
            return cached, True
        if self.tts is None:
            raise RuntimeError("Missing uncached audio and no TTS provider is available")
        if (
            character.voice.provider != self.tts.provider_id
            or character.voice.model != self.tts.model_id
        ):
            raise RuntimeError(
                f"{character.name}'s saved voice does not match the configured TTS provider; "
                "rerun with --reassign-voices"
            )

        async with self._inflight_lock:
            # Another identical segment may have completed while this task was waiting.
            cached = cache.get(key)
            if cached is not None:
                segment.audio_file = f"audio/{key}.wav"
                return cached, True
            task = self._inflight.get(key)
            owner = task is None
            if task is None:
                task = asyncio.create_task(
                    self._generate_audio(cache, key, segment, character.voice.voice_id)
                )
                self._inflight[key] = task
        try:
            audio = await task
        finally:
            if owner:
                async with self._inflight_lock:
                    if self._inflight.get(key) is task:
                        del self._inflight[key]
        segment.audio_file = f"audio/{key}.wav"
        return audio, not owner

    async def estimate(
        self,
        project: StoryProject,
        segments: list[Segment],
        characters: list[Character],
    ) -> tuple[int, int]:
        by_id = {character.id: character for character in characters}
        cache = AudioCache(project.path / "audio")
        misses = 0
        characters_to_generate = 0
        missing_keys: set[str] = set()
        for segment in segments:
            character = by_id[segment.speaker_id]
            if character.voice is None:
                continue
            key = audio_cache_key(
                provider=character.voice.provider,
                model=character.voice.model,
                voice_id=character.voice.voice_id,
                text=segment.text.strip(),
                style=segment.emotion,
                speed=self.config.tts.speed,
                language=self.config.tts.language,
            )
            if cache.get(key) is None and key not in missing_keys:
                missing_keys.add(key)
                misses += 1
                characters_to_generate += len(segment.text.strip())
        return misses, characters_to_generate

    async def render(
        self,
        project: StoryProject,
        segments: list[Segment],
        characters: list[Character],
        *,
        progress_callback: Callable[[int, int, str], None] | None = None,
        is_cancelled: Callable[[], bool] | None = None,
    ) -> RenderStats:
        by_id = {character.id: character for character in characters}
        total = len(segments)
        completed = 0
        if progress_callback:
            progress_callback(0, total, "rendering_started")

        async def _render_one(seg: Segment) -> tuple[bytes, bool]:
            nonlocal completed
            if is_cancelled and is_cancelled():
                raise asyncio.CancelledError()
            res = await self._audio_for_segment(project, seg, by_id)
            completed += 1
            if progress_callback:
                progress_callback(completed, total, "segment_rendered")
            if is_cancelled and is_cancelled():
                raise asyncio.CancelledError()
            return res

        results = await asyncio.gather(*(_render_one(segment) for segment in segments))
        self.store.save_analysis(project, segments, characters)
        return RenderStats(
            cache_hits=sum(hit for _, hit in results),
            generated=sum(not hit for _, hit in results),
            characters=sum(len(segment.text.strip()) for segment in segments),
        )

    async def play(
        self,
        project: StoryProject,
        segments: list[Segment],
        characters: list[Character],
    ) -> RenderStats:
        by_id = {character.id: character for character in characters}
        total = len(segments)
        if total == 0:
            return RenderStats()
        lookahead = min(self.config.playback.lookahead, total)
        tasks: dict[int, asyncio.Task[tuple[bytes, bool]]] = {
            index: asyncio.create_task(self._audio_for_segment(project, segments[index], by_id))
            for index in range(lookahead)
        }
        # Avoid starting playback before a useful initial buffer is ready.
        await asyncio.gather(*tasks.values())
        hits = 0
        generated = 0
        for index, segment in enumerate(segments):
            next_to_schedule = index + lookahead
            if next_to_schedule < total:
                tasks[next_to_schedule] = asyncio.create_task(
                    self._audio_for_segment(project, segments[next_to_schedule], by_id)
                )
            audio, hit = await tasks.pop(index)
            hits += int(hit)
            generated += int(not hit)
            await self.player.play(audio)
            if (
                index + 1 < total
                and segments[index + 1].speaker_id != segment.speaker_id
                and self.config.playback.speaker_pause_ms
            ):
                await asyncio.sleep(self.config.playback.speaker_pause_ms / 1_000)
        self.store.save_analysis(project, segments, characters)
        return RenderStats(
            cache_hits=hits,
            generated=generated,
            characters=sum(len(segment.text.strip()) for segment in segments),
        )
