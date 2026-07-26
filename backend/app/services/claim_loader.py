import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Citation, ClaimEvidence, Document, MessageClaim
from app.schemas.chat import ClaimOut, EvidenceOut


async def load_claims_for_messages(
    db: AsyncSession, message_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[ClaimOut]]:
    if not message_ids:
        return {}

    claim_rows = await db.execute(
        select(MessageClaim)
        .where(MessageClaim.message_id.in_(message_ids))
        .order_by(MessageClaim.message_id, MessageClaim.claim_index)
    )
    claims = list(claim_rows.scalars().all())
    if not claims:
        return {}

    claim_ids = [c.id for c in claims]
    evidence_rows = await db.execute(
        select(ClaimEvidence, Citation, Document.filename)
        .join(Citation, Citation.id == ClaimEvidence.citation_id)
        .join(Document, Document.id == Citation.document_id)
        .where(ClaimEvidence.claim_id.in_(claim_ids))
    )

    evidence_by_claim: dict[uuid.UUID, list[EvidenceOut]] = {}
    for evidence, citation, filename in evidence_rows.all():
        evidence_by_claim.setdefault(evidence.claim_id, []).append(
            EvidenceOut(
                citation_marker=citation.marker,
                document_id=citation.document_id,
                document_filename=filename,
                excerpt=evidence.source_excerpt or "",
                support_score=evidence.support_score,
                relevance_score=evidence.relevance_score,
                entailment_label=evidence.entailment_label,
            )
        )

    result: dict[uuid.UUID, list[ClaimOut]] = {}
    for c in claims:
        result.setdefault(c.message_id, []).append(
            ClaimOut(
                claim_index=c.claim_index,
                claim_text=c.claim_text,
                claim_score=c.claim_score,
                entailment_label=c.entailment_label,
                distortion_flag=c.distortion_flag,
                distortion_explanation=c.distortion_explanation,
                evidence=evidence_by_claim.get(c.id, []),
            )
        )
    return result
