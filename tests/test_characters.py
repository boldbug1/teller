from teller.characters import CharacterRegistry
from teller.models import Character, CharacterObservation, VoiceAssignment


def test_alias_observation_merges_into_existing_character() -> None:
    registry = CharacterRegistry(
        [Character(id="mira", name="Mira", aliases=["the girl"], traits=["nervous"])]
    )

    references = registry.apply_observations(
        [
            CharacterObservation(
                ref="new_girl",
                name="the girl",
                aliases=["Mira"],
                traits=["brave"],
            )
        ],
        chunk_index=2,
    )

    assert references["new_girl"] == "mira"
    assert registry.get("mira").traits == ["nervous", "brave"]
    assert len([item for item in registry.all() if item.id != "narrator"]) == 1


def test_character_updates_never_replace_a_saved_voice() -> None:
    assignment = VoiceAssignment(provider="kokoro", model="test", voice_id="af_heart")
    registry = CharacterRegistry([Character(id="mira", name="Mira", voice=assignment)])

    registry.apply_observations(
        [CharacterObservation(ref="mira", name="Mira", traits=["calm"])],
        chunk_index=1,
    )

    assert registry.get("mira").voice == assignment
