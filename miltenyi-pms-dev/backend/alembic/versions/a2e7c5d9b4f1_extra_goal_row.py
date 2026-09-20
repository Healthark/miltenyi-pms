"""additional-goals row on the goal sheet

Revision ID: a2e7c5d9b4f1
Revises: f1d9a4c7e2b3
Create Date: 2026-09-20

HR requirement (via Zaahid, 20 Sep 2026): one extra free-text row at the end
of the goal-setting sheet where staff write any additional goals they are
working on; the Admin sets its weightage (one value per goal year).

* `project_goal_period_settings.extra_goal_enabled` / `extra_goal_weightage`
* `project_goal_items.is_extra` — the snapshotted extra row of a set
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a2e7c5d9b4f1"
down_revision = "f1d9a4c7e2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("project_goal_period_settings") as batch:
        batch.add_column(sa.Column("extra_goal_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("extra_goal_weightage", sa.Integer(), nullable=False, server_default="10"))
    with op.batch_alter_table("project_goal_items") as batch:
        batch.add_column(sa.Column("is_extra", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    conn = op.get_bind()
    items = sa.table("project_goal_items", sa.column("id", sa.Integer), sa.column("is_extra", sa.Boolean))
    conn.execute(items.delete().where(items.c.is_extra.is_(True)))
    with op.batch_alter_table("project_goal_items") as batch:
        batch.drop_column("is_extra")
    with op.batch_alter_table("project_goal_period_settings") as batch:
        batch.drop_column("extra_goal_weightage")
        batch.drop_column("extra_goal_enabled")
