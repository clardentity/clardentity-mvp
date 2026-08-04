"""bias taxonomy: widen distortion vocabulary, add bias category

Revision ID: a1b2c3d4e5f6
Revises: 3de2e7bee450
Create Date: 2026-08-04

`distortion_flag` used to be one of two hardcoded reasoning distortions. It now
holds any id from the cognitive-bias taxonomy (~437 entries, including those
two), so the CHECK constraint is dropped - the vocabulary lives in
app/services/taxonomy.py and is validated there, where it can grow without a
migration. `bias_category` records which of the 10 everyday-scenario domains
the detected bias belongs to, for filtering and display.
"""

from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "3de2e7bee450"
branch_labels = None
depends_on = None

_OLD_FLAGS = "('wishful_thinking', 'magical_thinking')"


def upgrade() -> None:
    op.drop_constraint("ck_message_claims_distortion_flag", "message_claims", type_="check")
    op.add_column("message_claims", sa.Column("bias_category", sa.String(), nullable=True))
    op.create_index(
        "ix_message_claims_distortion_flag", "message_claims", ["distortion_flag"]
    )


def downgrade() -> None:
    op.drop_index("ix_message_claims_distortion_flag", table_name="message_claims")
    op.drop_column("message_claims", "bias_category")
    # Rows naming a bias outside the original two would violate the restored
    # constraint, so clear them first.
    op.execute(
        "UPDATE message_claims SET distortion_flag = NULL, distortion_explanation = NULL "
        f"WHERE distortion_flag IS NOT NULL AND distortion_flag NOT IN {_OLD_FLAGS}"
    )
    op.create_check_constraint(
        "ck_message_claims_distortion_flag",
        "message_claims",
        f"distortion_flag IS NULL OR distortion_flag IN {_OLD_FLAGS}",
    )
