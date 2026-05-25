"""gcc_framework_replacement

Replaces the Healthark-flavored 8-competency framework with the Miltenyi GCC
career-path framework throughout the schema. Three tables change:

1. designations
   - ADD career_level (Integer, nullable) — GCC band 1..4
   - ADD career_level_label (String, nullable) — "Entry" / "Mid" / "Senior" / "Lead"
   - level (Integer) kept as legacy sort key.

2. role_expectations
   - DROP designation_id FK (re-key the table from per-designation to per-career-level)
   - ADD career_level (Integer, NOT NULL)
   - DROP unique index ix_role_exp_org_func_desig
   - ADD unique index ix_role_exp_org_func_level on (org_id, function_id, career_level)
   - DROP 8 PMS expectation columns:
       exp_task_execution, exp_ownership, exp_project_management,
       exp_client_deliverables, exp_communication, exp_mentoring,
       exp_firm_growth, exp_competency_skills
   - ADD 6 GCC content columns:
       exp_scope_of_role, exp_key_responsibilities, exp_technical_competencies,
       exp_delivery_ownership, exp_regulatory_compliance,
       exp_project_resource_management

3. project_reviews
   - DROP 7 PMS comment columns:
       comment_task_execution, comment_ownership, comment_project_management,
       comment_client_deliverables, comment_communication, comment_mentoring,
       comment_competency_skills
   - ADD 6 GCC comment columns (parallel to role_expectations naming):
       comment_scope_of_role, comment_key_responsibilities,
       comment_technical_competencies, comment_delivery_ownership,
       comment_regulatory_compliance, comment_project_resource_management
   - Existing unique index ix_project_reviews_org_user_proj_cycle is preserved
     by batch_alter_table.

This migration is intentionally destructive: any historical
RoleExpectation rows and any per-axis comment text on existing
ProjectReview rows are dropped. The downgrade path recreates the
columns but cannot restore the lost text. The pre-existing local DB is
expected to be wiped + reseeded around this migration; no production
data exists.

Revision ID: f7c4a9e2b5d1
Revises: e7f3b9c8a625
Create Date: 2026-05-23
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7c4a9e2b5d1"
down_revision: Union[str, None] = "e7f3b9c8a625"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Column groups kept as module-level constants so upgrade/downgrade stay
# in lock-step.
OLD_ROLE_EXPECTATION_COLUMNS = (
    "exp_task_execution",
    "exp_ownership",
    "exp_project_management",
    "exp_client_deliverables",
    "exp_communication",
    "exp_mentoring",
    "exp_firm_growth",
    "exp_competency_skills",
)
NEW_ROLE_EXPECTATION_COLUMNS = (
    "exp_scope_of_role",
    "exp_key_responsibilities",
    "exp_technical_competencies",
    "exp_delivery_ownership",
    "exp_regulatory_compliance",
    "exp_project_resource_management",
)

OLD_PROJECT_REVIEW_COMMENTS = (
    "comment_task_execution",
    "comment_ownership",
    "comment_project_management",
    "comment_client_deliverables",
    "comment_communication",
    "comment_mentoring",
    "comment_competency_skills",
)
NEW_PROJECT_REVIEW_COMMENTS = (
    "comment_scope_of_role",
    "comment_key_responsibilities",
    "comment_technical_competencies",
    "comment_delivery_ownership",
    "comment_regulatory_compliance",
    "comment_project_resource_management",
)


def upgrade() -> None:
    # ── 1. designations: add GCC career-level columns ─────────────────
    with op.batch_alter_table("designations") as batch_op:
        batch_op.add_column(sa.Column("career_level", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("career_level_label", sa.String(), nullable=True))

    # ── 2. role_expectations: drop old columns + index + designation FK,
    #       add career_level + new content columns + new index ─────────
    # The old data is wiped — RoleExpectation is reference data and the
    # local DB is being reseeded. No data preservation required.
    with op.batch_alter_table("role_expectations") as batch_op:
        # Drop the old unique index first so the FK / column drops don't
        # trip over it during the batch recreate. The literal name in
        # the live schema is "ix_role_exp_org_dept_desig" (a leftover
        # from when `function_id` was called `department_id`); the
        # model's declared name `ix_role_exp_org_func_desig` was never
        # actually applied because the rename-departments migration
        # didn't replace the index, only renamed the column.
        batch_op.drop_index("ix_role_exp_org_dept_desig")

        for col in OLD_ROLE_EXPECTATION_COLUMNS:
            batch_op.drop_column(col)

        # Drop the FK to designations — RoleExpectations are no longer
        # per-designation.
        batch_op.drop_column("designation_id")

        # New career_level — nullable=False, but no existing rows survive
        # the column drops above on SQLite (batch_alter_table rebuilds
        # the table; orphan rows without the new value would have
        # nothing to fill it). In practice the seed wipes the table; on
        # Postgres / live envs this would need a server_default first
        # then drop the default. For our dev flow this is safe.
        batch_op.add_column(sa.Column("career_level", sa.Integer(), nullable=False))

        for col in NEW_ROLE_EXPECTATION_COLUMNS:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))

        batch_op.create_index(
            "ix_role_exp_org_func_level",
            ["org_id", "function_id", "career_level"],
            unique=True,
        )

    # ── 3. project_reviews: drop 7 comment columns, add 6 new ────────
    # The unique index ix_project_reviews_org_user_proj_cycle is
    # preserved automatically by batch_alter_table (none of the
    # constrained columns are being touched).
    with op.batch_alter_table("project_reviews") as batch_op:
        for col in OLD_PROJECT_REVIEW_COMMENTS:
            batch_op.drop_column(col)
        for col in NEW_PROJECT_REVIEW_COMMENTS:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))


def downgrade() -> None:
    # ── 3-rev. project_reviews: drop new 6, add back old 7 ──────────
    with op.batch_alter_table("project_reviews") as batch_op:
        for col in NEW_PROJECT_REVIEW_COMMENTS:
            batch_op.drop_column(col)
        for col in OLD_PROJECT_REVIEW_COMMENTS:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))

    # ── 2-rev. role_expectations: rebuild old shape ─────────────────
    with op.batch_alter_table("role_expectations") as batch_op:
        batch_op.drop_index("ix_role_exp_org_func_level")
        for col in NEW_ROLE_EXPECTATION_COLUMNS:
            batch_op.drop_column(col)
        batch_op.drop_column("career_level")
        batch_op.add_column(
            sa.Column(
                "designation_id",
                sa.Integer(),
                sa.ForeignKey("designations.id"),
                nullable=False,
            )
        )
        for col in OLD_ROLE_EXPECTATION_COLUMNS:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))
        batch_op.create_index(
            "ix_role_exp_org_func_desig",
            ["org_id", "function_id", "designation_id"],
            unique=True,
        )

    # ── 1-rev. designations: drop GCC columns ────────────────────────
    with op.batch_alter_table("designations") as batch_op:
        batch_op.drop_column("career_level_label")
        batch_op.drop_column("career_level")
