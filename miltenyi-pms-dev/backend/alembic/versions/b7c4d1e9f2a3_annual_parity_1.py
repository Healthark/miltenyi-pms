"""annual goals & reviews parity, part 1

Revision ID: b7c4d1e9f2a3
Revises: a2e7c5d9b4f1
Create Date: 2026-09-25

Decisions from the Healthark-vs-Miltenyi audit of 24 Sep 2026 (Zaahid):

* goals.is_deleted — goals are soft-deleted so their review history
  survives; every ORM query hides deleted rows (see app/core/database.py).
* goal_mentor_reviews.mentor_id — who actually wrote the review, so a
  review written by a previous mentor or an Admin keeps the right name.
  Backfilled from the goal's mentor of record.
* system_settings_year_overrides.goal_reviews_visible_h1 / _h2 — per-year,
  per-half switches: the mentee sees the mentor's goal review for that half
  only once the Admin publishes it. Existing years keep today's behaviour
  (visible); new years start hidden.
* system_settings_year_overrides.management_review_enabled — the
  Management Review (calibration) window, separate from "annual reviews
  open". Existing years inherit their annual_reviews_enabled value.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b7c4d1e9f2a3"
down_revision = "a2e7c5d9b4f1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("goals") as batch:
        batch.add_column(sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()))

    with op.batch_alter_table("goal_mentor_reviews") as batch:
        batch.add_column(sa.Column("mentor_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_goal_mentor_reviews_mentor_id_users", "users", ["mentor_id"], ["id"])
        batch.create_index("ix_goal_mentor_reviews_mentor_id", ["mentor_id"])

    with op.batch_alter_table("system_settings_year_overrides") as batch:
        batch.add_column(sa.Column("goal_reviews_visible_h1", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("goal_reviews_visible_h2", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("management_review_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Existing reviews: the goal's mentor of record is the best available author.
    op.execute(sa.text(
        "UPDATE goal_mentor_reviews SET mentor_id = "
        "(SELECT manager_id FROM goals WHERE goals.id = goal_mentor_reviews.goal_id)"
    ))
    # Years that already exist keep today's behaviour: goal reviews visible,
    # calibration open wherever annual reviews are open.
    yo = sa.table(
        "system_settings_year_overrides",
        sa.column("annual_reviews_enabled", sa.Boolean),
        sa.column("goal_reviews_visible_h1", sa.Boolean),
        sa.column("goal_reviews_visible_h2", sa.Boolean),
        sa.column("management_review_enabled", sa.Boolean),
    )
    op.execute(
        yo.update().values(
            goal_reviews_visible_h1=sa.true(),
            goal_reviews_visible_h2=sa.true(),
            management_review_enabled=yo.c.annual_reviews_enabled,
        )
    )


def downgrade() -> None:
    with op.batch_alter_table("system_settings_year_overrides") as batch:
        batch.drop_column("management_review_enabled")
        batch.drop_column("goal_reviews_visible_h2")
        batch.drop_column("goal_reviews_visible_h1")
    with op.batch_alter_table("goal_mentor_reviews") as batch:
        batch.drop_index("ix_goal_mentor_reviews_mentor_id")
        batch.drop_constraint("fk_goal_mentor_reviews_mentor_id_users", type_="foreignkey")
        batch.drop_column("mentor_id")
    conn = op.get_bind()
    goals = sa.table("goals", sa.column("id", sa.Integer), sa.column("is_deleted", sa.Boolean))
    conn.execute(goals.delete().where(goals.c.is_deleted.is_(True)))
    with op.batch_alter_table("goals") as batch:
        batch.drop_column("is_deleted")
