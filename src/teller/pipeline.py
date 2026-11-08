from __future__ import annotations

import asyncio

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
        self._tts_semaphore = asyncio.Semaphore(config.tts.concurrency)
        self._inflight_lock = asyncio.Lock()
        self._inflight: dict[str, asyncio.Task[bytes]] = {}

    async def analyze(
        self,
        project: StoryProject,
        *,
        force: bool = False,
    ) -> tuple[list[Segment], list[Character]]:
        existing = self.store.load_analysis(project)
        if existing is not None and not force:
            return existing
        if self.llm is None:
            raise RuntimeError("This story needs analysis, but no LLM provider is configured")
        tagger = StoryTagger(
            self.llm,
            max_chunk_chars=self.config.llm.max_chunk_chars,
            retries=self.config.llm.retries,
        )
        source = self.store.story_text(project)
        prior_characters = existing[1] if existing else None
        segments, characters = await tagger.tag(source, prior_characters)
        self.store.save_analysis(project, segments, characters)
        return segments, characters

    async def prepare_voices(
        self,
        project: StoryProject,
        segments: list[Segment],
        characters: list[Character],
        *,
        force: bool = False,
    ) -> list[Character]:
        if not force and all(character.voice is not None for character in characters):
            if self.tts is None:
                return characters
            await assign_voices(characters, self.tts)
            return characters
        if self.tts is None:
            raise RuntimeError("No TTS provider is configured")
        characters = await assign_voices(characters, self.tts, force=force)
        self.store.save_analysis(project, segments, characters)
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
    ) -> RenderStats:
        by_id = {character.id: character for character in characters}
        results = await asyncio.gather(
            *(self._audio_for_segment(project, segment, by_id) for segment in segments)
        )
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
