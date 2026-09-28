"""drop the Project Goals review acknowledgement

Revision ID: d3e5f7a9b2c4
Revises: c8d2e4f6a1b7
Create Date: 2026-09-28

Zaahid (28 Sep 2026): the staff read receipt on a quarterly review ("Acknowledge
Q3 review") has no use. The endpoint, the button, the queue filter, the
dashboard bucket and the digest line are gone; this drops the column.
Change-log rows with action "acknowledge" are kept as history.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d3e5f7a9b2c4"
down_revision = "c8d2e4f6a1b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("project_goal_reviews") as batch_op:
        batch_op.drop_column("acknowledged_at")


def downgrade() -> None:
    with op.batch_alter_table("project_goal_reviews") as batch_op:
        batch_op.add_column(sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True))
