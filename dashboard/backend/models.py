from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def _now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    subscriptions: Mapped[list["Subscription"]] = relationship(back_populates="user")
    sessions: Mapped[list["Session"]] = relationship(back_populates="user")
    outage_events: Mapped[list["OutageEvent"]] = relationship(back_populates="user")
    ping_logs: Mapped[list["PingLog"]] = relationship(back_populates="user")


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    # "solo" | "family"
    plan: Mapped[str] = mapped_column(String, nullable=False)
    # "active" | "trialing" | "inactive" | "past_due"
    status: Mapped[str] = mapped_column(String, nullable=False, default="inactive")

    stripe_customer_id: Mapped[str | None] = mapped_column(String, nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String, nullable=True)

    wireguard_public_key: Mapped[str | None] = mapped_column(String, nullable=True)
    wireguard_private_key: Mapped[str | None] = mapped_column(String, nullable=True)
    wireguard_peer_ip: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(back_populates="subscriptions")
    wireguard_devices: Mapped[list["WireGuardDevice"]] = relationship(
        back_populates="subscription",
        cascade="all, delete-orphan",
    )


class WireGuardDevice(Base):
    __tablename__ = "wireguard_devices"
    __table_args__ = (
        UniqueConstraint("subscription_id", "device_id", name="uq_wireguard_devices_subscription_device"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("subscriptions.id"), nullable=False, index=True
    )
    device_id: Mapped[str] = mapped_column(String, nullable=False)
    device_name: Mapped[str | None] = mapped_column(String, nullable=True)
    wireguard_public_key: Mapped[str] = mapped_column(String, nullable=False)
    wireguard_private_key: Mapped[str] = mapped_column(String, nullable=False)
    wireguard_peer_ip: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    subscription: Mapped["Subscription"] = relationship(back_populates="wireguard_devices")


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    avg_ping: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_spike: Mapped[float | None] = mapped_column(Float, nullable=True)
    failover_count: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped["User"] = relationship(back_populates="sessions")


class OutageEvent(Base):
    """A Starlink outage detected by the SWITCH poller.

    Opened when the dish reports obstructed/no-sats; closed when signal
    recovers. Duration and peak latency are stored for the history view.
    """
    __tablename__ = "outage_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    # "OBSTRUCTED" | "NO_SATS" | "BOOTING" | "SEARCHING" | etc.
    cause: Mapped[str | None] = mapped_column(String, nullable=True)
    # Latency at onset of outage (shows how bad it got)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    user: Mapped["User"] = relationship(back_populates="outage_events")


class PingLog(Base):
    """Browser-measured round-trip latency to the API, one row per ping."""
    __tablename__ = "ping_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False)

    user: Mapped["User"] = relationship(back_populates="ping_logs")


class Game(Base):
    __tablename__ = "games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    slug: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    icon: Mapped[str] = mapped_column(String, default="🎮")
    asn: Mapped[str | None] = mapped_column(String, nullable=True)
    ip_ranges: Mapped[list] = mapped_column(JSON, default=list)
    regions: Mapped[list] = mapped_column(JSON, default=list)
    # "active" | "coming_soon"
    status: Mapped[str] = mapped_column(String, default="active")
    range_count: Mapped[int] = mapped_column(Integer, default=0)
    last_synced: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class GameRequest(Base):
    __tablename__ = "game_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    game_name: Mapped[str] = mapped_column(String, nullable=False)
    # "PC" | "PlayStation" | "Xbox" | "Mobile" | "Switch" | "Other"
    platform: Mapped[str | None] = mapped_column(String, nullable=True)
    website: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    submitted_email: Mapped[str | None] = mapped_column(String, nullable=True)
    votes: Mapped[int] = mapped_column(Integer, default=1)
    # "pending" | "in_review" | "added" | "rejected"
    status: Mapped[str] = mapped_column(String, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
