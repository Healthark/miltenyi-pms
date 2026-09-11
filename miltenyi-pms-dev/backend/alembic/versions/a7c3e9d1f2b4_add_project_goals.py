"""add_project_goals

Project Goals module (docs/plans/2026-09-09-project-goals-implementation-plan.md):
the Miltenyi "Indicative Goal Themes" framework rows with their weighted KPIs,
one goal set per employee per period with per-KPI items, the per-cycle review
(self review + Miltenyi comments entered by the mentor), an append-only change
log, per-period HR switches, and `users.miltenyi_reviewer_name`.

Additive only. The existing goals / project_reviews / role_expectations tables
are untouched.

Revision ID: a7c3e9d1f2b4
Revises: c5e8d27a91f6
Create Date: 2026-09-09
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7c3e9d1f2b4"
down_revision: Union[str, None] = "c5e8d27a91f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "goal_frameworks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("function_id", sa.Integer(), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("period_label", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("business_outcomes", sa.Text(), nullable=False),
        sa.Column("functional_goals", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["function_id"], ["functions.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "function_id", "level", "period_label", name="uix_goal_framework_row"),
    )
    op.create_index(op.f("ix_goal_frameworks_id"), "goal_frameworks", ["id"], unique=False)

    op.create_table(
        "goal_framework_kpis",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("framework_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("weightage", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["framework_id"], ["goal_frameworks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("framework_id", "seq", name="uix_goal_framework_kpi_seq"),
    )
    op.create_index(op.f("ix_goal_framework_kpis_id"), "goal_framework_kpis", ["id"], unique=False)

    op.create_table(
        "project_goal_sets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("period_label", sa.String(), nullable=False),
        sa.Column("framework_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_id", sa.Integer(), nullable=True),
        sa.Column("approved_agreed_with", sa.String(), nullable=True),
        sa.Column("approved_agreed_on", sa.Date(), nullable=True),
        sa.Column("approval_note", sa.Text(), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["framework_id"], ["goal_frameworks.id"]),
        sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "user_id", "period_label", name="uix_project_goal_set_user_period"),
    )
    op.create_index(op.f("ix_project_goal_sets_id"), "project_goal_sets", ["id"], unique=False)

    op.create_table(
        "project_goal_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=True),
        sa.Column("kpi_text", sa.Text(), nullable=False),
        sa.Column("weightage", sa.Integer(), nullable=False),
        sa.Column("goal_text", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["set_id"], ["project_goal_sets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["kpi_id"], ["goal_framework_kpis.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("set_id", "seq", name="uix_project_goal_item_seq"),
    )
    op.create_index(op.f("ix_project_goal_items_id"), "project_goal_items", ["id"], unique=False)

    op.create_table(
        "project_goal_reviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("cycle_label", sa.String(), nullable=False),
        sa.Column("self_rating", sa.Integer(), nullable=True),
        sa.Column("self_is_draft", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("self_submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewer_id", sa.Integer(), nullable=True),
        sa.Column("entered_by_id", sa.Integer(), nullable=True),
        sa.Column("miltenyi_reviewer_name", sa.String(), nullable=True),
        sa.Column("source_received_on", sa.Date(), nullable=True),
        sa.Column("source_url", sa.String(), nullable=True),
        sa.Column("final_rating", sa.Integer(), nullable=True),
        sa.Column("final_rating_by", sa.String(), nullable=False, server_default="miltenyi"),
        sa.Column("review_is_draft", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("review_submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["set_id"], ["project_goal_sets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["entered_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("set_id", "cycle_label", name="uix_project_goal_review_cycle"),
    )
    op.create_index(op.f("ix_project_goal_reviews_id"), "project_goal_reviews", ["id"], unique=False)

    op.create_table(
        "project_goal_review_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("review_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("self_text", sa.Text(), nullable=True),
        sa.Column("primary_comment", sa.Text(), nullable=True),
        sa.Column("healthark_note", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["review_id"], ["project_goal_reviews.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["project_goal_items.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("review_id", "item_id", name="uix_project_goal_review_item"),
    )
    op.create_index(op.f("ix_project_goal_review_items_id"), "project_goal_review_items", ["id"], unique=False)

    op.create_table(
        "project_goal_change_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.Integer(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("before", sa.Text(), nullable=True),
        sa.Column("after", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["set_id"], ["project_goal_sets.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_project_goal_change_logs_id"), "project_goal_change_logs", ["id"], unique=False)

    op.create_table(
        "project_goal_period_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("period_label", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("entry_open", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("self_review_open", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("weightages_visible", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("ratings_visible", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("org_id", "period_label", name="uix_project_goal_period"),
    )
    op.create_index(op.f("ix_project_goal_period_settings_id"), "project_goal_period_settings", ["id"], unique=False)

    # The Miltenyi manager whose comments the mentor transcribes. Set by HR in
    # the Framework Mapping tab; pre-fills the review's provenance block.
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("miltenyi_reviewer_name", sa.String(), nullable=True))

    # Designations gain a function link so the framework editor can list the
    # titles under each level column of the right function.
    with op.batch_alter_table("designations") as batch_op:
        batch_op.add_column(sa.Column("function_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_designations_function", "functions", ["function_id"], ["id"])

    # Housekeeping: mentor_reassignment_logs declares index=True on id but its
    # migration never created the index. Registering the model in
    # app.models.__init__ (this release) made autogenerate notice; create it
    # here so `alembic check` stays quiet.
    op.create_index(
        op.f("ix_mentor_reassignment_logs_id"), "mentor_reassignment_logs", ["id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_mentor_reassignment_logs_id"), table_name="mentor_reassignment_logs")

    with op.batch_alter_table("designations") as batch_op:
        batch_op.drop_constraint("fk_designations_function", type_="foreignkey")
        batch_op.drop_column("function_id")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("miltenyi_reviewer_name")

    for table in (
        "project_goal_period_settings",
        "project_goal_change_logs",
        "project_goal_review_items",
        "project_goal_reviews",
        "project_goal_items",
        "project_goal_sets",
        "goal_framework_kpis",
        "goal_frameworks",
    ):
        op.drop_index(op.f(f"ix_{table}_id"), table_name=table)
        op.drop_table(table)
