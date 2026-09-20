"""goal years as CY spans, backfill switch per year, drop the H1/H2 bypass

Revision ID: e5b8c3d0f2a7
Revises: d4a7b2c9e1f3
Create Date: 2026-09-20

UAT feedback (Zaahid, 17–20 Sep 2026):

* Goal years are labelled as spans — "CY 26-27", "CY 27-28" — because the
  year ends around April. Every stored "CY 2026" label becomes "CY 26-27"
  (period settings, quarters, framework rows, sets, review and change-log
  cycle labels, roll-out log).
* `project_goal_period_settings.backfill_open` (new, default true): after
  the year rolls over, the previous year's quarters stay writable until the
  Admin turns this off — mirrors the Healthark PMS, where a past fiscal year
  stays open after the system has advanced.
* `system_settings.cycle_window_override` (the H1/H2 review-window bypass)
  is removed: the calendar gate always applies; testers move the quarter or
  the simulated date instead.
"""
import re

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e5b8c3d0f2a7"
down_revision = "d4a7b2c9e1f3"
branch_labels = None
depends_on = None


_FOUR_DIGIT = re.compile(r"\bCY (\d{4})\b")
_SPAN = re.compile(r"\bCY (\d{2})-(\d{2})\b")

# (table, [label columns])
_LABEL_COLUMNS = [
    ("project_goal_period_settings", ["period_label"]),
    ("project_goal_quarters", ["period_label", "cycle_label"]),
    ("goal_frameworks", ["period_label"]),
    ("project_goal_sets", ["period_label"]),
    ("project_goal_reviews", ["cycle_label"]),
    ("project_goal_change_logs", ["cycle_label"]),
    ("project_goal_cycle_logs", ["from_label", "to_label"]),
]


def _to_span(label):
    """"CY 2026" -> "CY 26-27" (inside any label, e.g. "Q3 CY 2026")."""
    if not label:
        return label
    return _FOUR_DIGIT.sub(lambda m: f"CY {int(m.group(1)) % 100:02d}-{(int(m.group(1)) + 1) % 100:02d}", label)


def _to_year(label):
    """"CY 26-27" -> "CY 2026"."""
    if not label:
        return label
    return _SPAN.sub(lambda m: f"CY {2000 + int(m.group(1))}", label)


def _relabel(conn, convert):
    for table, columns in _LABEL_COLUMNS:
        t = sa.table(table, sa.column("id", sa.Integer), *[sa.column(c, sa.String) for c in columns])
        for row in conn.execute(sa.select(t)).mappings():
            values = {}
            for c in columns:
                new = convert(row[c])
                if new != row[c]:
                    values[c] = new
            if values:
                conn.execute(t.update().where(t.c.id == row["id"]).values(**values))


def upgrade() -> None:
    conn = op.get_bind()
    with op.batch_alter_table("project_goal_period_settings") as batch:
        batch.add_column(sa.Column("backfill_open", sa.Boolean(), nullable=False, server_default=sa.true()))
    with op.batch_alter_table("system_settings") as batch:
        batch.drop_column("cycle_window_override")
    _relabel(conn, _to_span)


def downgrade() -> None:
    conn = op.get_bind()
    _relabel(conn, _to_year)
    with op.batch_alter_table("system_settings") as batch:
        batch.add_column(sa.Column("cycle_window_override", sa.Boolean(), nullable=False, server_default="false"))
    with op.batch_alter_table("project_goal_period_settings") as batch:
        batch.drop_column("backfill_open")
