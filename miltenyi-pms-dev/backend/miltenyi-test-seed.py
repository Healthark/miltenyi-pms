"""
miltenyi-test-seed.py — Minimal demo-instance seed.

Goal: stand up a clean Miltenyi PMS instance with just enough data for
stakeholders to log in, navigate every page, and exercise the role-driven
flows. NO operational data — no projects, no goals, no reviews, no
project assignments. Stakeholders create those themselves while testing
so we get fresh observations.

What this seeds (and only this):
    - The Miltenyi organization
    - Reference data (Miltenyi GCC career-path, mirrored from seed.py via
      the shared `seed_data.gcc` module):
        Functions    — 8 GCC functions (Clinical Data Management,
                       Biostatistics, Regulatory Affairs, Pharmacovigilance,
                       Clinical Trial Management, Medical Writing,
                       Clinical Trial Finance, Legal).
        Designations — ~36 titles across 4 career levels (Entry / Mid /
                       Senior / Lead). Each Designation carries
                       `career_level` + `career_level_label` so the
                       /me/expectations API can resolve a user's role
                       expectations.
    - SystemSettings tuned for demo (all gates open, ratings visible)
    - 18 users:
        2  HR  — 1 Healthark (HR_MyOrg, Indian name) + 1 Miltenyi (HR_Miltenyi, German)
        3  Mentors (Healthark, Indian names) — themed by function
        4  PMs    (Miltenyi, German names) — assigned to the same
                  functions as the Employees they will eventually review
        9  Employee  (Miltenyi domain, Indian names — 3 mentees per
                     mentor; clustered into 3 of the 8 GCC functions so
                     each mentor's team sits in one function)
    - Role expectations: 32 rows (8 functions × 4 career levels) imported
      verbatim from `seed_data.gcc.GCC_ROLE_EXPECTATIONS`. Keyed on
      (function, career_level) — the gcc_framework_replacement migration
      (f7c4a9e2b5d1) replaced the old per-designation FK + 8-column PMS
      framework with this shape.

Functions with seeded users (3 of 8):
    Regulatory Affairs        — Rahul's mentees + PMs Stefan + Brigitte
    Pharmacovigilance         — Neha's mentees + PM Helena
    Clinical Trial Management — Vikram's mentees + PM Markus

The remaining 5 functions (Clinical Data Management, Biostatistics,
Medical Writing, Clinical Trial Finance, Legal) appear in every
dropdown but have no users assigned — stakeholders can add users to
those functions as they explore the admin panel.

Everything else is left empty so the stakeholders' first creates are
their own. All passwords are `password123`. Run:

    python miltenyi-test-seed.py
"""

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.reference_models import Function, Designation
from app.models.user_models import User, Role
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.role_expectation_models import RoleExpectation

# Shared GCC career-path content (functions, designations, role-expectation
# prose). Same source as seed.py — edits to the framework happen in
# seed_data/gcc.py and propagate to both seeds.
from seed_data.gcc import (
    LEVEL_LABEL,
    GCC_DESIGNATIONS,
    GCC_ROLE_EXPECTATIONS,
)


