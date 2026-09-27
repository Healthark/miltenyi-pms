"""
miltenyi-test-seed.py — the TESTING instance (schema `miltenyi`).

Stands up a Miltenyi PMS with just enough data to log in as every role and
exercise every flow. No goals, reviews or goal sets — testers create those.

What this seeds:
    - Everything shared (seed_data/common.py): the Miltenyi organisation,
      8 GCC functions and their designations, 32 role-expectation rows, the
      Project Goals framework for CY 26-27 from the goal-theme PDFs, System
      Settings (half-yearly, Asia/Kolkata, H2 · CY 26-27), the FY26-27
      switches (all open) and the goal year CY 26-27 with Q1–Q3 rolled out.
    - 13 users, all @healthark.ai (only Healthark staff use the app):
        1  Admin   (Healthark HR)
        3  Mentors (each themed to one GCC function; no function of their own)
        9  Staff   (3 mentees per mentor, sitting in their mentor's function,
                   each with the NAME of their Miltenyi reviewer)

Functions with users (3 of 8):
    Regulatory Affairs        — Rahul's mentees (Miltenyi reviewer Stefan Bauer)
    Pharmacovigilance         — Neha's mentees (Miltenyi reviewer Helena Vogel)
    Clinical Trial Management — Vikram's mentees (Miltenyi reviewer Markus Krause)

The other 5 functions have designations and expectations but no users.
Pharmacovigilance has no framework rows (no PDF), so Neha's mentees see the
"no framework yet" notice until the Admin adds rows.

All passwords: password123. Idempotent — safe to re-run. Run:

    python miltenyi-test-seed.py
"""

from app.core.database import SessionLocal
from app.models.user_models import Role, User
from seed_data.common import (
    DEFAULT_PASSWORD,
    designation_by_name,
    ensure_org,
    ensure_reference_data,
    ensure_user,
    function_by_name,
    seed_shared,
)


