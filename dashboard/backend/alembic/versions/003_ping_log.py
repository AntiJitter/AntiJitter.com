"""Add ping_logs table

Revision ID: 003
Revises: 002
Create Date: 2026-04-13
"""
import sqlalchemy as sa
from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ping_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("latency_ms", sa.Float(), nullable=False),
    )
    op.create_index("ix_ping_logs_user_id", "ping_logs", ["user_id"])
    op.create_index("ix_ping_logs_ts", "ping_logs", ["ts"])


def downgrade() -> None:
    op.drop_index("ix_ping_logs_ts", table_name="ping_logs")
    op.drop_index("ix_ping_logs_user_id", table_name="ping_logs")
    op.drop_table("ping_logs")
