from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


def extract_docx_text(source: Path | bytes) -> str:
    """Extract clean paragraph text from a Word .docx document."""
    stream: io.BytesIO | Path = (
        io.BytesIO(source) if isinstance(source, bytes) else source
    )
    with zipfile.ZipFile(stream) as z:
        if "word/document.xml" not in z.namelist():
            raise ValueError("Invalid Word document: missing word/document.xml")
        xml_bytes = z.read("word/document.xml")

    tree = ET.fromstring(xml_bytes)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []

    for p in tree.iterfind(".//w:p", ns):
        texts = [node.text for node in p.iterfind(".//w:t", ns) if node.text]
        if texts:
            line = "".join(texts).strip()
            if line:
                paragraphs.append(line)

    return "\n\n".join(paragraphs)


def extract_pdf_text(source: Path | bytes) -> str:
    """Extract text from a PDF document using pypdf."""
    try:
        from pypdf import PdfReader
    except ImportError as err:
        raise RuntimeError("pypdf is required for PDF import: pip install pypdf") from err

    stream = io.BytesIO(source) if isinstance(source, bytes) else source
    reader = PdfReader(stream)
    pages: list[str] = []

    for page in reader.pages:
        txt = page.extract_text()
        if txt and txt.strip():
            pages.append(txt.strip())

    if not pages:
        raise ValueError("PDF appears to be empty or contains no extractable text")

    return "\n\n".join(pages)


def extract_text_from_file(path: Path) -> str:
    """Extract plain text from txt, md, pdf, docx, or doc."""
    ext = path.suffix.lower()

    if ext in (".txt", ".md", ".markdown"):
        try:
            return path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return path.read_text(encoding="latin-1")

    if ext == ".docx":
        return extract_docx_text(path)

    if ext == ".pdf":
        return extract_pdf_text(path)

    if ext == ".doc":
        raise ValueError(
            "Legacy binary Word (.doc) is not directly supported. "
            "Please convert or save it as .docx, .pdf, or .txt."
        )

    # Fallback to UTF-8 text
    try:
        return path.read_text(encoding="utf-8")
    except Exception as err:
        raise ValueError(
            f"Unsupported file format '{ext}'. Supported formats: .txt, .md, .pdf, .docx"
        ) from err


def extract_story_title(text: str, filename_hint: str | None = None) -> str:
    """
    Automatically pick up the story title from the story content or filename.
    The user should never be forced to enter a title manually.
    """
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]

    # 1. Look for markdown header in first few lines: # Title or ## Title
    for line in lines[:5]:
        if line.startswith("#"):
            candidate = line.lstrip("#").strip()
            if 3 <= len(candidate) <= 80:
                return candidate

    # 2. If the first line is short and looks like a standalone title
    if lines:
        clean_first = lines[0].strip("\"'#*~_ ")
        if 3 <= len(clean_first) <= 60 and not clean_first.endswith((".", ",", ";", ":", "?", "!")):
            return clean_first

    # 3. If filename_hint is provided, turn "the-monkeys-paw.pdf" -> "The Monkeys Paw"
    if filename_hint:
        stem = Path(filename_hint).stem
        cleaned = re.sub(r"[_\-]+", " ", stem).strip()
        if cleaned:
            return cleaned.title()

    # 4. Fallback: first 40 characters of first line
    if lines:
        clean_snip = lines[0].strip("\"'#*~_ ")[:40].strip()
        if clean_snip:
            return clean_snip

    return "Untitled Story"
