from __future__ import annotations

import io
import zipfile
from pathlib import Path

from teller.document import (
    extract_docx_text,
    extract_story_title,
    extract_text_from_file,
)


def test_extract_story_title_markdown_header() -> None:
    text = "# The Golden Key\n\nThere was once a boy who found a golden key."
    assert extract_story_title(text) == "The Golden Key"


def test_extract_story_title_first_line() -> None:
    text = "The Shadow Over Innsmouth\n\nDuring the winter of 1927-28..."
    assert extract_story_title(text) == "The Shadow Over Innsmouth"


def test_extract_story_title_from_filename() -> None:
    text = "Once upon a time there lived three brothers in a cottage by the lake."
    assert extract_story_title(text, "the_three_brothers.pdf") == "The Three Brothers"


def test_extract_story_title_fallback() -> None:
    text = "A very long sentence that just goes on and on and on and has no clear title at all."
    title = extract_story_title(text)
    assert len(title) <= 40
    assert title.startswith("A very long sentence")


def test_extract_docx_text() -> None:
    # Build minimal in-memory docx zip
    docx_stream = io.BytesIO()
    doc_xml = b"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
            <w:p><w:r><w:t>Chapter One</w:t></w:r></w:p>
            <w:p><w:r><w:t>It was a bright cold day in April.</w:t></w:r></w:p>
        </w:body>
    </w:document>
    """
    with zipfile.ZipFile(docx_stream, "w") as z:
        z.writestr("word/document.xml", doc_xml)

    docx_bytes = docx_stream.getvalue()
    extracted = extract_docx_text(docx_bytes)
    assert "Chapter One" in extracted
    assert "It was a bright cold day in April." in extracted


def test_extract_text_from_file(tmp_path: Path) -> None:
    txt_file = tmp_path / "sample.txt"
    txt_file.write_text("Plain text content", encoding="utf-8")
    assert extract_text_from_file(txt_file) == "Plain text content"

    md_file = tmp_path / "sample.md"
    md_file.write_text("# Markdown Title\nContent", encoding="utf-8")
    assert "# Markdown Title" in extract_text_from_file(md_file)
