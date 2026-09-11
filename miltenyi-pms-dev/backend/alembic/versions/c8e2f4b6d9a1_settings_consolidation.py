"""settings consolidation: one home per switch

Revision ID: c8e2f4b6d9a1
Revises: b3d9f1a7c2e4
Create Date: 2026-09-10

System Settings audit (docs/plans/2026-09-10-admin-panel-and-role-audit.md):

* `system_settings` loses the columns nothing reads any more —
  `cycle_start_date`, `cycle_end_date`, `goals_submission_open`,
  `goals_edit_enabled`, `reviews_submission_open` — and the org-wide
  copies of the per-fiscal-year toggles (`annual_goals_edit_enabled`,
  `annual_reviews_enabled`, `annual_review_final_rating_visible`,
  `project_ratings_visible`). Those toggles have lived on
  `system_settings_year_overrides` since the per-FY change; the copies
  here were only written by a rollover reset and used once as a seed.
* `system_settings_year_overrides.project_ratings_visible` goes: it
  belonged to the retired per-project reviews.
* `cycle_type` is normalised to `half_yearly` — the quarterly cadence
  only ever served project reviews.

Before dropping, any org whose active fiscal year has no override row
gets one seeded from its legacy org-wide values, so nothing an admin had
switched on is lost.
"""
import re

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c8e2f4b6d9a1"
down_revision = "b3d9f1a7c2e4"
branch_labels = None
depends_on = None


_DROPPED_SETTINGS_COLUMNS = (
    "cycle_start_date",
    "cycle_end_date",
    "goals_submission_open",
    "reviews_submission_open",
    "goals_edit_enabled",
    "annual_goals_edit_enabled",
    "project_ratings_visible",
    "annual_reviews_enabled",
    "annual_review_final_rating_visible",
)

_FY_PATTERN = re.compile(r"FY\d{2}-\d{2}")


def _backfill_year_overrides(conn) -> None:
    settings = sa.table(
        "system_settings",
        sa.column("org_id", sa.Integer),
        sa.column("active_cycle_name", sa.String),
        sa.column("annual_reviews_enabled", sa.Boolean),
        sa.column("annual_review_final_rating_visible", sa.Boolean),
        sa.column("annual_goals_edit_enabled", sa.Boolean),
        sa.column("updated_by_id", sa.Integer),
    )
    overrides = sa.table(
        "system_settings_year_overrides",
        sa.column("org_id", sa.Integer),
        sa.column("fy_label", sa.String),
        sa.column("annual_reviews_enabled", sa.Boolean),
        sa.column("annual_review_final_rating_visible", sa.Boolean),
        sa.column("annual_goals_edit_enabled", sa.Boolean),
        sa.column("updated_by_id", sa.Integer),
    )
    for row in conn.execute(sa.select(settings)).mappings():
        match = _FY_PATTERN.search(row["active_cycle_name"] or "")
        if not match:
            continue
        fy_label = match.group(0)
        exists = conn.execute(
            sa.select(sa.func.count()).select_from(overrides).where(
                overrides.c.org_id == row["org_id"],
                overrides.c.fy_label == fy_label,
            )
        ).scalar()
        if exists:
            continue
        conn.execute(
            overrides.insert().values(
                org_id=row["org_id"],
                fy_label=fy_label,
                annual_reviews_enabled=bool(row["annual_reviews_enabled"]),
                annual_review_final_rating_visible=bool(row["annual_review_final_rating_visible"]),
                annual_goals_edit_enabled=bool(row["annual_goals_edit_enabled"]),
                updated_by_id=row["updated_by_id"],
            )
        )


def upgrade() -> None:
    conn = op.get_bind()
    _backfill_year_overrides(conn)

    settings = sa.table("system_settings", sa.column("cycle_type", sa.String))
    conn.execute(
        settings.update()
        .where(settings.c.cycle_type != "half_yearly")
        .values(cycle_type="half_yearly")
    )

    with op.batch_alter_table("system_settings") as batch:
        for name in _DROPPED_SETTINGS_COLUMNS:
            batch.drop_column(name)

    with op.batch_alter_table("system_settings_year_overrides") as batch:
        batch.drop_column("project_ratings_visible")


def downgrade() -> None:
    with op.batch_alter_table("system_settings_year_overrides") as batch:
        batch.add_column(
            sa.Column("project_ratings_visible", sa.Boolean(), nullable=False, server_default=sa.false())
        )

    with op.batch_alter_table("system_settings") as batch:
        batch.add_column(sa.Column("cycle_start_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("cycle_end_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("goals_submission_open", sa.Boolean(), nullable=True, server_default=sa.false()))
        batch.add_column(sa.Column("reviews_submission_open", sa.Boolean(), nullable=True, server_default=sa.false()))
        batch.add_column(sa.Column("goals_edit_enabled", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.add_column(sa.Column("annual_goals_edit_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("project_ratings_visible", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("annual_reviews_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("annual_review_final_rating_visible", sa.Boolean(), nullable=False, server_default=sa.false()))
    # The cadence is not restored: the quarterly value only mattered to the
    # retired project-review module.
