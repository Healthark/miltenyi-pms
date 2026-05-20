"""Merge conflicting heads

Revision ID: 06cfd5f0d9e4
Revises: c4d9e5f8a712, d7e3a9b8c216
Create Date: 2026-05-19 18:24:51.314563

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '06cfd5f0d9e4'
down_revision: Union[str, None] = ('c4d9e5f8a712', 'd7e3a9b8c216')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