def seed_test_database() -> None:
    print("Seeding Miltenyi demo / test instance…")
    db = SessionLocal()
    pw = get_password_hash("password123")

    try:
        # ============================================================ #
        # 1. ORGANIZATION                                               #
        # ============================================================ #
        miltenyi = db.query(Organization).filter(Organization.name == "Miltenyi").first()
        if not miltenyi:
            miltenyi = Organization(
                name="Miltenyi",
                domain="miltenyi.com",
                enabled_features=[
                    "dashboard", "goals", "project_reviews",
                    "annual_reviews", "mentoring", "admin",
                ],
            )
            db.add(miltenyi)
            db.commit()
            db.refresh(miltenyi)
            print("  [+] Organization: Miltenyi")
        else:
            print("  [~] Organization 'Miltenyi' already exists; reusing.")

        # ============================================================ #
        # 2. FUNCTIONS & DESIGNATIONS (GCC career-path)                 #
        # ============================================================ #
        # 8 GCC functions × 4 career levels. Multiple titles at a
        # single band (e.g. "Senior Regulatory Affairs Associate" +
        # "Regulatory Affairs Specialist" both at RA L2) each become
        # their own Designation row but share the same RoleExpectation.
        if db.query(Function).filter(Function.org_id == miltenyi.id).count() == 0:
            gcc_function_names = sorted({fname for fname, _, _ in GCC_DESIGNATIONS})
            for fname in gcc_function_names:
                db.add(Function(org_id=miltenyi.id, name=fname))
            db.flush()

            for _, lvl, titles in GCC_DESIGNATIONS:
                for title in titles:
                    db.add(Designation(
                        org_id=miltenyi.id,
                        name=title,
                        level=lvl,                       # legacy sort, matches band for now
                        career_level=lvl,
                        career_level_label=LEVEL_LABEL[lvl],
                    ))
            db.commit()
            print(f"  [+] {len(gcc_function_names)} GCC Functions and "
                  f"{sum(len(t) for _, _, t in GCC_DESIGNATIONS)} Designations")
        else:
            print("  [~] Reference data already exists; reusing.")

        # ── Resolve handles for the functions / designations we'll use ──
        def _fn(name: str) -> Function:
            return db.query(Function).filter_by(org_id=miltenyi.id, name=name).first()

        def _desig(name: str) -> Designation:
            return db.query(Designation).filter_by(org_id=miltenyi.id, name=name).first()

        # The three functions where the demo cast lives (the other 5
        # functions are seeded with empty user assignments).
        func_ra  = _fn("Regulatory Affairs")
        func_pv  = _fn("Pharmacovigilance")
        func_ctm = _fn("Clinical Trial Management")

        # Designations the demo users get. RA + PV + CTM titles only;
        # the other functions' titles are in the DB but unused here.
        d_ra_assoc       = _desig("Regulatory Affairs Associate")          # L1
        d_ra_assoc_sr    = _desig("Senior Regulatory Affairs Associate")   # L2
        d_ra_lead        = _desig("Regulatory Affairs Lead")               # L4

        d_pv_assoc       = _desig("Pharmacovigilance Associate")           # L1
        d_pv_analyst     = _desig("Pharmacovigilance Analyst")             # L2
        d_pv_lead        = _desig("Pharmacovigilance Lead")                # L4

        d_ctm_assoc      = _desig("Clinical Trial Associate")              # L1
        d_ctm_mgr        = _desig("Clinical Trial Manager")                # L2
        d_ctm_lead       = _desig("Lead - Clinical Trial Manager")         # L4

        # ============================================================ #
        # 3. USERS                                                      #
        # ============================================================ #
        # Idempotent: re-running won't create duplicates. All passwords
        # are `password123` for stakeholder convenience.
        def _ensure_user(email: str, **kwargs) -> User:
            existing = db.query(User).filter_by(org_id=miltenyi.id, email=email).first()
            if existing:
                return existing
            u = User(
                org_id=miltenyi.id,
                email=email,
                password_hash=pw,
                must_change_password=False,
                **kwargs,
            )
            db.add(u)
            db.commit()
            db.refresh(u)
            return u

        # HR + Mentors are framework-external (no function / designation
        # — they don't sit in a GCC band). Matches seed.py's HR + Mentor
        # rows exactly.

        # ── HR · Healthark (full super-admin) ────────────────────────
        aanya = _ensure_user(
            "aanya.sharma@healthark.ai",
            employee_code="HRK-T01", full_name="Aanya Sharma",
            phone="+91 98000 10001",
            role=Role.HR_MYORG.value,
            function_id=None, designation_id=None,
        )

        # ── HR · Miltenyi (limited admin) ────────────────────────────
        werner = _ensure_user(
            "werner@miltenyi.com",
            employee_code="MIL-T-HR-01", full_name="Werner Fischer",
            phone="+49 30 1234 9001",
            role=Role.HR_MILTENYI.value,
            function_id=None, designation_id=None,
        )

        # ── Mentors (Healthark, Indian names; framework-external) ────
        # Each mentor is themed to one GCC function so their 3 mentees
        # below land in the same function — stakeholders see a coherent
        # team-per-mentor view in the Mentees tab.
        rahul = _ensure_user(
            "rahul.verma@healthark.ai",
            employee_code="HRK-T-M01", full_name="Rahul Verma",
            phone="+91 98000 10010",
            role=Role.MENTOR.value,
            function_id=None, designation_id=None,
        )
        neha = _ensure_user(
            "neha.kapoor@healthark.ai",
            employee_code="HRK-T-M02", full_name="Neha Kapoor",
            phone="+91 98000 10011",
            role=Role.MENTOR.value,
            function_id=None, designation_id=None,
        )
        vikram = _ensure_user(
            "vikram.iyer@healthark.ai",
            employee_code="HRK-T-M03", full_name="Vikram Iyer",
            phone="+91 98000 10012",
            role=Role.MENTOR.value,
            function_id=None, designation_id=None,
        )

        # ── PMs (Miltenyi, German names) — sit in the same GCC ──────
        # functions as their team's mentees so the PM's review queue
        # has actual content.
        stefan = _ensure_user(
            "stefan@miltenyi.com",
            employee_code="MIL-T-PM-01", full_name="Stefan Bauer",
            phone="+49 30 1234 1101",
            role=Role.PM.value,
            function_id=func_ra.id, designation_id=d_ra_lead.id,
        )
        helena = _ensure_user(
            "helena@miltenyi.com",
            employee_code="MIL-T-PM-02", full_name="Helena Vogel",
            phone="+49 30 1234 1102",
            role=Role.PM.value,
            function_id=func_pv.id, designation_id=d_pv_lead.id,
        )
        markus = _ensure_user(
            "markus@miltenyi.com",
            employee_code="MIL-T-PM-03", full_name="Markus Krause",
            phone="+49 30 1234 1103",
            role=Role.PM.value,
            function_id=func_ctm.id, designation_id=d_ctm_lead.id,
        )
        brigitte = _ensure_user(
            "brigitte@miltenyi.com",
            employee_code="MIL-T-PM-04", full_name="Brigitte Hoffmann",
            phone="+49 30 1234 1104",
            role=Role.PM.value,
            function_id=func_ra.id, designation_id=d_ra_lead.id,
        )

        # ── Employees (Miltenyi domain, Indian names) ────────────────
        # 3 mentees per mentor, all sitting in their mentor's function.

        # Rahul's mentees → Regulatory Affairs
        _ensure_user(
            "aarav.patel@miltenyi.com",
            employee_code="MIL-T-S-01", full_name="Aarav Patel",
            phone="+91 98000 10101",
            role=Role.EMPLOYEE.value, mentor_id=rahul.id,
            function_id=func_ra.id, designation_id=d_ra_assoc.id,
        )
        _ensure_user(
            "diya.mehta@miltenyi.com",
            employee_code="MIL-T-S-02", full_name="Diya Mehta",
            phone="+91 98000 10102",
            role=Role.EMPLOYEE.value, mentor_id=rahul.id,
            function_id=func_ra.id, designation_id=d_ra_assoc_sr.id,
        )
        _ensure_user(
            "kabir.singh@miltenyi.com",
            employee_code="MIL-T-S-03", full_name="Kabir Singh",
            phone="+91 98000 10103",
            role=Role.EMPLOYEE.value, mentor_id=rahul.id,
            function_id=func_ra.id, designation_id=d_ra_assoc.id,
        )

        # Neha's mentees → Pharmacovigilance
        _ensure_user(
            "ishaan.joshi@miltenyi.com",
            employee_code="MIL-T-S-04", full_name="Ishaan Joshi",
            phone="+91 98000 10104",
            role=Role.EMPLOYEE.value, mentor_id=neha.id,
            function_id=func_pv.id, designation_id=d_pv_analyst.id,
        )
        _ensure_user(
            "saanvi.reddy@miltenyi.com",
            employee_code="MIL-T-S-05", full_name="Saanvi Reddy",
            phone="+91 98000 10105",
            role=Role.EMPLOYEE.value, mentor_id=neha.id,
            function_id=func_pv.id, designation_id=d_pv_assoc.id,
        )
        _ensure_user(
            "ayaan.khan@miltenyi.com",
            employee_code="MIL-T-S-06", full_name="Ayaan Khan",
            phone="+91 98000 10106",
            role=Role.EMPLOYEE.value, mentor_id=neha.id,
            function_id=func_pv.id, designation_id=d_pv_assoc.id,
        )

        # Vikram's mentees → Clinical Trial Management
        _ensure_user(
            "riya.nair@miltenyi.com",
            employee_code="MIL-T-S-07", full_name="Riya Nair",
            phone="+91 98000 10107",
            role=Role.EMPLOYEE.value, mentor_id=vikram.id,
            function_id=func_ctm.id, designation_id=d_ctm_mgr.id,
        )
        _ensure_user(
            "arjun.gupta@miltenyi.com",
            employee_code="MIL-T-S-08", full_name="Arjun Gupta",
            phone="+91 98000 10108",
            role=Role.EMPLOYEE.value, mentor_id=vikram.id,
            function_id=func_ctm.id, designation_id=d_ctm_assoc.id,
        )
        _ensure_user(
            "myra.desai@miltenyi.com",
            employee_code="MIL-T-S-09", full_name="Myra Desai",
            phone="+91 98000 10109",
            role=Role.EMPLOYEE.value, mentor_id=vikram.id,
            function_id=func_ctm.id, designation_id=d_ctm_assoc.id,
        )
        print("  [+] Users (HR×2, Mentors×3, PMs×4, Employee×9 across 3 of 8 GCC functions)")

        # ============================================================ #
        # 4. SYSTEM SETTINGS                                            #
        # ============================================================ #
        # Demo posture: every gate open, every visibility flag on, and
        # the H1/H2 review-window calendar gate bypassed so stakeholders
        # can fill both halves' goal reviews in one session. Cycle is set
        # to Q1 FY26-27 — to test Q2 / Q3 / Q4 project flows, HR rotates
        # active_cycle_name through them in System Settings.
        if not db.query(SystemSettings).filter(SystemSettings.org_id == miltenyi.id).first():
            db.add(SystemSettings(
                org_id=miltenyi.id,
                active_cycle_name="Q1 FY26-27",
                cycle_type=CycleType.QUARTERLY.value,
                fiscal_start_month=4,
                goals_submission_open=True,
                reviews_submission_open=True,
                goals_edit_enabled=True,
                annual_goals_edit_enabled=True,
                project_ratings_visible=True,
                annual_reviews_enabled=True,
                annual_review_final_rating_visible=True,
                cycle_window_override=True,
                updated_by_id=aanya.id,
            ))
            db.commit()
            print("  [+] System Settings (quarterly, Q1 FY26-27, all gates open, H1/H2 review window bypass on)")
        else:
            print("  [~] System settings already exist; reusing.")

        # ============================================================ #
        # 5. ROLE EXPECTATIONS                                          #
        # ============================================================ #
        # 32 GCC rows (8 functions × 4 career levels) imported verbatim
        # from seed_data.gcc.GCC_ROLE_EXPECTATIONS. Keyed on
        # (function_id, career_level) — the GCC migration replaced the
        # old per-designation FK. Each Designation's career_level is
        # what links a user's title to the matching expectations row,
        # so multiple titles at one band point at one expectations row.
        #
        # Re-runs are no-ops because of the count() guard.
        if db.query(RoleExpectation).filter(RoleExpectation.org_id == miltenyi.id).count() == 0:
            inserted = 0
            for (func_name, career_level), fields in GCC_ROLE_EXPECTATIONS.items():
                fn = db.query(Function).filter_by(org_id=miltenyi.id, name=func_name).first()
                if not fn:
                    continue
                db.add(RoleExpectation(
                    org_id=miltenyi.id,
                    function_id=fn.id,
                    career_level=career_level,
                    **fields,
                ))
                inserted += 1
            db.commit()
            print(f"  [+] Role Expectations: {inserted} rows (8 functions × 4 career levels)")
        else:
            print("  [~] Role expectations already exist; reusing.")

        # ============================================================ #
        # DONE                                                          #
        # ============================================================ #
        print("\n" + "=" * 64)
        print("Demo seed complete.")
        print("=" * 64)
        print("\n--- ACCOUNTS (all passwords: password123) ---")
        print("\n  HR")
        print("    Healthark : aanya.sharma@healthark.ai     Aanya Sharma     (HR_MyOrg / super-admin)")
        print("    Miltenyi  : werner@miltenyi.com           Werner Fischer   (HR_Miltenyi / limited)")
        print("\n  Mentors (Healthark)")
        print("    rahul.verma@healthark.ai     Rahul Verma     (mentors Aarav, Diya, Kabir — Regulatory Affairs)")
        print("    neha.kapoor@healthark.ai     Neha Kapoor     (mentors Ishaan, Saanvi, Ayaan — Pharmacovigilance)")
        print("    vikram.iyer@healthark.ai     Vikram Iyer     (mentors Riya, Arjun, Myra — Clinical Trial Mgmt)")
        print("\n  PMs (Miltenyi)")
        print("    stefan@miltenyi.com          Stefan Bauer    (Regulatory Affairs)")
        print("    brigitte@miltenyi.com        Brigitte Hoffmann (Regulatory Affairs)")
        print("    helena@miltenyi.com          Helena Vogel    (Pharmacovigilance)")
        print("    markus@miltenyi.com          Markus Krause   (Clinical Trial Management)")
        print("\n  Employees (Miltenyi domain, Healthark mentees)")
        print("    Regulatory Affairs        : aarav.patel@,    diya.mehta@,    kabir.singh@miltenyi.com")
        print("    Pharmacovigilance         : ishaan.joshi@,   saanvi.reddy@,  ayaan.khan@miltenyi.com")
        print("    Clinical Trial Management : riya.nair@,      arjun.gupta@,   myra.desai@miltenyi.com")
        print()
        print("  Other 5 GCC functions (Clinical Data Management, Biostatistics,")
        print("  Medical Writing, Clinical Trial Finance, Legal) are seeded with")
        print("  designations + expectations but no users — stakeholders add users")
        print("  to them while exploring the admin panel.")
        print()
        print("  No projects, goals, or reviews seeded — stakeholders create those.")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_test_database()
