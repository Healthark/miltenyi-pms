"""
miltenyi-test-seed.py — Minimal demo-instance seed.

Goal: stand up a clean Miltenyi PMS instance with just enough data for
stakeholders to log in, navigate every page, and exercise the role-driven
flows. NO operational data — no projects, no goals, no reviews, no
project assignments. Stakeholders create those themselves while testing
so we get fresh observations.

What this seeds (and only this):
    - The Miltenyi organization
    - Reference data:
        Functions    — R&D, Manufacturing, Commercial
        Designations — Scientist (L1 Entry) / Senior Scientist (L2 Mid)
                       / Team Lead (L3 Senior) / Director (L4 Lead)
                       — each carries `career_level` so the GCC role-
                       expectations lookup resolves.
    - SystemSettings tuned for demo (all gates open, ratings visible)
    - 18 users:
        2  HR  — 1 Healthark (HR_MyOrg, Indian name) + 1 Miltenyi (HR_Miltenyi, German)
        3  Mentors (Healthark, Indian names)
        4  PMs    (Miltenyi, German names)
        9  Employee  (Miltenyi domain, Indian names — 3 mentees per mentor)
    - Role expectations: 3 functions × 4 career levels = 12 rows on
      the GCC 6-column schema (exp_scope_of_role,
      exp_key_responsibilities, exp_technical_competencies,
      exp_delivery_ownership, exp_regulatory_compliance,
      exp_project_resource_management). Keyed on (function,
      career_level) — the gcc_framework_replacement migration
      (f7c4a9e2b5d1) replaced the old per-designation FK + 8-column
      PMS framework with this shape.

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


# Per-(function × career_level) prose for the GCC role-expectations
# framework. Six content columns parallel the model (exp_scope_of_role
# / exp_key_responsibilities / exp_technical_competencies /
# exp_delivery_ownership / exp_regulatory_compliance /
# exp_project_resource_management).
#
# Keyed on integer career_level (1=Entry, 2=Mid, 3=Senior, 4=Lead),
# NOT designation name, because RoleExpectation rows are keyed on
# (function_id, career_level) after the GCC migration (f7c4a9e2b5d1).
# Multiple Designations at the same band would point at the same row;
# in this seed we have one Designation per band so it's a clean 1:1.
EXPECTATIONS: dict[str, dict[int, dict[str, str]]] = {
    "R&D": {
        1: {  # Scientist — Entry
            "exp_scope_of_role": "Entry-level scientist supporting bench experiments and analytical assays under senior guidance.",
            "exp_key_responsibilities": "Runs assigned wet-lab and analytical tasks, maintains lab notebooks, performs data entry validation, and supports protocol execution.",
            "exp_technical_competencies": "Foundational wet-lab technique, basic instrument operation, accurate data capture in ELN, adherence to GLP standards.",
            "exp_delivery_ownership": "Accountable for accuracy and timeliness of own experimental tasks and the cleanliness of submitted data.",
            "exp_regulatory_compliance": "Follows GLP / SOP requirements as trained; flags deviations to a senior scientist without delay.",
            "exp_project_resource_management": "Manages own time across assigned experiments; tracks consumable usage and orders within budget guidance.",
        },
        2: {  # Senior Scientist — Mid
            "exp_scope_of_role": "Independently designs and executes moderately complex experiments; owns workstreams within a project.",
            "exp_key_responsibilities": "Plans experimental design, troubleshoots assays, authors method documents, and reviews data from junior scientists.",
            "exp_technical_competencies": "SME in one platform or assay class; growing breadth across adjacent technologies; statistical interpretation of results.",
            "exp_delivery_ownership": "Owns delivery of one or more workstreams end-to-end; signs off own data and reviews datasets from juniors.",
            "exp_regulatory_compliance": "Maintains GLP rigor across the workstream; authors CAPA documentation for deviations they own.",
            "exp_project_resource_management": "Plans experiment timelines, manages reagent supply, and coordinates with cross-functional partners on dependencies.",
        },
        3: {  # Team Lead — Senior
            "exp_scope_of_role": "Leads scientific direction and protocol design for the team; balances rigor with delivery timelines.",
            "exp_key_responsibilities": "Sets team-level experimental strategy, reviews and signs off regulatory-grade deliverables, manages stakeholder communication.",
            "exp_technical_competencies": "Recognised expert in the team's platform area; mentors emerging SMEs and shapes technical direction.",
            "exp_delivery_ownership": "Accountable for team-level project outcomes, milestone delivery, and quality of regulatory-grade outputs.",
            "exp_regulatory_compliance": "Owns regulatory readiness for the team's outputs; final reviewer on submission-ready documents.",
            "exp_project_resource_management": "Owns project plan, milestones, budget, headcount, and stakeholder governance across the team's portfolio.",
        },
        4: {  # Director — Lead
            "exp_scope_of_role": "Sets R&D portfolio strategy and capability roadmap across multiple teams.",
            "exp_key_responsibilities": "Defines therapeutic-area focus, owns build-vs-buy decisions on platforms, and represents R&D in leadership reviews.",
            "exp_technical_competencies": "Strategic technical depth across multiple platforms; external thought leadership in the field.",
            "exp_delivery_ownership": "Accountable for portfolio outcomes — programs delivered, capability uplift, and team retention.",
            "exp_regulatory_compliance": "Owns the R&D function's regulatory posture; engages with health authorities on key submissions.",
            "exp_project_resource_management": "Owns multi-team budget, capital decisions, and senior hiring across the function.",
        },
    },
    "Manufacturing": {
        1: {  # Scientist — Entry
            "exp_scope_of_role": "Entry-level production / QC operator running routine GMP tasks under shift supervision.",
            "exp_key_responsibilities": "Performs routine production and QC tasks, completes batch records, and raises deviations promptly.",
            "exp_technical_competencies": "Foundational aseptic technique, cleanroom protocols, basic instrument operation, batch record accuracy.",
            "exp_delivery_ownership": "Accountable for shift-level task completion and documentation integrity on assigned process steps.",
            "exp_regulatory_compliance": "Strict adherence to GMP / SOPs; escalates deviations to shift supervisor without delay.",
            "exp_project_resource_management": "Manages own shift workload; tracks consumable usage and reports inventory needs.",
        },
        2: {  # Senior Scientist — Mid
            "exp_scope_of_role": "Owns process improvements and root-cause analysis across one or more product lines.",
            "exp_key_responsibilities": "Drives a workstream across product lines, runs production planning, and authors validation / CAPA documentation.",
            "exp_technical_competencies": "Deep expertise in one production platform; cross-functional coordination with R&D on tech-transfer.",
            "exp_delivery_ownership": "Owns workstream-level KPIs (throughput, yield, deviation rate) and the quality of validation documentation.",
            "exp_regulatory_compliance": "Authors and reviews validation reports; co-leads CAPA closure with QA.",
            "exp_project_resource_management": "Coordinates with R&D on tech-transfer and runs production planning across shifts.",
        },
        3: {  # Team Lead — Senior
            "exp_scope_of_role": "Sets manufacturing strategy for the line and owns regulatory readiness.",
            "exp_key_responsibilities": "Owns line-level KPIs, leads cross-functional production reviews, signs off audit-ready documentation.",
            "exp_technical_competencies": "Recognised authority on the line's platforms; sets technical and SOP standards for the team.",
            "exp_delivery_ownership": "Accountable for line-level throughput, yield, and deviation rate; final sign-off on validation and CAPA.",
            "exp_regulatory_compliance": "Owns regulatory and customer-facing communications for the line; readiness for audits.",
            "exp_project_resource_management": "Owns multi-site programs end-to-end with budget accountability and headcount planning.",
        },
        4: {  # Director — Lead
            "exp_scope_of_role": "Sets manufacturing strategy across sites and product lines.",
            "exp_key_responsibilities": "Defines capacity strategy, owns capital investment decisions, and represents Mfg in leadership reviews.",
            "exp_technical_competencies": "Strategic depth across platforms and modalities; external benchmarking on operational excellence.",
            "exp_delivery_ownership": "Accountable for site-level financial performance, regulatory posture, and capability uplift.",
            "exp_regulatory_compliance": "Owns the Mfg function's regulatory posture; engages with health authorities on inspection findings.",
            "exp_project_resource_management": "Owns multi-site budget, capital decisions, and senior hiring across the function.",
        },
    },
    "Commercial": {
        1: {  # Scientist — Entry
            "exp_scope_of_role": "Entry-level commercial associate supporting market analysis and customer onboarding.",
            "exp_key_responsibilities": "Maintains opportunity trackers, supports pitch material creation, runs CRM hygiene.",
            "exp_technical_competencies": "Foundational commercial systems, CRM proficiency, product fundamentals; growing customer-call confidence.",
            "exp_delivery_ownership": "Accountable for accuracy of tracker data and timeliness of customer-ready collateral.",
            "exp_regulatory_compliance": "Adheres to internal compliance policies on customer communications and data handling.",
            "exp_project_resource_management": "Manages own task list across accounts and reporting cadences.",
        },
        2: {  # Senior Scientist — Mid
            "exp_scope_of_role": "Independently scopes and runs customer engagements across one region or segment.",
            "exp_key_responsibilities": "Owns regional pipeline, drives launch readiness across stakeholders, crafts strategy briefs.",
            "exp_technical_competencies": "SME in a product line or therapeutic area; growing strategic breadth.",
            "exp_delivery_ownership": "Owns regional quota and pipeline accountability; sign-off on pitch material in their region.",
            "exp_regulatory_compliance": "Ensures commercial activities comply with promotion and pricing policies.",
            "exp_project_resource_management": "Manages a portfolio of accounts and coordinates cross-functional resources for major opportunities.",
        },
        3: {  # Team Lead — Senior
            "exp_scope_of_role": "Sets commercial strategy across multiple regions and product lines.",
            "exp_key_responsibilities": "Owns regional pipeline, revenue, and customer satisfaction; leads launch programs end-to-end.",
            "exp_technical_competencies": "Recognised authority on the region or segment; sets commercial playbooks for the team.",
            "exp_delivery_ownership": "Accountable for regional revenue, customer satisfaction, and team performance against quotas.",
            "exp_regulatory_compliance": "Owns enforcement of commercial compliance policies across the team; final reviewer on enterprise proposals.",
            "exp_project_resource_management": "Owns launch programs end-to-end with cross-functional governance and budget responsibility.",
        },
        4: {  # Director — Lead
            "exp_scope_of_role": "Sets global go-to-market strategy across business units.",
            "exp_key_responsibilities": "Defines therapeutic-area positioning, owns major customer relationships, leads commercial transformation.",
            "exp_technical_competencies": "Strategic depth on global commercial models; external thought leadership in the field.",
            "exp_delivery_ownership": "Accountable for global commercial performance, brand strategy, and channel build.",
            "exp_regulatory_compliance": "Owns the Commercial function's regulatory and compliance posture across markets.",
            "exp_project_resource_management": "Owns global commercial budget, talent strategy, and major customer relationships.",
        },
    },
}


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
        # 2. FUNCTIONS & DESIGNATIONS                                   #
        # ============================================================ #
        if db.query(Function).filter(Function.org_id == miltenyi.id).count() == 0:
            # Designations carry both `level` (legacy 1..4 sort key kept
            # for back-compat) and `career_level` / `career_level_label`
            # (the GCC band that RoleExpectation rows are keyed on). The
            # /me/expectations API resolves expectations via
            # designation.career_level — without these set, the panel
            # falls back to "Role expectation not defined".
            db.add_all([
                Function(org_id=miltenyi.id, name="R&D"),
                Function(org_id=miltenyi.id, name="Manufacturing"),
                Function(org_id=miltenyi.id, name="Commercial"),
                Designation(org_id=miltenyi.id, name="Scientist",
                            level=1, career_level=1, career_level_label="Entry"),
                Designation(org_id=miltenyi.id, name="Senior Scientist",
                            level=2, career_level=2, career_level_label="Mid"),
                Designation(org_id=miltenyi.id, name="Team Lead",
                            level=3, career_level=3, career_level_label="Senior"),
                Designation(org_id=miltenyi.id, name="Director",
                            level=4, career_level=4, career_level_label="Lead"),
            ])
            db.commit()
            print("  [+] Functions & Designations")
        else:
            print("  [~] Reference data already exists; reusing.")

        func_rnd = db.query(Function).filter_by(org_id=miltenyi.id, name="R&D").first()
        func_mfg = db.query(Function).filter_by(org_id=miltenyi.id, name="Manufacturing").first()
        func_com = db.query(Function).filter_by(org_id=miltenyi.id, name="Commercial").first()

        d_sci  = db.query(Designation).filter_by(org_id=miltenyi.id, name="Scientist").first()
        d_sr   = db.query(Designation).filter_by(org_id=miltenyi.id, name="Senior Scientist").first()
        d_lead = db.query(Designation).filter_by(org_id=miltenyi.id, name="Team Lead").first()
        d_dir  = db.query(Designation).filter_by(org_id=miltenyi.id, name="Director").first()

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

        # ── HR · Healthark (full super-admin) ────────────────────────
        aanya = _ensure_user(
            "aanya.sharma@healthark.ai",
            employee_code="HRK-T01", full_name="Aanya Sharma",
            phone="+91 98000 10001",
            role=Role.HR_MYORG.value,
            function_id=None, designation_id=d_dir.id,
        )

        # ── HR · Miltenyi (limited admin) ────────────────────────────
        werner = _ensure_user(
            "werner@miltenyi.com",
            employee_code="MIL-T-HR-01", full_name="Werner Fischer",
            phone="+49 30 1234 9001",
            role=Role.HR_MILTENYI.value,
            function_id=None, designation_id=d_dir.id,
        )

        # ── Mentors (Healthark, Indian names) ────────────────────────
        rahul = _ensure_user(
            "rahul.verma@healthark.ai",
            employee_code="HRK-T-M01", full_name="Rahul Verma",
            phone="+91 98000 10010",
            role=Role.MENTOR.value,
            function_id=None, designation_id=d_dir.id,
        )
        neha = _ensure_user(
            "neha.kapoor@healthark.ai",
            employee_code="HRK-T-M02", full_name="Neha Kapoor",
            phone="+91 98000 10011",
            role=Role.MENTOR.value,
            function_id=None, designation_id=d_dir.id,
        )
        vikram = _ensure_user(
            "vikram.iyer@healthark.ai",
            employee_code="HRK-T-M03", full_name="Vikram Iyer",
            phone="+91 98000 10012",
            role=Role.MENTOR.value,
            function_id=None, designation_id=d_dir.id,
        )

        # ── PMs (Miltenyi, non-Indian names) ─────────────────────────
        stefan = _ensure_user(
            "stefan@miltenyi.com",
            employee_code="MIL-T-PM-01", full_name="Stefan Bauer",
            phone="+49 30 1234 1101",
            role=Role.PM.value,
            function_id=func_rnd.id, designation_id=d_lead.id,
        )
        helena = _ensure_user(
            "helena@miltenyi.com",
            employee_code="MIL-T-PM-02", full_name="Helena Vogel",
            phone="+49 30 1234 1102",
            role=Role.PM.value,
            function_id=func_mfg.id, designation_id=d_lead.id,
        )
        markus = _ensure_user(
            "markus@miltenyi.com",
            employee_code="MIL-T-PM-03", full_name="Markus Krause",
            phone="+49 30 1234 1103",
            role=Role.PM.value,
            function_id=func_com.id, designation_id=d_lead.id,
        )
        brigitte = _ensure_user(
            "brigitte@miltenyi.com",
            employee_code="MIL-T-PM-04", full_name="Brigitte Hoffmann",
            phone="+49 30 1234 1104",
            role=Role.PM.value,
            function_id=func_rnd.id, designation_id=d_lead.id,
        )

        # ── Employee (Miltenyi domain, Indian names; 3 mentees per mentor) ──
        # Rahul's mentees — R&D
        _ensure_user(
            "aarav.patel@miltenyi.com",
            employee_code="MIL-T-S-01", full_name="Aarav Patel",
            phone="+91 98000 10101",
            role=Role.EMPLOYEE.value, mentor_id=rahul.id,
            function_id=func_rnd.id, designation_id=d_sci.id,
        )
        _ensure_user(
            "diya.mehta@miltenyi.com",
            employee_code="MIL-T-S-02", full_name="Diya Mehta",
            phone="+91 98000 10102",
            role=Role.EMPLOYEE.value, mentor_id=rahul.id,
            function_id=func_rnd.id, designation_id=d_sr.id,
        )
        _ensure_user(
            "kabir.singh@miltenyi.com",
            employee_code="MIL-T-S-03", full_name="Kabir Singh",
            phone="+91 98000 10103",
            role=Role.EMPLOYEE.value, mentor_id=rahul.id,
            function_id=func_rnd.id, designation_id=d_sci.id,
        )

        # Neha's mentees — Manufacturing
        _ensure_user(
            "ishaan.joshi@miltenyi.com",
            employee_code="MIL-T-S-04", full_name="Ishaan Joshi",
            phone="+91 98000 10104",
            role=Role.EMPLOYEE.value, mentor_id=neha.id,
            function_id=func_mfg.id, designation_id=d_sr.id,
        )
        _ensure_user(
            "saanvi.reddy@miltenyi.com",
            employee_code="MIL-T-S-05", full_name="Saanvi Reddy",
            phone="+91 98000 10105",
            role=Role.EMPLOYEE.value, mentor_id=neha.id,
            function_id=func_mfg.id, designation_id=d_sci.id,
        )
        _ensure_user(
            "ayaan.khan@miltenyi.com",
            employee_code="MIL-T-S-06", full_name="Ayaan Khan",
            phone="+91 98000 10106",
            role=Role.EMPLOYEE.value, mentor_id=neha.id,
            function_id=func_mfg.id, designation_id=d_sci.id,
        )

        # Vikram's mentees — Commercial
        _ensure_user(
            "riya.nair@miltenyi.com",
            employee_code="MIL-T-S-07", full_name="Riya Nair",
            phone="+91 98000 10107",
            role=Role.EMPLOYEE.value, mentor_id=vikram.id,
            function_id=func_com.id, designation_id=d_sr.id,
        )
        _ensure_user(
            "arjun.gupta@miltenyi.com",
            employee_code="MIL-T-S-08", full_name="Arjun Gupta",
            phone="+91 98000 10108",
            role=Role.EMPLOYEE.value, mentor_id=vikram.id,
            function_id=func_com.id, designation_id=d_sci.id,
        )
        _ensure_user(
            "myra.desai@miltenyi.com",
            employee_code="MIL-T-S-09", full_name="Myra Desai",
            phone="+91 98000 10109",
            role=Role.EMPLOYEE.value, mentor_id=vikram.id,
            function_id=func_com.id, designation_id=d_sci.id,
        )
        print("  [+] Users (HR×2, Mentors×3, PMs×4, Employee×9)")

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
        # Reference text PMs see while writing project review comments,
        # and the Role Expectations panel each user sees on their own
        # profile. Rows are keyed on (function_id, career_level) — the
        # GCC migration replaced the old per-designation FK. Each
        # Designation's career_level is what links a user's title to
        # the matching expectations row.
        #
        # Re-runs are no-ops because of the count() guard.
        if db.query(RoleExpectation).filter(RoleExpectation.org_id == miltenyi.id).count() == 0:
            inserted = 0
            for func_name, by_level in EXPECTATIONS.items():
                fn = db.query(Function).filter_by(org_id=miltenyi.id, name=func_name).first()
                if not fn:
                    continue
                for career_level, comp in by_level.items():
                    db.add(RoleExpectation(
                        org_id=miltenyi.id,
                        function_id=fn.id,
                        career_level=career_level,
                        **comp,
                    ))
                    inserted += 1
            db.commit()
            print(f"  [+] Role Expectations: {inserted} rows (3 functions × 4 career levels)")
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
        print("    rahul.verma@healthark.ai     Rahul Verma     (mentors Aarav, Diya, Kabir)")
        print("    neha.kapoor@healthark.ai     Neha Kapoor     (mentors Ishaan, Saanvi, Ayaan)")
        print("    vikram.iyer@healthark.ai     Vikram Iyer     (mentors Riya, Arjun, Myra)")
        print("\n  PMs (Miltenyi)")
        print("    stefan@miltenyi.com          Stefan Bauer    (R&D)")
        print("    helena@miltenyi.com          Helena Vogel    (Manufacturing)")
        print("    markus@miltenyi.com          Markus Krause   (Commercial)")
        print("    brigitte@miltenyi.com        Brigitte Hoffmann (R&D)")
        print("\n  Employee (Miltenyi domain, Healthark mentees)")
        print("    R&D          : aarav.patel@,    diya.mehta@,    kabir.singh@miltenyi.com")
        print("    Manufacturing: ishaan.joshi@,   saanvi.reddy@,  ayaan.khan@miltenyi.com")
        print("    Commercial   : riya.nair@,      arjun.gupta@,   myra.desai@miltenyi.com")
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
