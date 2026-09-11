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
    - SystemSettings tuned for demo (half-yearly; FY26-27 gates open, ratings visible)
    - 13 users, all @healthark.ai (only Healthark staff use the app):
        1  Admin   (Healthark HR)
        3  Mentors (themed by function)
        9  Staff   (3 mentees per mentor; clustered into 3 of the 8 GCC
                   functions so each mentor's team sits in one function).
                   Each carries the NAME of their Miltenyi reviewer — the
                   Miltenyi manager whose project-goal comments the mentor
                   types in; Miltenyi staff never log in.
    - Project Goals framework: 28 rows (7 functions × 4 levels) from the
      Miltenyi "CY 2026 INDICATIVE GOAL THEMES" PDFs (`seed_data.goal_themes`),
      the "CY 2026" period settings (active; goal entry open; weightages
      visible; current quarter Q3 with Q1–Q3 rolled out, ratings hidden),
      Designation → Function links,
      and a Miltenyi reviewer name on each Employee (their function's PM).
      No goal sets — stakeholders create those.
    - Role expectations: 32 rows (8 functions × 4 career levels) imported
      verbatim from `seed_data.gcc.GCC_ROLE_EXPECTATIONS`. Keyed on
      (function, career_level) — the gcc_framework_replacement migration
      (f7c4a9e2b5d1) replaced the old per-designation FK + 8-column PMS
      framework with this shape.

Functions with seeded users (3 of 8):
    Regulatory Affairs        — Rahul's mentees (Miltenyi reviewer Stefan Bauer)
    Pharmacovigilance         — Neha's mentees (Miltenyi reviewer Helena Vogel)
    Clinical Trial Management — Vikram's mentees (Miltenyi reviewer Markus Krause)

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
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.role_expectation_models import RoleExpectation
from app.models.project_goal_models import (
    GoalFramework, GoalFrameworkKpi, ProjectGoalPeriodSettings, ProjectGoalQuarter, quarter_label,
)

# Shared GCC career-path content (functions, designations, role-expectation
# prose). Same source as seed.py — edits to the framework happen in
# seed_data/gcc.py and propagate to both seeds.
from seed_data.gcc import (
    LEVEL_LABEL,
    GCC_DESIGNATIONS,
    GCC_ROLE_EXPECTATIONS,
)
from seed_data.goal_themes import GOAL_THEMES, PERIOD_LABEL

# `project_reviews` is deliberately absent: the per-project PM review queue
# is retired for the Miltenyi instance in favour of `project_goals` (Sep 2026
# stakeholder decision). The code stays; the server-side gate hides it.
ENABLED_FEATURES = (
    "dashboard", "goals", "project_goals", "annual_reviews", "mentoring", "admin",
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
                enabled_features=list(ENABLED_FEATURES),
            )
            db.add(miltenyi)
            db.commit()
            db.refresh(miltenyi)
            print("  [+] Organization: Miltenyi")
        else:
            # Keep the feature list current on re-runs: the server-side
            # gate reads it, so a stale list would hide Project Goals.
            if list(miltenyi.enabled_features or []) != list(ENABLED_FEATURES):
                miltenyi.enabled_features = list(ENABLED_FEATURES)
                db.commit()
                print("  [~] Organization 'Miltenyi' already exists; feature list refreshed.")
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
            fn_ids = {f.name: f.id for f in db.query(Function).filter_by(org_id=miltenyi.id)}

            for fname, lvl, titles in GCC_DESIGNATIONS:
                for title in titles:
                    db.add(Designation(
                        org_id=miltenyi.id,
                        name=title,
                        level=lvl,                       # legacy sort, matches band for now
                        career_level=lvl,
                        career_level_label=LEVEL_LABEL[lvl],
                        function_id=fn_ids.get(fname),   # Project Goals: function × level → framework row
                    ))
            db.commit()
            print(f"  [+] {len(gcc_function_names)} GCC Functions and "
                  f"{sum(len(t) for _, _, t in GCC_DESIGNATIONS)} Designations")
        else:
            print("  [~] Reference data already exists; reusing.")

        # Designation → Function link (added with Project Goals). Backfill
        # by title on databases seeded before the column existed.
        fn_ids = {f.name: f.id for f in db.query(Function).filter_by(org_id=miltenyi.id)}
        title_fn = {title: fname for fname, _, titles in GCC_DESIGNATIONS for title in titles}
        linked = 0
        for d in db.query(Designation).filter_by(org_id=miltenyi.id, function_id=None):
            fid = fn_ids.get(title_fn.get(d.name, ""))
            if fid:
                d.function_id = fid
                linked += 1
        if linked:
            db.commit()
            print(f"  [~] Linked {linked} designations to their functions")

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

        d_pv_assoc       = _desig("Pharmacovigilance Associate")           # L1
        d_pv_analyst     = _desig("Pharmacovigilance Analyst")             # L2

        d_ctm_assoc      = _desig("Clinical Trial Associate")              # L1
        d_ctm_mgr        = _desig("Clinical Trial Manager")                # L2

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

        # ── Admin (Healthark HR) ─────────────────────────────────────
        aanya = _ensure_user(
            "aanya.sharma@healthark.ai",
            employee_code="HRK-T01", full_name="Aanya Sharma",
            phone="+91 98000 10001",
            role=Role.ADMIN.value,
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

        # ── Staff (Healthark employees placed on Miltenyi work) ──────
        # 3 mentees per mentor, all sitting in their mentor's function.

        # Rahul's mentees → Regulatory Affairs
        _ensure_user(
            "aarav.patel@healthark.ai",
            employee_code="HRK-T-S-01", full_name="Aarav Patel",
            phone="+91 98000 10101",
            role=Role.STAFF.value, mentor_id=rahul.id,
            function_id=func_ra.id, designation_id=d_ra_assoc.id,
        )
        _ensure_user(
            "diya.mehta@healthark.ai",
            employee_code="HRK-T-S-02", full_name="Diya Mehta",
            phone="+91 98000 10102",
            role=Role.STAFF.value, mentor_id=rahul.id,
            function_id=func_ra.id, designation_id=d_ra_assoc_sr.id,
        )
        _ensure_user(
            "kabir.singh@healthark.ai",
            employee_code="HRK-T-S-03", full_name="Kabir Singh",
            phone="+91 98000 10103",
            role=Role.STAFF.value, mentor_id=rahul.id,
            function_id=func_ra.id, designation_id=d_ra_assoc.id,
        )

        # Neha's mentees → Pharmacovigilance
        _ensure_user(
            "ishaan.joshi@healthark.ai",
            employee_code="HRK-T-S-04", full_name="Ishaan Joshi",
            phone="+91 98000 10104",
            role=Role.STAFF.value, mentor_id=neha.id,
            function_id=func_pv.id, designation_id=d_pv_analyst.id,
        )
        _ensure_user(
            "saanvi.reddy@healthark.ai",
            employee_code="HRK-T-S-05", full_name="Saanvi Reddy",
            phone="+91 98000 10105",
            role=Role.STAFF.value, mentor_id=neha.id,
            function_id=func_pv.id, designation_id=d_pv_assoc.id,
        )
        _ensure_user(
            "ayaan.khan@healthark.ai",
            employee_code="HRK-T-S-06", full_name="Ayaan Khan",
            phone="+91 98000 10106",
            role=Role.STAFF.value, mentor_id=neha.id,
            function_id=func_pv.id, designation_id=d_pv_assoc.id,
        )

        # Vikram's mentees → Clinical Trial Management
        _ensure_user(
            "riya.nair@healthark.ai",
            employee_code="HRK-T-S-07", full_name="Riya Nair",
            phone="+91 98000 10107",
            role=Role.STAFF.value, mentor_id=vikram.id,
            function_id=func_ctm.id, designation_id=d_ctm_mgr.id,
        )
        _ensure_user(
            "arjun.gupta@healthark.ai",
            employee_code="HRK-T-S-08", full_name="Arjun Gupta",
            phone="+91 98000 10108",
            role=Role.STAFF.value, mentor_id=vikram.id,
            function_id=func_ctm.id, designation_id=d_ctm_assoc.id,
        )
        _ensure_user(
            "myra.desai@healthark.ai",
            employee_code="HRK-T-S-09", full_name="Myra Desai",
            phone="+91 98000 10109",
            role=Role.STAFF.value, mentor_id=vikram.id,
            function_id=func_ctm.id, designation_id=d_ctm_assoc.id,
        )
        print("  [+] Users (Admin×1, Mentors×3, Staff×9 across 3 of 8 GCC functions)")

        # ============================================================ #
        # 4. SYSTEM SETTINGS                                            #
        # ============================================================ #
        # Demo posture: half-yearly cadence (H1/H2 goal reviews, FY annual
        # reviews), every per-FY gate open and every rating visible, and the
        # H1/H2 review-window calendar gate bypassed so stakeholders can fill
        # both halves in one session.
        if not db.query(SystemSettings).filter(SystemSettings.org_id == miltenyi.id).first():
            db.add(SystemSettings(
                org_id=miltenyi.id,
                active_cycle_name="H1 FY26-27",
                cycle_type=CycleType.HALF_YEARLY.value,
                fiscal_start_month=4,
                timezone="Asia/Kolkata",
                cycle_window_override=True,
                updated_by_id=aanya.id,
            ))
            db.commit()
            print("  [+] System Settings (half-yearly, H1 FY26-27, Asia/Kolkata, H1/H2 review window bypass on)")
        else:
            print("  [~] System settings already exist; reusing.")

        # Per-FY access toggles live on their own table (one row per FY).
        if not db.query(SystemSettingsYearOverride).filter_by(org_id=miltenyi.id, fy_label="FY26-27").first():
            db.add(SystemSettingsYearOverride(
                org_id=miltenyi.id, fy_label="FY26-27",
                annual_reviews_enabled=True,
                annual_review_final_rating_visible=True,
                annual_goals_edit_enabled=True,
                updated_by_id=aanya.id,
            ))
            db.commit()
            print("  [+] FY26-27 access toggles: annual reviews open, ratings visible, annual-goal editing on")
        else:
            print("  [~] FY26-27 access toggles already exist; reusing.")

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
        # 6. PROJECT GOALS FRAMEWORK (CY 2026 indicative goal themes)   #
        # ============================================================ #
        # 7 of the 8 functions have a Miltenyi goal-themes PDF; each has
        # 4 role/level rows (title, two illustrative paragraphs, KPIs
        # with weightages totalling 100). Pharmacovigilance has none —
        # its employees see a "no framework yet" notice until HR adds
        # rows in Admin → Framework. No goal sets are seeded.
        if db.query(GoalFramework).filter(GoalFramework.org_id == miltenyi.id).count() == 0:
            fw_rows = 0
            for func_name, levels in GOAL_THEMES.items():
                fn = db.query(Function).filter_by(org_id=miltenyi.id, name=func_name).first()
                if not fn:
                    continue
                for level, row in levels.items():
                    fw = GoalFramework(
                        org_id=miltenyi.id, function_id=fn.id, level=level, period_label=PERIOD_LABEL,
                        title=row["title"], business_outcomes=row["business_outcomes"],
                        functional_goals=row["functional_goals"], created_by_id=aanya.id,
                    )
                    db.add(fw)
                    db.flush()
                    for seq, (text, weight) in enumerate(row["kpis"], start=1):
                        db.add(GoalFrameworkKpi(framework_id=fw.id, seq=seq, text=text, weightage=weight))
                    fw_rows += 1
            db.commit()
            print(f"  [+] Project Goals framework: {fw_rows} rows for {PERIOD_LABEL} (7 functions × 4 levels)")
        else:
            print("  [~] Project Goals framework already exists; reusing.")

        # The review window is the Admin-advanced current quarter (Healthark PMS
        # roll-out model). UAT starts in Q3 CY 2026 with Q1–Q3 rolled out, so
        # testers can backfill earlier quarters and roll Q4 out themselves.
        CURRENT_QUARTER = 3
        if not db.query(ProjectGoalPeriodSettings).filter_by(org_id=miltenyi.id, period_label=PERIOD_LABEL).first():
            db.add(ProjectGoalPeriodSettings(
                org_id=miltenyi.id, period_label=PERIOD_LABEL, is_active=True,
                entry_open=True, weightages_visible=True, current_quarter_seq=CURRENT_QUARTER,
                updated_by_id=aanya.id,
            ))
            for seq in range(1, CURRENT_QUARTER + 1):
                db.add(ProjectGoalQuarter(
                    org_id=miltenyi.id, period_label=PERIOD_LABEL, seq=seq,
                    cycle_label=quarter_label(PERIOD_LABEL, seq), ratings_visible=False, opened_by_id=aanya.id,
                ))
            db.commit()
            print(f"  [+] Project Goals period {PERIOD_LABEL}: active, goal entry open, weightages visible, current quarter Q{CURRENT_QUARTER} (Q1–Q{CURRENT_QUARTER} rolled out, ratings hidden)")
        else:
            print("  [~] Project Goals period settings already exist; reusing.")

        # Miltenyi reviewer of each Staff member = the Miltenyi lead of their function.
        # Names only — Miltenyi staff never log in for Project Goals; the
        # mentor enters their comments. Set only where still blank so HR
        # edits in Admin → Framework Mapping survive re-runs.
        reviewer_by_function = {
            func_ra.id: "Stefan Bauer", func_pv.id: "Helena Vogel", func_ctm.id: "Markus Krause",
        }
        named = 0
        for u in db.query(User).filter_by(org_id=miltenyi.id, role=Role.STAFF.value, miltenyi_reviewer_name=None):
            name = reviewer_by_function.get(u.function_id)
            if name:
                u.miltenyi_reviewer_name = name
                named += 1
        if named:
            db.commit()
            print(f"  [+] Miltenyi reviewer names on {named} employees")

        # ============================================================ #
        # DONE                                                          #
        # ============================================================ #
        print("\n" + "=" * 64)
        print("Demo seed complete.")
        print("=" * 64)
        print("\n--- ACCOUNTS (all passwords: password123) ---")
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
        print("  Other 5 GCC functions (Clinical Data Management, Biostatistics,")
        print("  Medical Writing, Clinical Trial Finance, Legal) are seeded with")
        print("  designations + expectations but no users — stakeholders add users")
        print("  to them while exploring the admin panel.")
        print()
        print("  No projects, goals, or reviews seeded — stakeholders create those.")
        print()
        print("  Project Goals (CY 2026): framework rows for 7 functions are loaded")
        print("  from the Miltenyi goal-themes PDFs; Pharmacovigilance has none, so")
        print("  Neha's mentees see the 'no framework yet' notice until HR adds rows")
        print("  in Admin → Framework. No goal sets seeded — employees start their own.")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_test_database()
