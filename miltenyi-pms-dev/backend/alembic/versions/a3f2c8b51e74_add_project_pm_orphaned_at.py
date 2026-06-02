"""add_project_pm_orphaned_at

Adds `projects.pm_orphaned_at` — nullable timestamp set by the PM
cascade when a Project's PM is deactivated or role-changed away from
PM. Mirrors `users.mentor_orphaned_at` from the mentor cascade
(c2e8f4a9d316).

Data backfill: stamp `pm_orphaned_at = NOW()` for every existing
active, non-deleted project whose `pm_id IS NULL`. Before this PR the
deactivate_user cascade nulled `Project.pm_id` for all roles
(admin_routes.py:1399-1402) without leaving any breadcrumb, so any
historical orphan currently sits in the DB with `pm_id=NULL` and no
record of when that happened. Stamping NOW() lets the dashboard's new
"Orphaned Projects" bucket surface them immediately rather than
making HR wait for the next deactivation event. The exact age won't
be right (the row is older than NOW()), but the bucket is for "act on
me" alerting — not historical reporting — so the surface is correct
and the alternative (leaving them invisible) is worse.

Revision ID: a3f2c8b51e74
Revises: c2e8f4a9d316
Create Date: 2026-06-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3f2c8b51e74"
down_revision: Union[str, None] = "c2e8f4a9d316"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add nullable column to projects — batch_alter_table for SQLite
    # dev compat (same pattern as c2e8f4a9d316_add_mentor_orphaned_at).
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column(
                "pm_orphaned_at",
                sa.DateTime(timezone=True),
                nullable=True,
            )
        )

    # 2. Backfill: stamp NOW() on every active, non-deleted project
    # currently sitting at pm_id=NULL. These are the pre-existing
    # orphans the dashboard's new bucket should immediately see.
    #
    # We scope to status='active' to avoid stamping completed projects
    # that legitimately ended with a deactivated PM at the close — those
    # aren't "act on me" today. is_deleted=FALSE for the same reason
    # (soft-deleted projects are out of sight anyway).
    op.execute(
        """
        UPDATE projects
        SET pm_orphaned_at = CURRENT_TIMESTAMP
        WHERE pm_id IS NULL
          AND status = 'active'
          AND is_deleted = FALSE
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("pm_orphaned_at")
