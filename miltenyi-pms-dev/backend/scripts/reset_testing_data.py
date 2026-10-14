"""
reset_testing_data.py — clear goal and review activity in the TESTING schema
(`miltenyi`) so a tester can run every flow from the start (14 Oct 2026).

Clears: Project Goals sets (goal rows, quarter reviews, review text, change
log), annual goals (self and mentor reviews), annual reviews (including
management ratings), notifications, the daily-summary send log and password
reset links.

Keeps: every account and its password, functions, designations, the goal
frameworks and their KPIs, role expectations, system settings and the per-year
switches, and the Project Goals year with its quarter roll-out.

Run from backend/ (PowerShell):
    .\\.venv\\Scripts\\python.exe .\\scripts\\reset_testing_data.py            # report only, changes nothing
    .\\.venv\\Scripts\\python.exe .\\scripts\\reset_testing_data.py --apply    # asks you to type RESET

Safety: it always connects to the `miltenyi` schema (whatever DB_SCHEMA says),
refuses unless that schema exists and holds the testing seed's Admin account,
works in one transaction, and never touches `miltenyi_uat`, `miltenyi_pms` or
any other schema.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

from sqlalchemy import create_engine, text  # noqa: E402

SCHEMA = "miltenyi"
SEED_ADMIN = "aanya.sharma@healthark.ai"  # created by miltenyi-test-seed.py

# Children before parents, so every foreign key stays satisfied.
CLEAR = [
    ("project_goal_review_items", "Project Goals: review text per KPI"),
    ("project_goal_reviews", "Project Goals: quarter reviews and ratings"),
    ("project_goal_change_logs", "Project Goals: change log"),
    ("project_goal_items", "Project Goals: goal rows"),
    ("project_goal_sets", "Project Goals: goal sets"),
    ("goal_mentor_reviews", "Annual goals: mentor reviews"),
    ("goal_self_reviews", "Annual goals: self-reviews"),
    ("goals", "Annual goals"),
    ("annual_reviews", "Annual reviews and management ratings"),
    ("notifications", "Bell notifications"),
    ("daily_digest_log", "Daily summary send log"),
    ("password_reset_tokens", "Password reset links"),
]
KEEP = [
    "users", "organizations", "functions", "designations", "goal_frameworks", "goal_framework_kpis",
    "role_expectations", "system_settings", "system_settings_year_overrides",
    "project_goal_period_settings", "project_goal_quarters", "project_goal_cycle_logs",
]

# Rehearsal hook: a scratch database instead of the testing schema.
TEST_URL = os.environ.get("RESET_TEST_URL")


class Refused(Exception):
    """Something is not as expected; nothing was changed."""


def connect():
    if TEST_URL:
        return create_engine(TEST_URL), ""
    from app.core.config import database_url_for, settings

    return create_engine(database_url_for(settings.DATABASE_URL, SCHEMA)), f'{SCHEMA}.'


def check_target(c, is_pg: bool, prefix: str) -> None:
    if is_pg:
        schema = c.execute(text("select current_schema()")).scalar()
        if schema != SCHEMA:
            raise Refused(f"Connected schema is {schema!r}, expected {SCHEMA!r}. Is this the testing database?")
    admin = c.execute(text(f"select count(*) from {prefix}users where email = :e and role = 'Admin'"), {"e": SEED_ADMIN}).scalar()
    if not TEST_URL and admin != 1:
        raise Refused(f"The testing seed's Admin ({SEED_ADMIN}) is not in this schema; refusing to clear it.")


def counts(c, prefix: str, tables) -> dict[str, int]:
    return {t: c.execute(text(f'select count(*) from {prefix}"{t}"')).scalar() for t in tables}


def show(clear: dict[str, int], keep: dict[str, int], heading: str) -> None:
    print(f"\n{heading}")
    print("  Cleared by this script:")
    for t, label in CLEAR:
        print(f"    {label:<44} {clear[t]:>5}")
    print("  Kept:")
    print("    " + ", ".join(f"{t} {keep[t]}" for t in KEEP))


def main() -> int:
    ap = argparse.ArgumentParser(description="Clear goal and review activity in the testing schema.")
    ap.add_argument("--apply", action="store_true", help="clear it (asks you to type RESET)")
    args = ap.parse_args()

    engine, prefix = connect()
    is_pg = engine.dialect.name == "postgresql"

    with engine.connect() as c:
        if is_pg:
            c.execute(text("SET TRANSACTION READ ONLY"))
        check_target(c, is_pg, prefix)
        print(f"Connected to the {SCHEMA!r} schema." if is_pg else "Connected to the rehearsal database.")
        before, kept = counts(c, prefix, [t for t, _ in CLEAR]), counts(c, prefix, KEEP)
    show(before, kept, "Current state")
    total = sum(before.values())
    if total == 0:
        print("\nNothing to clear.")
        return 0
    if not args.apply:
        print(f"\nReport only. {total} rows would be removed. Run again with --apply to clear them.")
        return 0

    if input(f"\nType RESET to permanently remove these {total} rows from the testing schema: ").strip() != "RESET":
        print("Not applied. Nothing was changed.")
        return 1

    with engine.begin() as c:
        check_target(c, is_pg, prefix)
        for t, _ in CLEAR:
            c.execute(text(f'delete from {prefix}"{t}"'))

    with engine.connect() as c:
        if is_pg:
            c.execute(text("SET TRANSACTION READ ONLY"))
        after, kept_after = counts(c, prefix, [t for t, _ in CLEAR]), counts(c, prefix, KEEP)
    show(after, kept_after, "After")
    if kept_after != kept:
        print("\nWarning: a kept table changed while running; check it.")
    print("\nDone. Committed.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Refused as e:
        print(f"\nStopped: {e}\nNothing was changed.")
        sys.exit(2)
