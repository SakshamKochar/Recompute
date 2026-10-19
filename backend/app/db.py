import os
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, TypeDecorator, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./recompute.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def now():
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc) if value is not None else None

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


class Base(DeclarativeBase):
    pass


class Batch(Base):
    __tablename__ = "batches"

    batch_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    source: Mapped[str] = mapped_column(String(16))
    filename: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)

    assets: Mapped[list["Asset"]] = relationship(back_populates="batch", order_by="Asset.asset_id")


class Asset(Base):
    __tablename__ = "assets"

    asset_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    model: Mapped[str | None] = mapped_column(String(64))
    grade: Mapped[str | None] = mapped_column(String(8))
    age_months: Mapped[int | None] = mapped_column(Integer)
    site: Mapped[str | None] = mapped_column(String(128))
    failed_part: Mapped[str | None] = mapped_column(String(64))
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    batch_id: Mapped[str | None] = mapped_column(ForeignKey("batches.batch_id"), index=True)
    inputs: Mapped[dict] = mapped_column(JSON, default=dict)
    diagnostics: Mapped[dict | None] = mapped_column(JSON)
    state: Mapped[str] = mapped_column(String(32), default="RECEIVED")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now, onupdate=now)

    batch: Mapped[Batch | None] = relationship(back_populates="assets")
    recommendations: Mapped[list["Recommendation"]] = relationship(
        back_populates="asset", order_by="Recommendation.id", cascade="all, delete-orphan")
    transitions: Mapped[list["Transition"]] = relationship(
        back_populates="asset", order_by="Transition.id", cascade="all, delete-orphan")


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.asset_id"), index=True)
    model_version: Mapped[str] = mapped_column(String(16))
    inputs: Mapped[dict] = mapped_column(JSON)
    route: Mapped[str] = mapped_column(String(32))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)

    asset: Mapped[Asset] = relationship(back_populates="recommendations")


class Transition(Base):
    __tablename__ = "transitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.asset_id"), index=True)
    event: Mapped[str] = mapped_column(String(32))
    from_state: Mapped[str | None] = mapped_column(String(32))
    to_state: Mapped[str] = mapped_column(String(32))
    route_at_time: Mapped[str | None] = mapped_column(String(32))
    override: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=now)

    asset: Mapped[Asset] = relationship(back_populates="transitions")


def init_db():
    Base.metadata.create_all(engine)


def get_session():
    with SessionLocal() as session:
        yield session
