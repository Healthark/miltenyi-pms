"""add_goal_self_review

Adds the columns needed to capture an employee's self-review on an
approved yearly goal.  Once the mentor approves the goal, the "Approved"
action in the Yearly Goals table is replaced by a "Self Review" button
that opens a form covering 8 competencies.

Columns added to `goals`:
    self_review_submitted_at        — timestamp the self-review was submitted
    self_desc_task_execution        — free-text response for competency #1
    self_desc_ownership             — #2
    self_desc_client_deliverables   — #3
    self_desc_communication         — #4
    self_desc_project_management    — #5
    self_desc_mentoring             — #6
    self_desc_firm_growth           — #7
    self_desc_competency_skills     — #8

The one-way `self_review_submitted_at` flag is the single source of truth
for whether a self-review has been submitted — the frontend uses it to
flip the action cell between "Self Review" and "Requested".

Revision ID: c7f1a5b92e04
Revises: b4e2f7a9d013
Create Date: 2026-04-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7f1a5b92e04"
down_revision: Union[str, None] = "b4e2f7a9d013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SELF_DESC_COLUMNS = (
    "self_desc_task_execution",
    "self_desc_ownership",
    "self_desc_client_deliverables",
    "self_desc_communication",
    "self_desc_project_management",
    "self_desc_mentoring",
    "self_desc_firm_growth",
    "self_desc_competency_skills",
)


def upgrade() -> None:
    with op.batch_alter_table("goals") as batch_op:
        batch_op.add_column(
            sa.Column(
                "self_review_submitted_at",
                sa.DateTime(timezone=True),
                nullable=True,
            )
        )
        for col in SELF_DESC_COLUMNS:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("goals") as batch_op:
        for col in SELF_DESC_COLUMNS:
            batch_op.drop_column(col)
        batch_op.drop_column("self_review_submitted_at")
