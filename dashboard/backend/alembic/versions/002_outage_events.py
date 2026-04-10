"""Add outage_events table

Revision ID: 002
Revises: 001
Create Date: 2026-04-10
"""
import sqlalchemy as sa
from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "outage_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("cause", sa.String(), nullable=True),
        sa.Column("latency_ms", sa.Float(), nullable=True),
    )
    op.create_index("ix_outage_events_user_id", "outage_events", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_outage_events_user_id", table_name="outage_events")
    op.drop_table("outage_events")
