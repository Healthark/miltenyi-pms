"""personal frameworks: one staff member's own Project Goals framework

Revision ID: f5a7c9e1b3d6
Revises: e4f6a8b0c2d5
Create Date: 2026-10-16

Zaahid (16 Oct 2026): the Admin can override one staff member's framework
for a goal year (title, the two paragraphs, KPI texts and weightages, the
Additional goals %), taking effect on that person's sheet at once. A personal
framework is a `goal_frameworks` row with `user_id` set; role columns keep
`user_id` NULL. See docs/plans/2026-10-16-personal-frameworks-plan.md.

* `goal_frameworks.user_id`      the person (NULL = a role column)
* `goal_frameworks.based_on_id`  the role column it was customised from
* the unique rule (org, function, level, year) now covers role columns only;
  a second partial unique index allows one personal row per person per year.

Additive: every existing row is a role column and keeps its meaning.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f5a7c9e1b3d6"
down_revision = "e4f6a8b0c2d5"
branch_labels = None
depends_on = None

ROLE_COLUMNS = ["org_id", "function_id", "level", "period_label"]


def upgrade() -> None:
    with op.batch_alter_table("goal_frameworks") as batch:
        batch.add_column(sa.Column("user_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("based_on_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_goal_frameworks_user_id", "users", ["user_id"], ["id"])
        batch.create_foreign_key("fk_goal_frameworks_based_on_id", "goal_frameworks", ["based_on_id"], ["id"], ondelete="SET NULL")
        batch.drop_constraint("uix_goal_framework_row", type_="unique")
    op.create_index("ix_goal_frameworks_user_id", "goal_frameworks", ["user_id"], unique=False)
    op.create_index(
        "uix_goal_framework_row", "goal_frameworks", ROLE_COLUMNS, unique=True,
        postgresql_where=sa.text("user_id IS NULL"), sqlite_where=sa.text("user_id IS NULL"),
    )
    op.create_index(
        "uix_goal_framework_personal", "goal_frameworks", ["org_id", "user_id", "period_label"], unique=True,
        postgresql_where=sa.text("user_id IS NOT NULL"), sqlite_where=sa.text("user_id IS NOT NULL"),
    )


def downgrade() -> None:
    # Personal rows cannot live under the old one-row-per-role rule. Sheets
    # keep their goal rows (KPI text and weight are copied onto them); sets
    # built on a personal row point back at their role column first.
    op.execute(
        "UPDATE project_goal_items SET kpi_id = NULL WHERE kpi_id IN ("
        " SELECT k.id FROM goal_framework_kpis k JOIN goal_frameworks f ON f.id = k.framework_id"
        " WHERE f.user_id IS NOT NULL)"
    )
    op.execute(
        "UPDATE project_goal_sets SET framework_id = ("
        " SELECT c.id FROM goal_frameworks p JOIN goal_frameworks c"
        "   ON c.org_id = p.org_id AND c.function_id = p.function_id AND c.level = p.level"
        "  AND c.period_label = p.period_label AND c.user_id IS NULL"
        " WHERE p.id = project_goal_sets.framework_id)"
        " WHERE framework_id IN (SELECT id FROM goal_frameworks WHERE user_id IS NOT NULL)"
    )
    op.execute("DELETE FROM goal_framework_kpis WHERE framework_id IN (SELECT id FROM goal_frameworks WHERE user_id IS NOT NULL)")
    op.execute("DELETE FROM goal_frameworks WHERE user_id IS NOT NULL")

    op.drop_index("uix_goal_framework_personal", table_name="goal_frameworks")
    op.drop_index("uix_goal_framework_row", table_name="goal_frameworks")
    op.drop_index("ix_goal_frameworks_user_id", table_name="goal_frameworks")
    with op.batch_alter_table("goal_frameworks") as batch:
        batch.create_unique_constraint("uix_goal_framework_row", ROLE_COLUMNS)
        batch.drop_constraint("fk_goal_frameworks_based_on_id", type_="foreignkey")
        batch.drop_constraint("fk_goal_frameworks_user_id", type_="foreignkey")
        batch.drop_column("based_on_id")
        batch.drop_column("user_id")
