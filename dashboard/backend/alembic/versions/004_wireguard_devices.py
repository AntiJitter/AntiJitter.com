"""Add per-device WireGuard peers

Revision ID: 004
Revises: 003
Create Date: 2026-05-02
"""

from alembic import op
import sqlalchemy as sa


revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "wireguard_devices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("subscription_id", sa.Integer(), nullable=False),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("device_name", sa.String(), nullable=True),
        sa.Column("wireguard_public_key", sa.String(), nullable=False),
        sa.Column("wireguard_private_key", sa.String(), nullable=False),
        sa.Column("wireguard_peer_ip", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["subscription_id"], ["subscriptions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "subscription_id",
            "device_id",
            name="uq_wireguard_devices_subscription_device",
        ),
        sa.UniqueConstraint("wireguard_peer_ip"),
    )
    op.create_index(
        op.f("ix_wireguard_devices_subscription_id"),
        "wireguard_devices",
        ["subscription_id"],
        unique=False,
    )


def downgrade():
    op.drop_index(op.f("ix_wireguard_devices_subscription_id"), table_name="wireguard_devices")
    op.drop_table("wireguard_devices")
