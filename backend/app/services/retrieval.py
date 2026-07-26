import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, DocumentChunk
from app.services.openai_client import embed_text

TOP_K = 5

# Section 7.4 - lightweight keyword triggers used only to decide which
# Wh-lenses apply to a Knowing-mode query; this never touches `mode` itself.
WH_LENS_KEYWORDS: dict[str, list[str]] = {
    "who": ["who", "whose", "author", "owner", "responsible"],
    "what": ["what", "define", "definition", "contents", "feature"],
    "where": ["where", "location", "section", "page", "jurisdiction"],
    "when": ["when", "date", "deadline", "expir", "renew"],
    "why": ["why", "reason", "rationale", "because"],
    "which": ["which", "compare", "versus", " vs"],
    "how": ["how", "process", "method", "procedure", "workflow"],
}


def _select_wh_lenses(query: str, max_lenses: int = 2) -> list[str]:
    lowered = query.lower()
    matched = [
        lens for lens, keywords in WH_LENS_KEYWORDS.items() if any(k in lowered for k in keywords)
    ]
    return matched[:max_lenses]


@dataclass
class RetrievedChunk:
    chunk: DocumentChunk
    document: Document
    score: float


async def retrieve_chunks(
    db: AsyncSession, workspace_id: uuid.UUID, query: str, mode: str, top_k: int = TOP_K
) -> list[RetrievedChunk]:
    """Top-k pgvector similarity search over the workspace's processed documents.

    Runs for every mode. Knowing mode additionally expands the query with up
    to two Wh-lensed sub-queries (§7.4) and merges/dedupes the results.
    """
    queries = [query]
    if mode == "knowing":
        queries += [f"({lens}) {query}" for lens in _select_wh_lenses(query)]

    best_by_chunk: dict[uuid.UUID, RetrievedChunk] = {}

    for q in queries:
        embedding = await embed_text(q)
        distance = DocumentChunk.embedding.cosine_distance(embedding)
        rows = await db.execute(
            select(DocumentChunk, Document, distance.label("distance"))
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(Document.workspace_id == workspace_id, Document.status == "processed")
            .order_by(distance)
            .limit(top_k)
        )
        for chunk, document, distance_value in rows.all():
            score = 1 - float(distance_value)
            existing = best_by_chunk.get(chunk.id)
            if existing is None or score > existing.score:
                best_by_chunk[chunk.id] = RetrievedChunk(chunk=chunk, document=document, score=score)

    ranked = sorted(best_by_chunk.values(), key=lambda rc: rc.score, reverse=True)
    return ranked[:top_k]
