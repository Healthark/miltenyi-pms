"""rename roles for the Healthark-only instance

Revision ID: b3d9f1a7c2e4
Revises: a7c3e9d1f2b4
Create Date: 2026-09-10

Only Healthark employees use the application, so the five-role model
(HR_MyOrg / HR_Miltenyi / Mentor / PM / Employee) becomes three roles:

    HR_MyOrg  -> Admin
    Employee  -> Staff
    Mentor    -> Mentor (unchanged)

`PM` and `HR_Miltenyi` accounts (Miltenyi-side logins) are deactivated
rather than deleted: projects, project reviews, notifications and
audit rows still reference them by id, so a hard delete would orphan
those rows on Postgres. Deactivated rows keep their historical role
string and never appear in role filters or dropdowns.

`users.role` is a plain VARCHAR, so this is a data migration only — no
DDL, and it works the same on SQLite and Postgres.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b3d9f1a7c2e4"
down_revision = "a7c3e9d1f2b4"
branch_labels = None
depends_on = None


users = sa.table(
    "users",
    sa.column("role", sa.String),
    sa.column("is_deleted", sa.Boolean),
    sa.column("deleted_at", sa.DateTime(timezone=True)),
)

_RENAMES = (("HR_MyOrg", "Admin"), ("Employee", "Staff"))
_RETIRED = ("PM", "HR_Miltenyi")


def upgrade() -> None:
    for old, new in _RENAMES:
        op.execute(users.update().where(users.c.role == old).values(role=new))
    op.execute(
        users.update()
        .where(users.c.role.in_(_RETIRED), users.c.is_deleted.is_(False))
        .values(is_deleted=True, deleted_at=sa.func.now())
    )


def downgrade() -> None:
    for old, new in _RENAMES:
        op.execute(users.update().where(users.c.role == new).values(role=old))
    # Best effort: the retired accounts come back as they were before the
    # upgrade deactivated them. Accounts that were already deactivated
    # before the upgrade are reactivated too — acceptable for a dev/UAT
    # database, which is the only place this migration is expected to
    # be reversed.
    op.execute(
        users.update()
        .where(users.c.role.in_(_RETIRED))
        .values(is_deleted=False, deleted_at=None)
    )
