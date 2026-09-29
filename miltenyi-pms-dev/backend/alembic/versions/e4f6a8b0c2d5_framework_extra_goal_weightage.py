"""the "Additional goals" weightage moves onto each framework row

Revision ID: e4f6a8b0c2d5
Revises: d3e5f7a9b2c4
Create Date: 2026-09-29

Zaahid (29 Sep 2026): one weightage per goal year made every sheet total
110 (KPIs 100 + additional 10). Each framework column (function × level)
now carries its own "Additional goals" weightage, edited in the Framework
tab next to the KPIs, and KPIs + additional must total 100. The per-year
switch stays as the on/off; the old per-year weightage column is left in
place, unused.

Backfill: every framework row takes its year's former weightage (10 by
default) so existing sheets keep the number they show today.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e4f6a8b0c2d5"
down_revision = "d3e5f7a9b2c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("goal_frameworks") as batch_op:
        batch_op.add_column(sa.Column("extra_goal_weightage", sa.Integer(), nullable=False, server_default="10"))
    op.execute(
        "UPDATE goal_frameworks SET extra_goal_weightage = COALESCE("
        "(SELECT p.extra_goal_weightage FROM project_goal_period_settings p "
        " WHERE p.org_id = goal_frameworks.org_id AND p.period_label = goal_frameworks.period_label), 10)"
    )


def downgrade() -> None:
    with op.batch_alter_table("goal_frameworks") as batch_op:
        batch_op.drop_column("extra_goal_weightage")
