"""collapse_goal_reviews_to_overall

Replaces the 8 per-competency text columns on ``goal_self_reviews`` and
``goal_mentor_reviews`` with a single freeform ``*_overall_review`` column.

The form UX is changing from "8 textareas, one per competency" to "one
paragraph + a role-expectations reference panel for Firm Growth and
Competency & Skills" — mirroring the Annual Review self-appraisal shape.

Data migration:
    For each existing row, populate ``self_overall_review`` /
    ``mentor_overall_review`` by concatenating the 8 old fields with
    section labels and blank-line separators so historical content is
    preserved verbatim. Then drop the 8 columns and tighten the new one
    to NOT NULL.

Revision ID: b6e3a9d4c5f7
Revises: f4a5b8c1d2e9
Create Date: 2026-04-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b6e3a9d4c5f7"
down_revision: Union[str, None] = "f4a5b8c1d2e9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── Column maps ──────────────────────────────────────────────────────
# (column_name, human label) — order is preserved in the concatenated
# fallback so the historical text reads coherently.
SELF_COMPETENCIES = [
    ("self_desc_task_execution",      "Task Execution & Problem Solving"),
    ("self_desc_ownership",           "Ownership & Accountability"),
    ("self_desc_client_deliverables", "Building Client-Ready Deliverables"),
    ("self_desc_communication",       "Communication & Stakeholder Management"),
    ("self_desc_project_management",  "Project Management and Risk Mitigation"),
    ("self_desc_mentoring",           "Mentoring and Team Development"),
    ("self_desc_firm_growth",         "Firm Growth"),
    ("self_desc_competency_skills",   "Competency and Skills"),
]

MENTOR_COMPETENCIES = [
    ("mentor_comment_task_execution",      "Task Execution & Problem Solving"),
    ("mentor_comment_ownership",           "Ownership & Accountability"),
    ("mentor_comment_client_deliverables", "Building Client-Ready Deliverables"),
    ("mentor_comment_communication",       "Communication & Stakeholder Management"),
    ("mentor_comment_project_management",  "Project Management and Risk Mitigation"),
    ("mentor_comment_mentoring",           "Mentoring and Team Development"),
    ("mentor_comment_firm_growth",         "Firm Growth"),
    ("mentor_comment_competency_skills",   "Competency and Skills"),
]


def _backfill_overall(table: str, target_col: str, columns):
    """Concatenate `[Label]\n<text>` blocks separated by blank lines."""
    bind = op.get_bind()
    rows = bind.execute(sa.text(f"SELECT id FROM {table}")).fetchall()
    if not rows:
        return
    for row in rows:
        select_cols = ", ".join(c for c, _ in columns)
        record = bind.execute(
            sa.text(f"SELECT {select_cols} FROM {table} WHERE id = :i"),
            {"i": row.id},
        ).fetchone()
        sections = []
        for (col, label), value in zip(columns, record):
            text = (value or "").strip()
            if text:
                sections.append(f"[{label}]\n{text}")
        merged = "\n\n".join(sections) or "(no content)"
        bind.execute(
            sa.text(f"UPDATE {table} SET {target_col} = :v WHERE id = :i"),
            {"v": merged, "i": row.id},
        )


def upgrade() -> None:
    # ── goal_self_reviews ──────────────────────────────────────────
    with op.batch_alter_table("goal_self_reviews") as batch_op:
        batch_op.add_column(sa.Column("self_overall_review", sa.Text(), nullable=True))

    _backfill_overall(
        "goal_self_reviews", "self_overall_review", SELF_COMPETENCIES
    )

    with op.batch_alter_table("goal_self_reviews") as batch_op:
        for col, _label in SELF_COMPETENCIES:
            batch_op.drop_column(col)
        batch_op.alter_column(
            "self_overall_review",
            existing_type=sa.Text(),
            nullable=False,
        )

    # ── goal_mentor_reviews ────────────────────────────────────────
    with op.batch_alter_table("goal_mentor_reviews") as batch_op:
        batch_op.add_column(sa.Column("mentor_overall_review", sa.Text(), nullable=True))

    _backfill_overall(
        "goal_mentor_reviews", "mentor_overall_review", MENTOR_COMPETENCIES
    )

    with op.batch_alter_table("goal_mentor_reviews") as batch_op:
        for col, _label in MENTOR_COMPETENCIES:
            batch_op.drop_column(col)
        batch_op.alter_column(
            "mentor_overall_review",
            existing_type=sa.Text(),
            nullable=False,
        )


def downgrade() -> None:
    # Re-add the 8 columns each (default empty string, then tightened to
    # NOT NULL) and copy the overall content into the *_competency_skills
    # column so nothing is lost. The other 7 stay empty — best effort.
    with op.batch_alter_table("goal_self_reviews") as batch_op:
        for col, _ in SELF_COMPETENCIES:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))

    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE goal_self_reviews "
            "SET self_desc_competency_skills = COALESCE(self_overall_review, '')"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE goal_self_reviews SET "
            + ", ".join(
                f"{col} = ''"
                for col, _ in SELF_COMPETENCIES
                if col != "self_desc_competency_skills"
            )
            + " WHERE TRUE"
        )
    )

    with op.batch_alter_table("goal_self_reviews") as batch_op:
        for col, _ in SELF_COMPETENCIES:
            batch_op.alter_column(col, existing_type=sa.Text(), nullable=False)
        batch_op.drop_column("self_overall_review")

    with op.batch_alter_table("goal_mentor_reviews") as batch_op:
        for col, _ in MENTOR_COMPETENCIES:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))

    bind.execute(
        sa.text(
            "UPDATE goal_mentor_reviews "
            "SET mentor_comment_competency_skills = COALESCE(mentor_overall_review, '')"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE goal_mentor_reviews SET "
            + ", ".join(
                f"{col} = ''"
                for col, _ in MENTOR_COMPETENCIES
                if col != "mentor_comment_competency_skills"
            )
            + " WHERE TRUE"
        )
    )

    with op.batch_alter_table("goal_mentor_reviews") as batch_op:
        for col, _ in MENTOR_COMPETENCIES:
            batch_op.alter_column(col, existing_type=sa.Text(), nullable=False)
        batch_op.drop_column("mentor_overall_review")
