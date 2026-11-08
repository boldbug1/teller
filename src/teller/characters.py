from __future__ import annotations

import re
import unicodedata

from teller.models import NARRATOR_ID, Character, CharacterObservation


def _identity_key(value: str) -> str:
    return " ".join(value.casefold().split())


def _character_id(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return value[:48] or "character"


class CharacterRegistry:
    def __init__(self, characters: list[Character] | None = None):
        supplied = characters or []
        self._characters: dict[str, Character] = {character.id: character for character in supplied}
        if NARRATOR_ID not in self._characters:
            self._characters[NARRATOR_ID] = Character(
                id=NARRATOR_ID,
                name="Narrator",
                aliases=["narration"],
            )
        self._rebuild_aliases()

    def _rebuild_aliases(self) -> None:
        self._aliases: dict[str, str] = {}
        for character in self._characters.values():
            for value in [character.name, *character.aliases]:
                self._aliases.setdefault(_identity_key(value), character.id)

    @property
    def ids(self) -> set[str]:
        return set(self._characters)

    def get(self, character_id: str) -> Character:
        return self._characters[character_id]

    def all(self) -> list[Character]:
        narrator = self._characters[NARRATOR_ID]
        others = sorted(
            (character for key, character in self._characters.items() if key != NARRATOR_ID),
            key=lambda character: character.name.casefold(),
        )
        return [narrator, *others]

    def prompt_data(self) -> list[dict[str, object]]:
        return [
            {
                "id": character.id,
                "name": character.name,
                "aliases": character.aliases,
                "gender": character.gender,
                "age": character.age,
                "traits": character.traits,
                "last_seen_chunk": character.last_seen_chunk,
            }
            for character in self.all()
        ]

    def _find_observation_match(self, observation: CharacterObservation) -> str | None:
        for value in [observation.name, *observation.aliases]:
            matched = self._aliases.get(_identity_key(value))
            if matched:
                return matched
        return None

    @staticmethod
    def _merge(character: Character, observation: CharacterObservation, chunk_index: int) -> None:
        aliases = [*character.aliases]
        if observation.name.casefold() != character.name.casefold():
            aliases.append(observation.name)
        aliases.extend(observation.aliases)
        character.aliases = aliases
        if character.gender is None:
            character.gender = observation.gender
        if character.age is None:
            character.age = observation.age
        character.traits = [*character.traits, *observation.traits]
        # Revalidate collection fields so duplicate aliases and traits are removed.
        validated = Character.model_validate(character.model_dump())
        character.aliases = validated.aliases
        character.traits = validated.traits
        character.last_seen_chunk = chunk_index

    def apply_observations(
        self,
        observations: list[CharacterObservation],
        chunk_index: int,
    ) -> dict[str, str]:
        references = {character_id: character_id for character_id in self._characters}
        for observation in observations:
            if observation.ref in self._characters:
                character_id = observation.ref
            else:
                matched = self._find_observation_match(observation)
                if matched is not None:
                    character_id = matched
                else:
                    character_id = _character_id(observation.name)
                    base = character_id
                    suffix = 2
                    while character_id in self._characters:
                        character_id = f"{base}-{suffix}"
                        suffix += 1
                    self._characters[character_id] = Character(
                        id=character_id,
                        name=observation.name.strip(),
                    )
            self._merge(self._characters[character_id], observation, chunk_index)
            references[observation.ref] = character_id
            self._rebuild_aliases()
        return references

    def mark_seen(self, character_id: str, chunk_index: int) -> None:
        self._characters[character_id].last_seen_chunk = chunk_index
