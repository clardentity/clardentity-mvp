import io

import docx
import tiktoken
from pypdf import PdfReader

# Section 12.3: ~500-800 tokens per chunk, ~15% overlap.
CHUNK_TOKENS = 650
OVERLAP_TOKENS = 100

_encoding = tiktoken.get_encoding("cl100k_base")


def extract_pages(file_bytes: bytes, file_type: str) -> list[tuple[int | None, str]]:
    """Returns (page_number, text) pairs. page_number is 1-indexed for PDFs
    (so citations can point at a real page); DOCX/TXT have no page concept.
    """
    if file_type == "pdf":
        reader = PdfReader(io.BytesIO(file_bytes))
        return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]

    if file_type == "docx":
        document = docx.Document(io.BytesIO(file_bytes))
        text = "\n\n".join(p.text for p in document.paragraphs)
        return [(None, text)]

    return [(None, file_bytes.decode("utf-8", errors="ignore"))]


def chunk_text(text: str) -> list[str]:
    tokens = _encoding.encode(text)
    if not tokens:
        return []

    chunks: list[str] = []
    step = CHUNK_TOKENS - OVERLAP_TOKENS
    start = 0
    while start < len(tokens):
        chunk_tokens = tokens[start : start + CHUNK_TOKENS]
        chunks.append(_encoding.decode(chunk_tokens))
        if start + CHUNK_TOKENS >= len(tokens):
            break
        start += step
    return chunks
