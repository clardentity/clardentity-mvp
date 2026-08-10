"""support bands on claims + structured clarifying questions

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-08-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d4e5f6a7b8c9"
down_revision = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None

_OLD = "('full', 'partial', 'none', 'unsupported')"
_NEW = "('full', 'moderate', 'partial', 'none', 'unsupported')"


def upgrade() -> None:
    # "moderate" is the new 51-75 band. Existing rows keep whatever label they
    # were given, so the constraint has to allow both vocabularies.
    op.drop_constraint("ck_message_claims_entailment_label", "message_claims", type_="check")
    op.create_check_constraint(
        "ck_message_claims_entailment_label",
        "message_claims",
        f"entailment_label IS NULL OR entailment_label IN {_NEW}",
    )
    op.add_column(
        "messages",
        sa.Column("clarifier", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "clarifier")
    op.execute(
        "UPDATE message_claims SET entailment_label = 'partial' "
        "WHERE entailment_label = 'moderate'"
    )
    op.drop_constraint("ck_message_claims_entailment_label", "message_claims", type_="check")
    op.create_check_constraint(
        "ck_message_claims_entailment_label",
        "message_claims",
        f"entailment_label IS NULL OR entailment_label IN {_OLD}",
    )
