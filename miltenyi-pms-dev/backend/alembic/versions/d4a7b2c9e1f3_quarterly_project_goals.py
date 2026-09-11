"""quarterly project goals: yearly goals, one review per quarter

Revision ID: d4a7b2c9e1f3
Revises: c8e2f4b6d9a1
Create Date: 2026-09-10

Stakeholder decision (10 Sep 2026): goals are set once a year; reviews
happen every quarter against the same goals; the quarter is rolled out by
the Admin and is itself the review window; ratings are released per quarter.

* `project_goal_quarters` (new): one row per started quarter of a period,
  with the per-quarter "ratings visible" switch.
* `project_goal_cycle_logs` (new): audit trail of roll-outs / manual sets.
* `project_goal_period_settings`: + `current_quarter_seq`;
  - `self_review_open`, `ratings_visible` (the quarter replaces both).
* `project_goal_sets`: the status list shrinks to draft/submitted/approved
  (review states move to the review rows); - `acknowledged_at`.
* `project_goal_reviews`: + `acknowledged_at` (copied from the set).
* `project_goal_change_logs`: + `cycle_label`.

Existing data: every active period is placed on the calendar quarter of the
migration date (September 2026 → Q3), quarter rows 1..Q3 are created, the
single "CY 2026" review of each set becomes that quarter's review.
"""
from datetime import date

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "d4a7b2c9e1f3"
down_revision = "c8e2f4b6d9a1"
branch_labels = None
depends_on = None


def _current_quarter_seq() -> int:
    return (date.today().month - 1) // 3 + 1


