"""claim-level veracity tiers + second-level reconciliation

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-08-12
"""

from alembic import op
import sqlalchemy as sa

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None

_OLD = "('full', 'moderate', 'partial', 'none', 'unsupported')"
_NEW = (
    "('verifiable_fact', 'probable_fact', 'gray_area', 'distorted', 'fabricated', "
    "'full', 'moderate', 'partial', 'none', 'unsupported')"
)


def upgrade() -> None:
    # Widened, not replaced: existing rows keep whatever label they were
    # scored with, and only new claims get the five-tier vocabulary.
    op.drop_constraint("ck_message_claims_entailment_label", "message_claims", type_="check")
    op.create_check_constraint(
        "ck_message_claims_entailment_label",
        "message_claims",
        f"entailment_label IS NULL OR entailment_label IN {_NEW}",
    )
    op.add_column("message_claims", sa.Column("reconciliation_note", sa.Text(), nullable=True))
    op.add_column(
        "message_claims",
        sa.Column("dynamic", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("message_claims", "dynamic")
    op.drop_column("message_claims", "reconciliation_note")
    op.execute(
        "UPDATE message_claims SET entailment_label = 'partial' "
        "WHERE entailment_label IN "
        "('verifiable_fact', 'probable_fact', 'gray_area', 'distorted', 'fabricated')"
    )
    op.drop_constraint("ck_message_claims_entailment_label", "message_claims", type_="check")
    op.create_check_constraint(
        "ck_message_claims_entailment_label",
        "message_claims",
        f"entailment_label IS NULL OR entailment_label IN {_OLD}",
    )
