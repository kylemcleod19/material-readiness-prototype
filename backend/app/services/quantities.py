"""Pure quantity and timing rules shared by live views, scenario preview, and services.

Nothing here touches the database, so the same rules apply whether inputs come from a
locked transaction or an in-memory snapshot.
"""
from dataclasses import dataclass, field
from datetime import date


@dataclass
class Bucket:
    """A slice of a PO line's remaining supply with one expected arrival."""

    qty: int
    eta: date | None
    arrived: bool = False
    label: str = ""
    # Physical stage: unshipped | in_transit | awaiting_receipt (at the dock) | awaiting_qa | received
    stage: str = "unshipped"
    shipment_id: str | None = None


@dataclass
class LineQuantities:
    ordered: int
    canceled: int
    shortfall: int
    received: int
    outstanding: int  # not yet received: unshipped + in transit
    in_transit: int
    unshipped: int
    pooled_pending: int  # received, awaiting QA, still backing this line's claims
    pooled_accepted: int  # accepted, awaiting handoff to specific claims
    claims: int  # active allocations sourced from the line
    buckets: list[Bucket] = field(default_factory=list)

    @property
    def incoming(self) -> int:
        """Units the line can still deliver to claims, excluding accepted units awaiting handoff."""
        return self.outstanding + self.pooled_pending

    @property
    def supply(self) -> int:
        return self.outstanding + self.pooled_pending + self.pooled_accepted

    @property
    def unallocated(self) -> int:
        return max(0, self.supply - self.claims)

    @property
    def deficit(self) -> int:
        return max(0, self.claims - self.supply)


def line_quantities(
    *,
    ordered: int,
    canceled: int,
    shortfall: int,
    expected_arrival: date | None,
    received: int,
    open_shipments: list[tuple[int, date | None, str, str | None, bool]],
    pooled: list[tuple[int, str]],
    claims: int,
    include_pool: bool = True,
) -> LineQuantities:
    """Reconcile ordered - canceled - shortfall into disjoint unshipped / in-transit / received.

    open_shipments: (qty shipped but not yet received, expected arrival, label, shipment id, at the dock).
    pooled: (qty, quality_state) of received records still pooled to the line.
    """
    outstanding = max(0, ordered - canceled - shortfall - received)
    buckets: list[Bucket] = []
    in_transit = 0
    for qty_open, eta, label, shipment_id, at_dock in open_shipments:
        q = min(qty_open, outstanding - in_transit)
        if q > 0:
            # Material at the dock has physically arrived: an old ETA can no longer make it late.
            buckets.append(Bucket(q, eta, at_dock, label, "awaiting_receipt" if at_dock else "in_transit", shipment_id))
            in_transit += q
    unshipped = outstanding - in_transit
    if unshipped > 0:
        buckets.append(Bucket(unshipped, expected_arrival, False, "unshipped", "unshipped"))
    pooled_pending = sum(q for q, s in pooled if s == "pending") if include_pool else 0
    pooled_accepted = sum(q for q, s in pooled if s == "accepted") if include_pool else 0
    if pooled_pending:
        buckets.append(Bucket(pooled_pending, None, True, "in QA", "awaiting_qa"))
    if pooled_accepted:
        buckets.append(Bucket(pooled_accepted, None, True, "received", "received"))
    return LineQuantities(
        ordered=ordered,
        canceled=canceled,
        shortfall=shortfall,
        received=received,
        outstanding=outstanding,
        in_transit=in_transit,
        unshipped=unshipped,
        pooled_pending=pooled_pending,
        pooled_accepted=pooled_accepted,
        claims=claims,
        buckets=buckets,
    )


# Timing statuses, worst last.
TIMING_ORDER = ["none", "on_time", "unknown", "timing_review", "late"]


def worst_timing(statuses) -> str:
    worst = "none"
    for s in statuses:
        if TIMING_ORDER.index(s) > TIMING_ORDER.index(worst):
            worst = s
    return worst


def claim_timing(claims: list[tuple[str, int, date]], buckets: list[Bucket]) -> dict[str, tuple[str, int]]:
    """Compare a shared line's arrival buckets to each claim's production start.

    Without deciding which shipment serves which order, a claim has no known conflict when
    all claims starting on or before its start fit inside supply expected by then. If no
    dated supply arrives in time it is late; a partial fit is a shared timing review rather
    than an invented order-level ETA. Arrival on time is not a promise of staging on time.

    claims: (key, qty, production_start). Returns key -> (status, late_qty).
    """
    result: dict[str, tuple[str, int]] = {}
    for key, qty, start in claims:
        due = sum(q for _, q, s in claims if s <= start)
        on_time = sum(b.qty for b in buckets if b.arrived or (b.eta is not None and b.eta <= start))
        unknown = sum(b.qty for b in buckets if not b.arrived and b.eta is None)
        if due <= on_time:
            result[key] = ("on_time", 0)
        elif due <= on_time + unknown:
            result[key] = ("unknown", 0)
        elif on_time == 0 and unknown == 0:
            result[key] = ("late", qty)
        else:
            result[key] = ("timing_review", min(qty, due - on_time - unknown))
    return result


def single_timing(eta: date | None, start: date) -> str:
    if eta is None:
        return "unknown"
    return "on_time" if eta <= start else "late"
