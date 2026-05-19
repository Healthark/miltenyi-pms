"""add_system_settings_year_overrides

Introduces `system_settings_year_overrides` — one row per (org, fy) that
holds the four access-control toggles that previously lived on
`system_settings`:

    - annual_reviews_enabled
    - annual_review_final_rating_visible
    - annual_goals_edit_enabled
    - project_ratings_visible

Backfills exactly one row per existing `system_settings` row, keyed on
the bare FY label extracted from `active_cycle_name` (e.g. "H1 FY26-27"
→ "FY26-27"). The legacy columns on `system_settings` remain in place
for now — gating helpers stop reading them but they survive as a
fallback / seed source until a follow-up cleanup PR drops them.

Idempotent against re-running on a partially-migrated DB: the backfill
ON CONFLICT-skips when an override row for the same (org_id, fy_label)
already exists.

Revision ID: b2f9e4a7c081
Revises: a4e7b8c3d105
Create Date: 2026-05-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2f9e4a7c081"
down_revision: Union[str, None] = "a4e7b8c3d105"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _extract_fy_label(cycle_name: str | None) -> str | None:
    """Mirror of `cycle_utils.extract_fy_label` — replicated here so the
    migration doesn't import application code (Alembic envs run before
    the rest of the app is guaranteed importable).

    Returns None for inputs the route layer wouldn't accept anyway
    (None / empty / no FY token). Callers must skip such rows in the
    backfill rather than emit a malformed override.
    """
    if not cycle_name:
        return None
    for token in cycle_name.upper().split():
        if token.startswith("FY"):
            return token
    # If the input already lacks a code prefix (annual cadence's bare FY
    # form, e.g. "FY26-27"), use it verbatim.
    if cycle_name.upper().startswith("FY"):
        return cycle_name.upper().strip()
    return None


def upgrade() -> None:
    # ── 1. Create the table ──────────────────────────────────────────
    # batch_alter_table is unnecessary for new-table creation but the
    # unique constraint is explicit so SQLite (dev) gets the name. We
    # name the constraint explicitly so the downgrade can drop it
    # cleanly on Postgres.
    op.create_table(
        "system_settings_year_overrides",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("fy_label", sa.String(), nullable=False),
        sa.Column(
            "annual_reviews_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "annual_review_final_rating_visible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "annual_goals_edit_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column(
            "project_ratings_visible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"]),
        sa.UniqueConstraint("org_id", "fy_label", name="uq_settings_year_org_fy"),
    )
    op.create_index(
        "ix_system_settings_year_overrides_org_id",
        "system_settings_year_overrides",
        ["org_id"],
        unique=False,
    )

    # ── 2. Backfill from existing system_settings rows ───────────────
    # Read the four legacy flag values plus the active_cycle_name so we
    # can derive the FY label. We skip rows with no recognisable FY in
    # the cycle text (typically dev seeds) — admins can configure those
    # years through the new UI after they pick a year.
    conn = op.get_bind()
    legacy_rows = conn.execute(
        sa.text(
            """
            SELECT org_id, active_cycle_name,
                   COALESCE(annual_reviews_enabled, false) AS annual_reviews_enabled,
                   COALESCE(annual_review_final_rating_visible, false) AS annual_review_final_rating_visible,
                   COALESCE(annual_goals_edit_enabled, false) AS annual_goals_edit_enabled,
                   COALESCE(project_ratings_visible, false) AS project_ratings_visible,
                   updated_by_id
            FROM system_settings
            """
        )
    ).fetchall()

    for row in legacy_rows:
        fy = _extract_fy_label(row.active_cycle_name)
        if fy is None:
            continue
        # ON CONFLICT DO NOTHING via existence check to keep the
        # backfill idempotent across SQLite + Postgres.
        already_present = conn.execute(
            sa.text(
                "SELECT 1 FROM system_settings_year_overrides "
                "WHERE org_id = :org_id AND fy_label = :fy"
            ),
            {"org_id": row.org_id, "fy": fy},
        ).first()
        if already_present:
            continue
        conn.execute(
            sa.text(
                """
                INSERT INTO system_settings_year_overrides (
                    org_id, fy_label,
                    annual_reviews_enabled,
                    annual_review_final_rating_visible,
                    annual_goals_edit_enabled,
                    project_ratings_visible,
                    updated_by_id
                ) VALUES (
                    :org_id, :fy,
                    :ar, :arv, :age, :prv,
                    :ubid
                )
                """
            ),
            {
                "org_id": row.org_id,
                "fy": fy,
                "ar": bool(row.annual_reviews_enabled),
                "arv": bool(row.annual_review_final_rating_visible),
                "age": bool(row.annual_goals_edit_enabled),
                "prv": bool(row.project_ratings_visible),
                "ubid": row.updated_by_id,
            },
        )


def downgrade() -> None:
    op.drop_index(
        "ix_system_settings_year_overrides_org_id",
        table_name="system_settings_year_overrides",
    )
    op.drop_table("system_settings_year_overrides")
