from __future__ import annotations

import hashlib

from teller.models import NARRATOR_ID, Character, Voice, VoiceAssignment
from teller.providers.protocols import TTSProvider


def _tokens(values: list[str]) -> set[str]:
    return {token.casefold() for value in values for token in value.replace("-", " ").split()}


def _language_key(value: str) -> str:
    return value.casefold().replace("_", "-")


def _voice_score(
    character: Character,
    voice: Voice,
    used: set[str],
    target_language: str | None,
) -> int:
    score = 0
    if voice.id not in used:
        score += 30
    if character.gender and voice.gender:
        score += 12 if character.gender.casefold() == voice.gender.casefold() else -8
    if character.age and voice.age:
        score += 6 if character.age.casefold() == voice.age.casefold() else -3
    if target_language and voice.language:
        score += 20 if _language_key(target_language) == _language_key(voice.language) else -100
    score += len(_tokens(character.traits) & _tokens(voice.traits)) * 4
    if character.id == NARRATOR_ID:
        narrator_words = {"narrator", "storyteller", "warm", "clear", "informative"}
        score += len(_tokens(voice.traits) & narrator_words) * 6
    return score


def _tie_breaker(character_id: str, voice_id: str) -> str:
    return hashlib.sha256(f"{character_id}\0{voice_id}".encode()).hexdigest()


async def assign_voices(
    characters: list[Character],
    provider: TTSProvider,
    *,
    force: bool = False,
) -> list[Character]:
    voices = await provider.list_voices()
    if not voices:
        raise RuntimeError(f"{provider.provider_id} returned no voices")
    target_language = provider.language
    if target_language:
        exact = [
            voice
            for voice in voices
            if voice.language and _language_key(voice.language) == _language_key(target_language)
        ]
        same_language = [
            voice
            for voice in voices
            if voice.language
            and _language_key(voice.language).split("-", 1)[0]
            == _language_key(target_language).split("-", 1)[0]
        ]
        compatible = exact or same_language
        if any(voice.language for voice in voices) and not compatible:
            raise RuntimeError(f"No voices support configured language: {target_language}")
        voices = compatible or voices

    if force:
        for character in characters:
            character.voice = None
    incompatible = [
        character.name
        for character in characters
        if character.voice
        and (
            character.voice.provider != provider.provider_id
            or character.voice.model != provider.model_id
            or (
                target_language is not None
                and (
                    character.voice.language is None
                    or _language_key(character.voice.language) != _language_key(target_language)
                )
            )
        )
    ]
    if incompatible:
        names = ", ".join(incompatible)
        raise RuntimeError(
            f"Saved voices for {names} use another provider; rerun with --reassign-voices"
        )

    used = {
        character.voice.voice_id
        for character in characters
        if character.voice and character.voice.provider == provider.provider_id
    }
    ordered = sorted(characters, key=lambda item: item.id != NARRATOR_ID)
    for character in ordered:
        if character.voice:
            continue
        ranked = sorted(
            voices,
            key=lambda voice: (
                -_voice_score(character, voice, used, target_language),
                _tie_breaker(character.id, voice.id),
            ),
        )
        selected = ranked[0]
        character.voice = VoiceAssignment(
            provider=provider.provider_id,
            model=provider.model_id,
            voice_id=selected.id,
            language=target_language,
        )
        used.add(selected.id)
    return characters
