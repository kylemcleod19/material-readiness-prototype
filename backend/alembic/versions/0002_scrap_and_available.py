"""Rejected QA quantity is scrapped (no hold / use-as-is); scenario 'usable' becomes 'available'.

Revision ID: 0002_scrap_and_available
Revises: c62f3b211f21
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_scrap_and_available"
down_revision: Union[str, None] = "c62f3b211f21"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("inv_quality", "inventory_records", type_="check")
    op.execute("UPDATE inventory_records SET quality_state = 'scrapped', location = 'SCRAP', pool_po_line_id = NULL "
               "WHERE quality_state = 'hold'")
    op.create_check_constraint("inv_quality", "inventory_records", "quality_state IN ('pending','accepted','scrapped')")
    op.drop_column("inventory_records", "released_as_is")
    op.drop_column("inventory_records", "release_note")

    op.drop_constraint("scenario_alloc_nonneg", "scenario_allocations", type_="check")
    op.alter_column("scenario_allocations", "usable_qty", new_column_name="available_qty")
    op.create_check_constraint("scenario_alloc_nonneg", "scenario_allocations", "available_qty >= 0 AND incoming_qty >= 0")


def downgrade() -> None:
    op.drop_constraint("scenario_alloc_nonneg", "scenario_allocations", type_="check")
    op.alter_column("scenario_allocations", "available_qty", new_column_name="usable_qty")
    op.create_check_constraint("scenario_alloc_nonneg", "scenario_allocations", "usable_qty >= 0 AND incoming_qty >= 0")

    op.add_column("inventory_records", sa.Column("release_note", sa.Text(), nullable=True))
    op.add_column("inventory_records", sa.Column("released_as_is", sa.Boolean(), nullable=True))
    op.drop_constraint("inv_quality", "inventory_records", type_="check")
    op.execute("UPDATE inventory_records SET quality_state = 'hold' WHERE quality_state = 'scrapped'")
    op.create_check_constraint("inv_quality", "inventory_records", "quality_state IN ('pending','accepted','hold')")
