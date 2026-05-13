"""
miltenyi-test-seed.py — Minimal demo-instance seed.

Goal: stand up a clean Miltenyi PMS instance with just enough data for
stakeholders to log in, navigate every page, and exercise the role-driven
flows. NO operational data — no projects, no goals, no reviews, no
project assignments. Stakeholders create those themselves while testing
so we get fresh observations.

What this seeds (and only this):
    - The Miltenyi organization
    - Reference data: Functions (R&D, Manufacturing, Commercial)
                      Designations (Scientist, Senior Scientist, Team Lead, Director)
    - SystemSettings tuned for demo (all gates open, ratings visible)
    - 18 users:
        2  HR  — 1 Healthark (HR_MyOrg, Indian name) + 1 Miltenyi (HR_Miltenyi, German)
        3  Mentors (Healthark, Indian names)
        4  PMs    (Miltenyi, German names)
        9  Staff  (Miltenyi domain, Indian names — 3 mentees per mentor)
    - Role expectations for every (function × designation) combination

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


# Same per-(function × designation) prose as the full dev seed so the PM
# evaluation modal has reference text to render. Stakeholders see the
# competencies but the evaluations themselves are theirs to author.
EXPECTATIONS: dict[str, dict[str, dict[str, str]]] = {
    "R&D": {
        "Scientist": {
            "exp_task_execution": "Executes assigned bench / analytical tasks reliably with guidance from senior scientists.",
            "exp_ownership": "Owns small experimental modules end-to-end; flags blockers early.",
            "exp_project_management": "Tracks experiments in lab notebooks and meets agreed timelines.",
            "exp_client_deliverables": "Produces clean datasets and well-documented protocols.",
            "exp_communication": "Clear written summaries; growing comfort presenting in team meetings.",
            "exp_mentoring": "Supports onboarding of new lab joiners on instruments and SOPs.",
            "exp_firm_growth": "Participates in internal seminars and lab safety initiatives.",
            "exp_competency_skills": "Building proficiency in core wet-lab and analytical assay techniques.",
        },
        "Senior Scientist": {
            "exp_task_execution": "Designs and runs moderately complex experiments independently; troubleshoots assays.",
            "exp_ownership": "Owns workstreams across a project and partners cross-functionally.",
            "exp_project_management": "Plans experiment timelines, manages reagent supply, tracks risks.",
            "exp_client_deliverables": "Authors method documents and study reports to GMP-friendly standards.",
            "exp_communication": "Leads internal reviews and presents data confidently to senior stakeholders.",
            "exp_mentoring": "Mentors junior scientists on experimental design and data interpretation.",
            "exp_firm_growth": "Contributes to internal best-practice docs; helps interview new scientists.",
            "exp_competency_skills": "SME in one platform / assay; expanding into adjacent technologies.",
        },
        "Team Lead": {
            "exp_task_execution": "Leads scientific direction and protocol design across the team.",
            "exp_ownership": "Accountable for project outcomes; balances rigor with delivery timelines.",
            "exp_project_management": "Owns project plan, milestones, budget, and stakeholder communication.",
            "exp_client_deliverables": "Reviews and signs off on regulatory-grade deliverables.",
            "exp_communication": "Represents the team to leadership and external partners.",
            "exp_mentoring": "Coaches scientists through career growth and structured feedback.",
            "exp_firm_growth": "Drives R&D capability uplift; identifies process improvements.",
            "exp_competency_skills": "Recognised expert in the team's platform area; mentors emerging SMEs.",
        },
    },
    "Manufacturing": {
        "Scientist": {
            "exp_task_execution": "Performs routine production / QC tasks reliably; raises deviations promptly.",
            "exp_ownership": "Owns assigned process steps and documentation accuracy.",
            "exp_project_management": "Adheres to production schedules and escalates risks early.",
            "exp_client_deliverables": "Produces clean batch records and SOP-compliant documentation.",
            "exp_communication": "Clear shift hand-offs and accurate written status updates.",
            "exp_mentoring": "Onboards new operators on cleanroom protocols.",
            "exp_firm_growth": "Participates in continuous-improvement (Kaizen) sessions.",
            "exp_competency_skills": "Building proficiency on key production instruments and aseptic technique.",
        },
        "Senior Scientist": {
            "exp_task_execution": "Owns process improvements and root-cause analysis on deviations.",
            "exp_ownership": "Drives a workstream across one or more product lines.",
            "exp_project_management": "Coordinates with R&D on tech-transfer and runs production planning.",
            "exp_client_deliverables": "Authors validation reports and CAPA documentation.",
            "exp_communication": "Leads cross-functional production review meetings.",
            "exp_mentoring": "Mentors junior staff on GMP and analytical methods.",
            "exp_firm_growth": "Drives at least one continuous-improvement initiative per year.",
            "exp_competency_skills": "Deep expertise in one production platform; growing breadth.",
        },
        "Team Lead": {
            "exp_task_execution": "Sets manufacturing strategy and ensures regulatory readiness.",
            "exp_ownership": "Owns line-level KPIs (throughput, yield, deviation rate).",
            "exp_project_management": "Owns multi-site programs end-to-end with budget accountability.",
            "exp_client_deliverables": "Final sign-off on validation, CAPA, and audit-ready documentation.",
            "exp_communication": "Owns regulatory and customer-facing communications for the line.",
            "exp_mentoring": "Coaches the team on technical depth, GMP rigor, and career growth.",
            "exp_firm_growth": "Champions operational excellence; owns hiring plans for the line.",
            "exp_competency_skills": "Recognised authority on the line's platforms; sets technical standards.",
        },
    },
    "Commercial": {
        "Scientist": {
            "exp_task_execution": "Supports market analysis, customer onboarding, and tracker maintenance.",
            "exp_ownership": "Owns assigned tasks within accounts / regions reliably.",
            "exp_project_management": "Maintains opportunity trackers and meets reporting cadences.",
            "exp_client_deliverables": "Produces clean pitch decks and customer-ready collateral with guidance.",
            "exp_communication": "Clear written customer summaries; growing confidence on calls.",
            "exp_mentoring": "Helps onboard new commercial joiners on tools and processes.",
            "exp_firm_growth": "Participates in customer events and knowledge-sharing.",
            "exp_competency_skills": "Building proficiency in commercial systems, CRM, and product fundamentals.",
        },
        "Senior Scientist": {
            "exp_task_execution": "Independently scopes and runs customer engagements end-to-end.",
            "exp_ownership": "Owns one region / segment with quota and pipeline accountability.",
            "exp_project_management": "Drives launch readiness across stakeholders (R&D, Mfg, Marketing).",
            "exp_client_deliverables": "Crafts compelling pitch material and strategy briefs.",
            "exp_communication": "Leads customer pitches and senior internal reviews.",
            "exp_mentoring": "Mentors junior commercial staff on customer skills.",
            "exp_firm_growth": "Owns at least one launch or commercial initiative per year.",
            "exp_competency_skills": "SME in a product line or therapeutic area; growing strategic breadth.",
        },
        "Team Lead": {
            "exp_task_execution": "Sets commercial strategy across multiple regions / product lines.",
            "exp_ownership": "Accountable for regional pipeline, revenue, and customer satisfaction.",
            "exp_project_management": "Owns launch programs end-to-end with cross-functional governance.",
            "exp_client_deliverables": "Final sign-off on enterprise customer proposals and strategy decks.",
            "exp_communication": "Owns C-level customer relationships and internal leadership reviews.",
            "exp_mentoring": "Coaches the team on customer skills, deal craft, and career growth.",
            "exp_firm_growth": "Drives go-to-market evolution; owns hiring + retention.",
            "exp_competency_skills": "Recognised authority on the region / segment; sets commercial playbooks.",
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
            db.add_all([
                Function(org_id=miltenyi.id, name="R&D"),
                Function(org_id=miltenyi.id, name="Manufacturing"),
                Function(org_id=miltenyi.id, name="Commercial"),
                Designation(org_id=miltenyi.id, name="Scientist",        level=1),
                Designation(org_id=miltenyi.id, name="Senior Scientist", level=2),
                Designation(org_id=miltenyi.id, name="Team Lead",        level=3),
                Designation(org_id=miltenyi.id, name="Director",         level=4),
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

        # ── Staff (Miltenyi domain, Indian names; 3 mentees per mentor) ──
        # Rahul's mentees — R&D
        _ensure_user(
            "aarav.patel@miltenyi.com",
            employee_code="MIL-T-S-01", full_name="Aarav Patel",
            phone="+91 98000 10101",
            role=Role.STAFF.value, mentor_id=rahul.id,
            function_id=func_rnd.id, designation_id=d_sci.id,
        )
        _ensure_user(
            "diya.mehta@miltenyi.com",
            employee_code="MIL-T-S-02", full_name="Diya Mehta",
            phone="+91 98000 10102",
            role=Role.STAFF.value, mentor_id=rahul.id,
            function_id=func_rnd.id, designation_id=d_sr.id,
        )
        _ensure_user(
            "kabir.singh@miltenyi.com",
            employee_code="MIL-T-S-03", full_name="Kabir Singh",
            phone="+91 98000 10103",
            role=Role.STAFF.value, mentor_id=rahul.id,
            function_id=func_rnd.id, designation_id=d_sci.id,
        )

        # Neha's mentees — Manufacturing
        _ensure_user(
            "ishaan.joshi@miltenyi.com",
            employee_code="MIL-T-S-04", full_name="Ishaan Joshi",
            phone="+91 98000 10104",
            role=Role.STAFF.value, mentor_id=neha.id,
            function_id=func_mfg.id, designation_id=d_sr.id,
        )
        _ensure_user(
            "saanvi.reddy@miltenyi.com",
            employee_code="MIL-T-S-05", full_name="Saanvi Reddy",
            phone="+91 98000 10105",
            role=Role.STAFF.value, mentor_id=neha.id,
            function_id=func_mfg.id, designation_id=d_sci.id,
        )
        _ensure_user(
            "ayaan.khan@miltenyi.com",
            employee_code="MIL-T-S-06", full_name="Ayaan Khan",
            phone="+91 98000 10106",
            role=Role.STAFF.value, mentor_id=neha.id,
            function_id=func_mfg.id, designation_id=d_sci.id,
        )

        # Vikram's mentees — Commercial
        _ensure_user(
            "riya.nair@miltenyi.com",
            employee_code="MIL-T-S-07", full_name="Riya Nair",
            phone="+91 98000 10107",
            role=Role.STAFF.value, mentor_id=vikram.id,
            function_id=func_com.id, designation_id=d_sr.id,
        )
        _ensure_user(
            "arjun.gupta@miltenyi.com",
            employee_code="MIL-T-S-08", full_name="Arjun Gupta",
            phone="+91 98000 10108",
            role=Role.STAFF.value, mentor_id=vikram.id,
            function_id=func_com.id, designation_id=d_sci.id,
        )
        _ensure_user(
            "myra.desai@miltenyi.com",
            employee_code="MIL-T-S-09", full_name="Myra Desai",
            phone="+91 98000 10109",
            role=Role.STAFF.value, mentor_id=vikram.id,
            function_id=func_com.id, designation_id=d_sci.id,
        )
        print("  [+] Users (HR×2, Mentors×3, PMs×4, Staff×9)")

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
        # Reference text PMs see while writing project review comments.
        # Re-runs are no-ops because of the count() guard.
        if db.query(RoleExpectation).filter(RoleExpectation.org_id == miltenyi.id).count() == 0:
            inserted = 0
            for func_name, by_desig in EXPECTATIONS.items():
                fn = db.query(Function).filter_by(org_id=miltenyi.id, name=func_name).first()
                if not fn:
                    continue
                for desig_name, comp in by_desig.items():
                    desig = db.query(Designation).filter_by(org_id=miltenyi.id, name=desig_name).first()
                    if not desig:
                        continue
                    db.add(RoleExpectation(
                        org_id=miltenyi.id,
                        function_id=fn.id,
                        designation_id=desig.id,
                        **comp,
                    ))
                    inserted += 1
            db.commit()
            print(f"  [+] Role Expectations: {inserted} rows")
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
        print("\n  Staff (Miltenyi domain, Healthark mentees)")
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
