from __future__ import annotations

import re

from teller.models import SourceUnit, StoryChunk

_QUOTE_PAIRS = {'"': '"', "“": "”", "‘": "’"}
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])(?:[\"”’])?\s+")


def _escaped(text: str, index: int) -> bool:
    backslashes = 0
    index -= 1
    while index >= 0 and text[index] == "\\":
        backslashes += 1
        index -= 1
    return backslashes % 2 == 1


def _straight_single_opens(text: str, index: int) -> bool:
    if text[index] != "'" or index + 1 >= len(text) or text[index + 1].isspace():
        return False
    previous = text[index - 1] if index else ""
    if previous and (previous.isalnum() or previous in "_’'"):
        return False
    for closing in range(index + 1, len(text)):
        if text[closing] != "'" or _escaped(text, closing):
            continue
        before = text[closing - 1] if closing else ""
        after = text[closing + 1] if closing + 1 < len(text) else ""
        if before and not before.isspace() and (not after or not after.isalnum()):
            return True
    return False


def _opening_quote(text: str, index: int) -> str | None:
    character = text[index]
    if character in _QUOTE_PAIRS:
        return _QUOTE_PAIRS[character]
    if _straight_single_opens(text, index):
        return "'"
    return None


def _split_span(
    text: str,
    start: int,
    end: int,
    kind: str,
    max_unit_chars: int,
) -> list[tuple[int, int, str]]:
    parts: list[tuple[int, int, str]] = []
    cursor = start
    while end - cursor > max_unit_chars:
        window_end = cursor + max_unit_chars
        window = text[cursor:window_end]
        candidates = [match.end() for match in _SENTENCE_BOUNDARY.finditer(window)]
        split = cursor + candidates[-1] if candidates else -1
        if split <= cursor:
            paragraph = window.rfind("\n\n")
            whitespace = max(window.rfind(" "), window.rfind("\n"), window.rfind("\t"))
            relative = paragraph + 2 if paragraph >= max_unit_chars // 3 else whitespace + 1
            split = cursor + relative if relative > 0 else window_end
        parts.append((cursor, split, kind))
        cursor = split
    if cursor < end:
        parts.append((cursor, end, kind))
    return parts


def split_story(text: str, max_unit_chars: int = 2_000) -> list[SourceUnit]:
    """Split text without changing a single source character."""
    if not text:
        return []

    spans: list[tuple[int, int, str]] = []
    span_start = 0
    dialogue_start: int | None = None
    closing_quote: str | None = None
    index = 0
    while index < len(text):
        character = text[index]
        if closing_quote is None:
            closing = _opening_quote(text, index)
            if closing is not None and not _escaped(text, index):
                if span_start < index:
                    spans.append((span_start, index, "narration"))
                dialogue_start = index
                closing_quote = closing
        elif character == closing_quote and not _escaped(text, index):
            if dialogue_start is None:  # Defensive; the states always move together.
                raise RuntimeError("Dialogue parser entered an invalid state")
            spans.append((dialogue_start, index + 1, "dialogue"))
            span_start = index + 1
            dialogue_start = None
            closing_quote = None
        index += 1

    if dialogue_start is not None:
        spans.append((dialogue_start, len(text), "dialogue"))
        span_start = len(text)
    if span_start < len(text):
        spans.append((span_start, len(text), "narration"))

    expanded: list[tuple[int, int, str]] = []
    for start, end, kind in spans:
        expanded.extend(_split_span(text, start, end, kind, max_unit_chars))

    units = [
        SourceUnit(
            id=f"u{unit_index:06d}",
            index=unit_index,
            text=text[start:end],
            kind=kind,  # type: ignore[arg-type]
            start=start,
            end=end,
        )
        for unit_index, (start, end, kind) in enumerate(expanded)
    ]
    if "".join(unit.text for unit in units) != text:
        raise RuntimeError("Story splitting changed the source text")
    return units


def make_chunks(
    units: list[SourceUnit],
    max_chars: int = 8_000,
    context_units: int = 2,
) -> list[StoryChunk]:
    if not units:
        return []

    groups: list[list[SourceUnit]] = []
    current: list[SourceUnit] = []
    current_chars = 0
    for unit in units:
        size = len(unit.text)
        if current and current_chars + size > max_chars:
            groups.append(current)
            current = []
            current_chars = 0
        current.append(unit)
        current_chars += size
    if current:
        groups.append(current)

    chunks: list[StoryChunk] = []
    for index, group in enumerate(groups):
        start = group[0].index
        end = group[-1].index + 1
        chunks.append(
            StoryChunk(
                index=index,
                units=group,
                context_before=units[max(0, start - context_units) : start],
                context_after=units[end : end + context_units],
            )
        )
    return chunks
