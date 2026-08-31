"""claim-level "opinion" tier

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-08-31
"""

from alembic import op

revision = "d2e3f4a5b6c7"
down_revision = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None

_OLD = (
    "('verifiable_fact', 'probable_fact', 'gray_area', 'distorted', 'fabricated', "
    "'full', 'moderate', 'partial', 'none', 'unsupported')"
)
_NEW = (
    "('verifiable_fact', 'probable_fact', 'gray_area', 'distorted', 'fabricated', "
    "'opinion', 'full', 'moderate', 'partial', 'none', 'unsupported')"
)


def upgrade() -> None:
    # Widened, not replaced: a claim the model wrote as its own stated view
    # (no source of truth to cite against) gets its own tier rather than
    # landing in "fabricated", which reads as an accusation of lying about
    # something that was never claimed to be a fact.
    op.drop_constraint("ck_message_claims_entailment_label", "message_claims", type_="check")
    op.create_check_constraint(
        "ck_message_claims_entailment_label",
        "message_claims",
        f"entailment_label IS NULL OR entailment_label IN {_NEW}",
    )


def downgrade() -> None:
    op.execute("UPDATE message_claims SET entailment_label = 'unsupported' WHERE entailment_label = 'opinion'")
    op.drop_constraint("ck_message_claims_entailment_label", "message_claims", type_="check")
    op.create_check_constraint(
        "ck_message_claims_entailment_label",
        "message_claims",
        f"entailment_label IS NULL OR entailment_label IN {_OLD}",
    )