def upgrade() -> None:
    conn = op.get_bind()

    op.create_table(
        "project_goal_quarters",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("period_label", sa.String(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("cycle_label", sa.String(), nullable=False),
        sa.Column("ratings_visible", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("opened_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("opened_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.UniqueConstraint("org_id", "period_label", "seq", name="uix_project_goal_quarter"),
    )
    op.create_index("ix_project_goal_quarters_id", "project_goal_quarters", ["id"])

    op.create_table(
        "project_goal_cycle_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("from_label", sa.String(), nullable=True),
        sa.Column("to_label", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_project_goal_cycle_logs_id", "project_goal_cycle_logs", ["id"])

    with op.batch_alter_table("project_goal_period_settings") as batch:
        batch.add_column(sa.Column("current_quarter_seq", sa.Integer(), nullable=True))
    with op.batch_alter_table("project_goal_reviews") as batch:
        batch.add_column(sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table("project_goal_change_logs") as batch:
        batch.add_column(sa.Column("cycle_label", sa.String(), nullable=True))

    # ── data ─────────────────────────────────────────────────────────
    periods = sa.table(
        "project_goal_period_settings",
        sa.column("id", sa.Integer), sa.column("org_id", sa.Integer), sa.column("period_label", sa.String),
        sa.column("is_active", sa.Boolean), sa.column("ratings_visible", sa.Boolean),
        sa.column("updated_by_id", sa.Integer), sa.column("current_quarter_seq", sa.Integer),
    )
    quarters = sa.table(
        "project_goal_quarters",
        sa.column("org_id", sa.Integer), sa.column("period_label", sa.String), sa.column("seq", sa.Integer),
        sa.column("cycle_label", sa.String), sa.column("ratings_visible", sa.Boolean), sa.column("opened_by_id", sa.Integer),
    )
    sets = sa.table(
        "project_goal_sets",
        sa.column("id", sa.Integer), sa.column("org_id", sa.Integer), sa.column("period_label", sa.String),
        sa.column("status", sa.String), sa.column("acknowledged_at", sa.DateTime(timezone=True)),
    )
    reviews = sa.table(
        "project_goal_reviews",
        sa.column("id", sa.Integer), sa.column("set_id", sa.Integer), sa.column("cycle_label", sa.String),
        sa.column("acknowledged_at", sa.DateTime(timezone=True)),
    )

    q = _current_quarter_seq()
    for p in conn.execute(sa.select(periods)).mappings():
        if not p["is_active"]:
            continue
        conn.execute(periods.update().where(periods.c.id == p["id"]).values(current_quarter_seq=q))
        for seq in range(1, q + 1):
            conn.execute(quarters.insert().values(
                org_id=p["org_id"], period_label=p["period_label"], seq=seq,
                cycle_label=f"Q{seq} {p['period_label']}",
                ratings_visible=bool(p["ratings_visible"]) if seq == q else False,
                opened_by_id=p["updated_by_id"],
            ))
        # The single yearly review of each set becomes the current quarter's review.
        for s in conn.execute(sa.select(sets).where(sets.c.org_id == p["org_id"], sets.c.period_label == p["period_label"])).mappings():
            conn.execute(
                reviews.update()
                .where(reviews.c.set_id == s["id"], reviews.c.cycle_label == p["period_label"])
                .values(cycle_label=f"Q{q} {p['period_label']}", acknowledged_at=s["acknowledged_at"])
            )

    conn.execute(sets.update().where(sets.c.status.in_(["self_reviewed", "reviewed"])).values(status="approved"))

    with op.batch_alter_table("project_goal_period_settings") as batch:
        batch.drop_column("self_review_open")
        batch.drop_column("ratings_visible")
    with op.batch_alter_table("project_goal_sets") as batch:
        batch.drop_column("acknowledged_at")


def downgrade() -> None:
    conn = op.get_bind()
    with op.batch_alter_table("project_goal_sets") as batch:
        batch.add_column(sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True))
    with op.batch_alter_table("project_goal_period_settings") as batch:
        batch.add_column(sa.Column("self_review_open", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("ratings_visible", sa.Boolean(), nullable=False, server_default=sa.false()))

    # Best effort: the current quarter's review becomes the yearly review again;
    # other quarters keep their labels (the old model had no place for them).
    periods = sa.table(
        "project_goal_period_settings",
        sa.column("id", sa.Integer), sa.column("org_id", sa.Integer), sa.column("period_label", sa.String),
        sa.column("current_quarter_seq", sa.Integer),
    )
    sets = sa.table("project_goal_sets", sa.column("id", sa.Integer), sa.column("org_id", sa.Integer),
                    sa.column("period_label", sa.String), sa.column("status", sa.String),
                    sa.column("acknowledged_at", sa.DateTime(timezone=True)))
    reviews = sa.table("project_goal_reviews", sa.column("id", sa.Integer), sa.column("set_id", sa.Integer),
                       sa.column("cycle_label", sa.String), sa.column("self_is_draft", sa.Boolean),
                       sa.column("review_is_draft", sa.Boolean), sa.column("acknowledged_at", sa.DateTime(timezone=True)))
    for p in conn.execute(sa.select(periods)).mappings():
        seq = p["current_quarter_seq"]
        if not seq:
            continue
        label = f"Q{seq} {p['period_label']}"
        for s in conn.execute(sa.select(sets).where(sets.c.org_id == p["org_id"], sets.c.period_label == p["period_label"])).mappings():
            r = conn.execute(sa.select(reviews).where(reviews.c.set_id == s["id"], reviews.c.cycle_label == label)).mappings().first()
            if r is None:
                continue
            conn.execute(reviews.update().where(reviews.c.id == r["id"]).values(cycle_label=p["period_label"]))
            new_status = "reviewed" if not r["review_is_draft"] else ("self_reviewed" if not r["self_is_draft"] else None)
            values = {"acknowledged_at": r["acknowledged_at"]}
            if new_status and s["status"] == "approved":
                values["status"] = new_status
            conn.execute(sets.update().where(sets.c.id == s["id"]).values(**values))

    with op.batch_alter_table("project_goal_change_logs") as batch:
        batch.drop_column("cycle_label")
    with op.batch_alter_table("project_goal_reviews") as batch:
        batch.drop_column("acknowledged_at")
    with op.batch_alter_table("project_goal_period_settings") as batch:
        batch.drop_column("current_quarter_seq")
    op.drop_index("ix_project_goal_cycle_logs_id", table_name="project_goal_cycle_logs")
    op.drop_table("project_goal_cycle_logs")
    op.drop_index("ix_project_goal_quarters_id", table_name="project_goal_quarters")
    op.drop_table("project_goal_quarters")