def seed_test_database() -> None:
    print("Seeding Miltenyi TESTING instance…")
    db = SessionLocal()
    try:
        org = ensure_org(db)
        ensure_reference_data(db, org)

        func_ra = function_by_name(db, org, "Regulatory Affairs")
        func_pv = function_by_name(db, org, "Pharmacovigilance")
        func_ctm = function_by_name(db, org, "Clinical Trial Management")
        d_ra_assoc = designation_by_name(db, org, "Regulatory Affairs Associate")           # L1
        d_ra_assoc_sr = designation_by_name(db, org, "Senior Regulatory Affairs Associate") # L2
        d_pv_assoc = designation_by_name(db, org, "Pharmacovigilance Associate")            # L1
        d_pv_analyst = designation_by_name(db, org, "Pharmacovigilance Analyst")            # L2
        d_ctm_assoc = designation_by_name(db, org, "Clinical Trial Associate")              # L1
        d_ctm_mgr = designation_by_name(db, org, "Clinical Trial Manager")                  # L2

        def user(email, **kw):
            return ensure_user(db, org, email, **kw)

        # Admin + Mentors are framework-external (no function / designation).
        aanya = user("aanya.sharma@healthark.ai", employee_code="HRK-T01", full_name="Aanya Sharma",
                     phone="+91 98000 10001", role=Role.ADMIN.value)
        rahul = user("rahul.verma@healthark.ai", employee_code="HRK-T-M01", full_name="Rahul Verma",
                     phone="+91 98000 10010", role=Role.MENTOR.value)
        neha = user("neha.kapoor@healthark.ai", employee_code="HRK-T-M02", full_name="Neha Kapoor",
                    phone="+91 98000 10011", role=Role.MENTOR.value)
        vikram = user("vikram.iyer@healthark.ai", employee_code="HRK-T-M03", full_name="Vikram Iyer",
                      phone="+91 98000 10012", role=Role.MENTOR.value)

        # Staff: 3 mentees per mentor, in the mentor's function.
        staff = [
            ("aarav.patel@healthark.ai", "HRK-T-S-01", "Aarav Patel", "+91 98000 10101", rahul, func_ra, d_ra_assoc),
            ("diya.mehta@healthark.ai", "HRK-T-S-02", "Diya Mehta", "+91 98000 10102", rahul, func_ra, d_ra_assoc_sr),
            ("kabir.singh@healthark.ai", "HRK-T-S-03", "Kabir Singh", "+91 98000 10103", rahul, func_ra, d_ra_assoc),
            ("ishaan.joshi@healthark.ai", "HRK-T-S-04", "Ishaan Joshi", "+91 98000 10104", neha, func_pv, d_pv_analyst),
            ("saanvi.reddy@healthark.ai", "HRK-T-S-05", "Saanvi Reddy", "+91 98000 10105", neha, func_pv, d_pv_assoc),
            ("ayaan.khan@healthark.ai", "HRK-T-S-06", "Ayaan Khan", "+91 98000 10106", neha, func_pv, d_pv_assoc),
            ("riya.nair@healthark.ai", "HRK-T-S-07", "Riya Nair", "+91 98000 10107", vikram, func_ctm, d_ctm_mgr),
            ("arjun.gupta@healthark.ai", "HRK-T-S-08", "Arjun Gupta", "+91 98000 10108", vikram, func_ctm, d_ctm_assoc),
            ("myra.desai@healthark.ai", "HRK-T-S-09", "Myra Desai", "+91 98000 10109", vikram, func_ctm, d_ctm_assoc),
        ]
        for email, code, name, phone, mentor, fn, desig in staff:
            user(email, employee_code=code, full_name=name, phone=phone, role=Role.STAFF.value,
                 mentor_id=mentor.id, function_id=fn.id, designation_id=desig.id)
        print("  [+] Users (Admin×1, Mentors×3, Staff×9 across 3 of 8 GCC functions)")

        seed_shared(db, org, aanya)

        # Miltenyi reviewer of each Staff member = the Miltenyi lead of their
        # function (names only; Miltenyi staff never log in). Set only where
        # blank so edits in Admin → Framework Mapping survive re-runs.
        reviewer_by_function = {func_ra.id: "Stefan Bauer", func_pv.id: "Helena Vogel", func_ctm.id: "Markus Krause"}
        named = 0
        for u in db.query(User).filter_by(org_id=org.id, role=Role.STAFF.value, miltenyi_reviewer_name=None):
            name = reviewer_by_function.get(u.function_id)
            if name:
                u.miltenyi_reviewer_name = name
                named += 1
        if named:
            db.commit()
            print(f"  [+] Miltenyi reviewer names on {named} employees")

        print("\n" + "=" * 64)
        print("Testing seed complete.")
        print("=" * 64)
        print(f"\n--- ACCOUNTS (all passwords: {DEFAULT_PASSWORD}) ---")
        print("\n  Admin (Healthark HR)")
        print("    aanya.sharma@healthark.ai     Aanya Sharma     (Admin)")
        print("\n  Mentors (Healthark)")
        print("    rahul.verma@healthark.ai     Rahul Verma     (mentors Aarav, Diya, Kabir — Regulatory Affairs)")
        print("    neha.kapoor@healthark.ai     Neha Kapoor     (mentors Ishaan, Saanvi, Ayaan — Pharmacovigilance)")
        print("    vikram.iyer@healthark.ai     Vikram Iyer     (mentors Riya, Arjun, Myra — Clinical Trial Mgmt)")
        print("\n  Staff (Healthark employees on Miltenyi work)")
        print("    Regulatory Affairs        : aarav.patel@,    diya.mehta@,    kabir.singh@healthark.ai")
        print("    Pharmacovigilance         : ishaan.joshi@,   saanvi.reddy@,  ayaan.khan@healthark.ai")
        print("    Clinical Trial Management : riya.nair@,      arjun.gupta@,   myra.desai@healthark.ai")
        print()
        print("  No goals, goal sets or reviews seeded — testers create those.")
        print()
    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_test_database()
