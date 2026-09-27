"""
miltenyi-uat-seed.py — the UAT instance (schema `miltenyi_uat`).

Decisions (Zaahid, 27 Sep 2026):
    - Two accounts for now: Gautham (Admin) and Shreshta (Mentor). First
      names only. Password `password123`, no forced change. No function or
      designation on either (Admin and Mentors sit outside the GCC bands),
      exactly like the testing seed's Admin and mentors.
    - Everything shared is loaded (seed_data/common.py): the Miltenyi
      organisation, 8 GCC functions and their designations, 32 role-
      expectation rows, the Project Goals framework for CY 26-27 from the
      goal-theme PDFs, System Settings (half-yearly, Asia/Kolkata), the
      FY26-27 switches (all open) and the goal year CY 26-27 with Q1–Q3
      rolled out and Q3 current — so annual goals and reviews read
      H2 · CY 26-27 from the first login.
    - Clean slate: no staff, no goals, no reviews. The Admin adds staff from
      the Users tab (mentor: Shreshta) and the flows are exercised from there.

Idempotent — safe to re-run. Point DATABASE_URL at the UAT schema, then:

    python -m alembic upgrade head
    python miltenyi-uat-seed.py
"""

from app.core.database import SessionLocal
from app.models.user_models import Role
from seed_data.common import (
    DEFAULT_PASSWORD,
    ensure_org,
    ensure_reference_data,
    ensure_user,
    seed_shared,
)


def seed_uat_database() -> None:
    print("Seeding Miltenyi UAT instance…")
    db = SessionLocal()
    try:
        org = ensure_org(db)
        ensure_reference_data(db, org)

        gautham = ensure_user(
            db, org, "gautham@healthark.ai",
            employee_code="HRK-U01", full_name="Gautham",
            role=Role.ADMIN.value, function_id=None, designation_id=None,
        )
        shreshta = ensure_user(
            db, org, "shreshta@healthark.ai",
            employee_code="HRK-U-M01", full_name="Shreshta",
            role=Role.MENTOR.value, function_id=None, designation_id=None,
        )
        print("  [+] Users (Admin×1: Gautham; Mentor×1: Shreshta)")

        seed_shared(db, org, gautham)

        print("\n" + "=" * 64)
        print("UAT seed complete.")
        print("=" * 64)
        print(f"\n--- ACCOUNTS (password: {DEFAULT_PASSWORD}, no forced change) ---")
        print(f"    {gautham.email:<28} {gautham.full_name:<10} Admin   (Healthark HR: users, settings, framework, Notify, all goals and reviews)")
        print(f"    {shreshta.email:<28} {shreshta.full_name:<10} Mentor  (Team Goals, Project Goals queue, mentees' annual reviews)")
        print()
        print("  No staff yet: add them from Admin → Users with Shreshta as mentor,")
        print("  a function and a designation, so Project Goals picks up a framework row.")
        print("  No goals, goal sets or reviews seeded.")
        print()
    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_uat_database()
