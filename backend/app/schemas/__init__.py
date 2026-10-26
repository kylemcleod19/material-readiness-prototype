"""API input schemas. Business validation stays in the services; these check shape only."""
import datetime as dt
from datetime import date

from pydantic import BaseModel, Field


class Op(BaseModel):
    # Client-generated id; repeating it returns the original result instead of re-running.
    op_id: str | None = Field(default=None, max_length=80)


class QtyOp(Op):
    op_id: str = Field(min_length=8, max_length=80)


class WorkOrderItemIn(BaseModel):
    part_id: str
    required_qty: int = Field(gt=0)


class FixtureIn(BaseModel):
    operation: str
    fixture_type: str
    quantity: int = Field(gt=0)


class WorkOrderCreate(Op):
    number: str
    title: str
    program_id: str
    warehouse_id: str
    production_start_date: date
    build_qty: int = Field(gt=0, default=1)
    items: list[WorkOrderItemIn]
    fixtures: list[FixtureIn] = []


class CancelIn(Op):
    reason: str = Field(min_length=1)


class ReduceIn(QtyOp):
    new_required_qty: int = Field(ge=0)


class AssignIn(QtyOp):
    source_type: str
    source_id: str
    qty: int = Field(gt=0)


class ConfirmHoldIn(QtyOp):
    expected_arrival: date | None = None


class TransferUpdateIn(Op):
    status: str | None = None
    expected_arrival: date | None = None


class FixtureReviewIn(Op):
    coverage_state: str
    note: str | None = None


class POAllocationIn(BaseModel):
    work_order_item_id: str
    qty: int = Field(gt=0)


class POLineIn(BaseModel):
    part_id: str
    qty: int = Field(gt=0)
    expected_arrival: date | None = None
    allocations: list[POAllocationIn] = []


class POCreate(QtyOp):
    supplier_id: str
    destination_warehouse_id: str
    lines: list[POLineIn]


class ArrivalIn(Op):
    target_type: str  # po_line | shipment
    target_id: str
    expected_arrival: date | None
    basis: str = "supplier_promise"
    note: str | None = None


class ShipmentLineIn(BaseModel):
    po_line_id: str
    qty: int = Field(gt=0)


class ShipmentCreate(QtyOp):
    lines: list[ShipmentLineIn]
    expected_arrival: date | None = None
    carrier: str | None = None
    tracking_number: str | None = None


class CheckInCreate(Op):
    po_id: str
    po_line_id: str | None = None
    due_date: date
    owner: str
    note: str | None = None


class NewArrival(BaseModel):
    target_type: str
    target_id: str
    expected_arrival: date | None
    basis: str = "supplier_promise"


class CheckInComplete(Op):
    outcome: str = Field(min_length=1)
    new_arrival: NewArrival | None = None


class ShortfallIn(QtyOp):
    qty: int = Field(gt=0)
    note: str = Field(min_length=1)


class NoteIn(Op):
    note: str | None = None


class ReceiptLineIn(BaseModel):
    po_line_id: str
    shipment_line_id: str | None = None
    qty: int = Field(gt=0)
    lot: str | None = None


class ReceiptIn(QtyOp):
    warehouse_id: str
    shipment_id: str | None = None
    lines: list[ReceiptLineIn]


class QAComplete(QtyOp):
    accepted_qty: int = Field(ge=0)
    rejected_qty: int = Field(ge=0)
    note: str | None = None


class LocationIn(QtyOp):
    location: str = Field(min_length=1)


class PickIn(QtyOp):
    qty: int = Field(gt=0)
    location: str = Field(min_length=1)
    stage_direct: bool = False


class HandoffIn(QtyOp):
    qty: int = Field(gt=0)


class DiscrepancyIn(Op):
    type: str
    title: str = Field(min_length=1)
    detail: str | None = None
    source_type: str
    source_id: str
    affected_qty: int = Field(ge=0)
    work_order_item_ids: list[str] = []


class ScenarioCreate(Op):
    po_line_id: str


class ProposalIn(BaseModel):
    work_order_item_id: str
    available_qty: int = Field(ge=0)
    incoming_qty: int = Field(ge=0)


class ScenarioUpdate(Op):
    proposals: list[ProposalIn]


class SupplierEvent(Op):
    """Simulated supplier/carrier integration input. Uses the same services as manual entry."""

    type: str  # acknowledgment | revised_date | ship_notice | tracking_update
    po_line_id: str | None = None
    shipment_id: str | None = None
    date: dt.date | None = None
    qty: int | None = None
    carrier: str | None = None
    tracking_number: str | None = None
    status: str | None = None


class ScenarioApply(QtyOp):
    close_issue_ids: list[str] = []


class HoldRelease(BaseModel):
    allocation_id: str
    qty: int | None = Field(default=None, gt=0)


class TransferChoice(BaseModel):
    allocation_id: str | None = None
    work_order_item_id: str | None = None
    inventory_record_id: str | None = None
    qty: int | None = Field(default=None, gt=0)
    expected_arrival: dt.date | None = None


class AssignmentChoice(BaseModel):
    work_order_item_id: str
    source_type: str
    source_id: str
    qty: int = Field(gt=0)


class PurchaseChoice(BaseModel):
    supplier_id: str | None = None
    expected_arrival: dt.date | None = None
    general_stock: int = Field(default=0, ge=0)
    allocations: list[POAllocationIn] = []


class SourcingApply(QtyOp):
    """One confirmed Source material decision for a part at one destination."""

    part_id: str
    warehouse_id: str
    release_holds: list[HoldRelease] = []
    transfers: list[TransferChoice] = []
    assignments: list[AssignmentChoice] = []
    purchase: PurchaseChoice | None = None


class ArrivalChange(BaseModel):
    target_type: str
    target_id: str
    expected_arrival: dt.date | None
    basis: str = "supplier_promise"


class NextCheckIn(BaseModel):
    due_date: dt.date
    note: str | None = None


class SupplierUpdate(Op):
    note: str = Field(min_length=1)
    arrivals: list[ArrivalChange] = []
    complete_checkin_ids: list[str] = []
    next_checkin: NextCheckIn | None = None
    mark_reviewed: bool = False
