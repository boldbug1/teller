from teller.chunker import make_chunks, split_story


def test_split_story_preserves_every_character_and_marks_dialogue() -> None:
    story = "Mira waited. “Who's there?”\n\n'Only me,' Tom said."

    units = split_story(story)

    assert "".join(unit.text for unit in units) == story
    assert [unit.kind for unit in units] == [
        "narration",
        "dialogue",
        "narration",
        "dialogue",
        "narration",
    ]
    assert [unit.id for unit in units] == [f"u{index:06d}" for index in range(5)]


def test_contractions_are_not_treated_as_straight_single_quotes() -> None:
    story = "I don't think Mira's coming."

    units = split_story(story)

    assert len(units) == 1
    assert units[0].kind == "narration"
    assert units[0].text == story


def test_long_units_and_chunks_preserve_order_and_context() -> None:
    story = "One sentence. " * 30
    units = split_story(story, max_unit_chars=60)
    chunks = make_chunks(units, max_chars=100, context_units=1)

    assert "".join(unit.text for unit in units) == story
    assert len(units) > 1
    assert len(chunks) > 1
    assert chunks[1].context_before == [chunks[0].units[-1]]
    assert chunks[0].context_after == [chunks[1].units[0]]
