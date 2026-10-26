from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import Tracked


class Program(Tracked, Base):
    __tablename__ = "programs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))


class Warehouse(Tracked, Base):
    __tablename__ = "warehouses"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    facility: Mapped[str] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(120))


class Supplier(Tracked, Base):
    __tablename__ = "suppliers"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    contact_email: Mapped[str | None] = mapped_column(String(200))


class Part(Tracked, Base):
    __tablename__ = "parts"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    part_number: Mapped[str] = mapped_column(String(40), unique=True)
    description: Mapped[str] = mapped_column(String(200))
    uom: Mapped[str] = mapped_column(String(10), default="ea")
    requires_qa: Mapped[bool] = mapped_column(Boolean, default=False)
    lot_tracked: Mapped[bool] = mapped_column(Boolean, default=False)
    lead_time_days: Mapped[int | None] = mapped_column(Integer)
    preferred_supplier_id: Mapped[str | None] = mapped_column(ForeignKey("suppliers.id"))
    # Company defaults; a PartStockPolicy row overrides per warehouse.
    default_reorder_point: Mapped[int | None] = mapped_column(Integer)
    default_target_level: Mapped[int | None] = mapped_column(Integer)


class PartStockPolicy(Tracked, Base):
    __tablename__ = "part_stock_policies"
    __table_args__ = (UniqueConstraint("part_id", "warehouse_id"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    part_id: Mapped[str] = mapped_column(ForeignKey("parts.id"))
    warehouse_id: Mapped[str] = mapped_column(ForeignKey("warehouses.id"))
    reorder_point: Mapped[int] = mapped_column(Integer)
    target_level: Mapped[int] = mapped_column(Integer)
