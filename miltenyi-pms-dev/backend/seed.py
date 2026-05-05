"""
seed.py — Deterministic dev seed (Miltenyi PMS).

Accounts (all passwords: password123):
  Admin:           admin@miltenyi.com   (Alice Admin)
  Management:     hans@, greta@miltenyi.com
  R&D:             bob@, charlie@, dana@, iris@miltenyi.com
  Manufacturing:   evan@, fiona@, klaus@miltenyi.com
  Commercial:      lukas@, mia@, nils@miltenyi.com

Run:
  python seed.py
"""

from datetime import date, datetime, timezone

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.reference_models import Department, Designation
from app.models.user_models import User
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import ProjectReview
from app.models.annual_review_models import AnnualReview
from app.models.goal_models import Goal
from app.models.goal_self_review_models import GoalSelfReview
from app.models.role_expectation_models import RoleExpectation
from app.models.feedback_360_models import Feedback360Review, Feedback360Answer


def seed_database():
    print("Starting database seeding process...")
    db = SessionLocal()

    try:
        # ================================================================== #
        # 1. ORGANIZATIONS                                                    #
        # ================================================================== #

        miltenyi_org = db.query(Organization).filter(Organization.name == "Miltenyi").first()
        if not miltenyi_org:
            miltenyi_org = Organization(
                name="Miltenyi",
                domain="miltenyi.com",
                enabled_features=[
                    "dashboard", "goals", "project_reviews",
                    "annual_reviews", "mentoring", "admin", "feedback_360",
                ],
            )
            db.add(miltenyi_org)
            db.commit()
            db.refresh(miltenyi_org)
            print("  [+] Created Organization: Miltenyi (full suite)")
        else:
            print("  [~] Organization 'Miltenyi' already exists, skipping...")

        # Idempotent backfill: ensure the org has the 360 feedback flag.
        # Re-running this seed against a DB that predates the feature must
        # turn it on; the JSON column needs a full list reassignment for
        # SQLAlchemy to detect the change.
        feats = list(miltenyi_org.enabled_features or [])
        if "feedback_360" not in feats:
            feats.append("feedback_360")
            miltenyi_org.enabled_features = feats
            print(f"  [+] Backfilled feedback_360 onto {miltenyi_org.name}")
        db.commit()

        # ================================================================== #
        # 2. DEPARTMENTS & DESIGNATIONS                                       #
        # ================================================================== #

        if db.query(Department).filter(Department.org_id == miltenyi_org.id).count() == 0:
            dept_rnd = Department(org_id=miltenyi_org.id, name="R&D")
            dept_mfg = Department(org_id=miltenyi_org.id, name="Manufacturing")
            dept_com = Department(org_id=miltenyi_org.id, name="Commercial")

            desig_scientist    = Designation(org_id=miltenyi_org.id, name="Scientist",        level=1)
            desig_sr_scientist = Designation(org_id=miltenyi_org.id, name="Senior Scientist", level=2)
            desig_lead         = Designation(org_id=miltenyi_org.id, name="Team Lead",        level=3)
            desig_dir          = Designation(org_id=miltenyi_org.id, name="Director",         level=4)

            db.add_all([
                dept_rnd, dept_mfg, dept_com,
                desig_scientist, desig_sr_scientist, desig_lead, desig_dir,
            ])
            db.commit()
            print("  [+] Created Miltenyi Departments & Designations")
        else:
            print("  [~] Miltenyi Reference data already exists, skipping...")

        pw = get_password_hash("password123")

        # ================================================================== #
        # 3. USERS                                                            #
        # ================================================================== #

        dept_rnd = db.query(Department).filter_by(org_id=miltenyi_org.id, name="R&D").first()
        dept_mfg = db.query(Department).filter_by(org_id=miltenyi_org.id, name="Manufacturing").first()
        dept_com = db.query(Department).filter_by(org_id=miltenyi_org.id, name="Commercial").first()

        desig_scientist    = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Scientist").first()
        desig_sr_scientist = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Senior Scientist").first()
        desig_lead         = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Team Lead").first()
        desig_dir          = db.query(Designation).filter_by(org_id=miltenyi_org.id, name="Director").first()

        if db.query(User).filter(User.org_id == miltenyi_org.id).count() == 0:
            alice_admin = User(
                org_id=miltenyi_org.id, department_id=dept_com.id, designation_id=desig_dir.id,
                employee_code="MIL-000", full_name="Alice Admin", email="admin@miltenyi.com",
                phone="+49 30 1234 0000",
                role="Admin", password_hash=pw, is_management=True,
            )
            db.add(alice_admin)
            db.commit()
            db.refresh(alice_admin)

            bob_lead = User(
                org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_lead.id,
                employee_code="MIL-101", full_name="Bob Builder", email="bob@miltenyi.com",
                phone="+49 30 1234 1011",
                role="Staff", password_hash=pw, mentor_id=alice_admin.id,
            )
            db.add(bob_lead)
            db.commit()
            db.refresh(bob_lead)

            charlie = User(
                org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_sr_scientist.id,
                employee_code="MIL-102", full_name="Charlie Chemist", email="charlie@miltenyi.com",
                phone="+49 30 1234 1012",
                role="Staff", mentor_id=bob_lead.id, password_hash=pw,
            )
            dana = User(
                org_id=miltenyi_org.id, department_id=dept_rnd.id, designation_id=desig_scientist.id,
                employee_code="MIL-103", full_name="Dana DNA", email="dana@miltenyi.com",
                phone="+49 30 1234 1013",
                role="Staff", mentor_id=bob_lead.id, password_hash=pw,
            )
            evan_mfg = User(
                org_id=miltenyi_org.id, department_id=dept_mfg.id, designation_id=desig_lead.id,
                employee_code="MIL-201", full_name="Evan Engineer", email="evan@miltenyi.com",
                phone="+49 30 1234 2011",
                role="Staff", password_hash=pw, mentor_id=alice_admin.id,
            )
            db.add_all([charlie, dana, evan_mfg])
            db.commit()
            db.refresh(evan_mfg)

            fiona = User(
                org_id=miltenyi_org.id, department_id=dept_mfg.id, designation_id=desig_scientist.id,
                employee_code="MIL-202", full_name="Fiona Factory", email="fiona@miltenyi.com",
                phone="+49 30 1234 2012",
                role="Staff", mentor_id=evan_mfg.id, password_hash=pw,
            )
            db.add(fiona)
            db.commit()
            print("  [+] Created Miltenyi staff users")
        else:
            print("  [~] Miltenyi users already exist, skipping...")
            alice_admin = db.query(User).filter_by(org_id=miltenyi_org.id, email="admin@miltenyi.com").first()
            bob_lead    = db.query(User).filter_by(org_id=miltenyi_org.id, email="bob@miltenyi.com").first()
            charlie     = db.query(User).filter_by(org_id=miltenyi_org.id, email="charlie@miltenyi.com").first()
            dana        = db.query(User).filter_by(org_id=miltenyi_org.id, email="dana@miltenyi.com").first()
            evan_mfg    = db.query(User).filter_by(org_id=miltenyi_org.id, email="evan@miltenyi.com").first()
            fiona       = db.query(User).filter_by(org_id=miltenyi_org.id, email="fiona@miltenyi.com").first()

        # ── Backfill: management Admins, third Lead, and additional staff.
        # Idempotent — runs every seed for DBs that pre-date this expansion.
        def _ensure_mil_user(email, **kwargs):
            u = db.query(User).filter_by(
                org_id=miltenyi_org.id, email=email,
            ).first()
            if u:
                return u
            u = User(
                org_id=miltenyi_org.id, password_hash=pw, email=email, **kwargs,
            )
            db.add(u)
            db.commit()
            db.refresh(u)
            print(f"  [+] Created: {email}")
            return u

        hans = _ensure_mil_user(
            "hans@miltenyi.com",
            department_id=dept_rnd.id, designation_id=desig_dir.id,
            employee_code="MIL-F01", full_name="Hans Müller",
            phone="+49 30 1234 0001", role="Admin",
            mentor_id=alice_admin.id, is_management=True,
        )
        greta = _ensure_mil_user(
            "greta@miltenyi.com",
            department_id=dept_mfg.id, designation_id=desig_dir.id,
            employee_code="MIL-F02", full_name="Greta Schmidt",
            phone="+49 30 1234 0002", role="Admin",
            mentor_id=alice_admin.id, is_management=True,
        )
        lukas = _ensure_mil_user(
            "lukas@miltenyi.com",
            department_id=dept_com.id, designation_id=desig_lead.id,
            employee_code="MIL-301", full_name="Lukas Lange",
            phone="+49 30 1234 3011", role="Staff",
            mentor_id=alice_admin.id,
        )
        iris = _ensure_mil_user(
            "iris@miltenyi.com",
            department_id=dept_rnd.id, designation_id=desig_sr_scientist.id,
            employee_code="MIL-104", full_name="Iris Immel",
            phone="+49 30 1234 1014", role="Staff",
            mentor_id=bob_lead.id,
        )
        klaus = _ensure_mil_user(
            "klaus@miltenyi.com",
            department_id=dept_mfg.id, designation_id=desig_scientist.id,
            employee_code="MIL-203", full_name="Klaus Köhler",
            phone="+49 30 1234 2013", role="Staff",
            mentor_id=evan_mfg.id,
        )
        mia = _ensure_mil_user(
            "mia@miltenyi.com",
            department_id=dept_com.id, designation_id=desig_sr_scientist.id,
            employee_code="MIL-302", full_name="Mia Markt",
            phone="+49 30 1234 3012", role="Staff",
            mentor_id=lukas.id,
        )
        nils = _ensure_mil_user(
            "nils@miltenyi.com",
            department_id=dept_com.id, designation_id=desig_scientist.id,
            employee_code="MIL-303", full_name="Nils Niedermeier",
            phone="+49 30 1234 3013", role="Staff",
            mentor_id=lukas.id,
        )

        # Reassign Bob → Hans and Evan → Greta so the directors are real
        # mentors (rather than everyone reporting straight to Alice).
        if bob_lead and hans and bob_lead.mentor_id != hans.id:
            bob_lead.mentor_id = hans.id
        if evan_mfg and greta and evan_mfg.mentor_id != greta.id:
            evan_mfg.mentor_id = greta.id
        # Backfill is_management on Hans/Greta if pre-existing rows missed it.
        for _m in (hans, greta):
            if _m and not _m.is_management:
                _m.is_management = True
        db.commit()

        # ================================================================== #
        # 5. SYSTEM SETTINGS                                                  #
        # ================================================================== #

        if not db.query(SystemSettings).filter(SystemSettings.org_id == miltenyi_org.id).first():
            db.add(SystemSettings(
                org_id=miltenyi_org.id,
                active_cycle_name="Q1 FY26-27",
                cycle_type=CycleType.QUARTERLY.value,
                fiscal_start_month=4,
                goals_submission_open=True,
                reviews_submission_open=True,
                annual_goals_edit_enabled=True,
                updated_by_id=alice_admin.id,
            ))
            db.commit()
            print("  [+] Created System Settings for Miltenyi (Q1 FY26-27, Quarterly)")
        else:
            print("  [~] Miltenyi system settings already exist, skipping...")

        # ================================================================== #
        # 6. PROJECTS                                                         #
        # ================================================================== #

        if db.query(Project).filter(Project.org_id == miltenyi_org.id).count() == 0 and bob_lead and evan_mfg:

            proj_cell = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-101",
                name="Next-Gen CAR-T Workflow Automation",
                description="Automate end-to-end CAR-T cell processing workflow with new instrumentation.",
                start_date=date(2025, 1, 15), expected_end_date=date(2025, 8, 15),
                reports_to_id=alice_admin.id,
                secondary_evaluator_id=evan_mfg.id,
            )
            db.add(proj_cell)
            db.flush()
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=bob_lead.id, assignment_role=desig_lead.name,         department_id=dept_rnd.id, evaluator_type="Primary", assigned_date=date(2025, 1, 15)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=charlie.id,  assignment_role=desig_sr_scientist.name, department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2025, 1, 22)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_cell.id, user_id=dana.id,     assignment_role=desig_scientist.name,    department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2025, 2, 1)))
            db.commit()

            proj_macs = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-102",
                name="MACS Quant Scale-Up Program",
                description="Scale manufacturing of the next MACS Quant platform for global rollout.",
                start_date=date(2025, 3, 5), expected_end_date=date(2025, 11, 30),
                reports_to_id=alice_admin.id,
                secondary_evaluator_id=bob_lead.id,
            )
            db.add(proj_macs)
            db.flush()
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=evan_mfg.id, assignment_role=desig_lead.name,      department_id=dept_mfg.id, evaluator_type="Primary",   assigned_date=date(2025, 3, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=fiona.id,    assignment_role=desig_scientist.name, department_id=dept_mfg.id, evaluator_type=None,        assigned_date=date(2025, 3, 5)))
            # Bob is the Secondary evaluator (project-level) but also a project member.
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_macs.id, user_id=bob_lead.id, assignment_role="R&D Liaison",        department_id=dept_rnd.id, evaluator_type=None,        assigned_date=date(2025, 3, 18)))
            db.commit()

            print("  [+] Created Projects for Miltenyi (MIL-PRJ-101..MIL-PRJ-102)")
        else:
            print("  [~] Miltenyi base projects already exist, skipping...")

        # Idempotent additions for the broader Miltenyi project set.
        # MIL-PRJ-103 — Cell Therapy Process Validation (R&D, runs into FY26-27).
        proj_validation = db.query(Project).filter_by(
            org_id=miltenyi_org.id, project_code="MIL-PRJ-103",
        ).first()
        if not proj_validation and bob_lead and iris:
            proj_validation = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-103",
                name="Cell Therapy Process Validation",
                description="GMP-grade process validation for the next-gen CAR-T pipeline ahead of clinical hand-off.",
                start_date=date(2026, 1, 8), expected_end_date=date(2026, 9, 30),
                reports_to_id=hans.id,
                secondary_evaluator_id=alice_admin.id,
            )
            db.add(proj_validation)
            db.flush()
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=bob_lead.id, assignment_role=desig_lead.name,         department_id=dept_rnd.id, evaluator_type="Primary", assigned_date=date(2026, 1, 8)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=charlie.id,  assignment_role=desig_sr_scientist.name, department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2026, 1, 8)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=iris.id,     assignment_role=desig_sr_scientist.name, department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2026, 1, 8)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=dana.id,     assignment_role=desig_scientist.name,    department_id=dept_rnd.id, evaluator_type=None,      assigned_date=date(2026, 1, 22)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_validation.id, user_id=evan_mfg.id, assignment_role="Mfg Liaison",           department_id=dept_mfg.id, evaluator_type=None,      assigned_date=date(2026, 1, 15)))
            db.commit()
            print("  [+] Created MIL-PRJ-103 (Cell Therapy Process Validation)")

        # MIL-PRJ-104 — Commercial Launch Strategy (Commercial, runs through FY26-27).
        proj_launch = db.query(Project).filter_by(
            org_id=miltenyi_org.id, project_code="MIL-PRJ-104",
        ).first()
        if not proj_launch and lukas and mia and nils:
            proj_launch = Project(
                org_id=miltenyi_org.id, project_code="MIL-PRJ-104",
                name="Commercial Launch Strategy 2026",
                description="Cross-functional commercial readiness for the EMEA + APAC launch waves of the new MACS Quant.",
                start_date=date(2026, 1, 5), expected_end_date=date(2026, 12, 31),
                reports_to_id=alice_admin.id,
                secondary_evaluator_id=greta.id,
            )
            db.add(proj_launch)
            db.flush()
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_launch.id, user_id=lukas.id, assignment_role=desig_lead.name,         department_id=dept_com.id, evaluator_type="Primary", assigned_date=date(2026, 1, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_launch.id, user_id=mia.id,   assignment_role=desig_sr_scientist.name, department_id=dept_com.id, evaluator_type=None,      assigned_date=date(2026, 1, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_launch.id, user_id=nils.id,  assignment_role=desig_scientist.name,    department_id=dept_com.id, evaluator_type=None,      assigned_date=date(2026, 1, 5)))
            db.add(ProjectAssignment(org_id=miltenyi_org.id, project_id=proj_launch.id, user_id=evan_mfg.id, assignment_role="Mfg Advisor",        department_id=dept_mfg.id, evaluator_type=None,      assigned_date=date(2026, 2, 1)))
            db.commit()
            print("  [+] Created MIL-PRJ-104 (Commercial Launch Strategy 2026)")

        # Resolve project handles for downstream sections.
        proj_cell_mil       = db.query(Project).filter_by(org_id=miltenyi_org.id, project_code="MIL-PRJ-101").first()
        proj_macs_mil       = db.query(Project).filter_by(org_id=miltenyi_org.id, project_code="MIL-PRJ-102").first()
        proj_validation_mil = db.query(Project).filter_by(org_id=miltenyi_org.id, project_code="MIL-PRJ-103").first()
        proj_launch_mil     = db.query(Project).filter_by(org_id=miltenyi_org.id, project_code="MIL-PRJ-104").first()

        # ================================================================== #
        # 7. ROLE EXPECTATIONS                                                #
        # ================================================================== #

        # ── Miltenyi role expectations ─────────────────────────────────
        MIL_EXPECTATIONS = {
            "R&D": {
                "Scientist": {
                    "exp_task_execution": "Executes assigned bench / analytical tasks reliably with guidance from senior scientists.",
                    "exp_ownership": "Owns small experimental modules end-to-end and flags blockers early.",
                    "exp_project_management": "Tracks experiments in lab notebooks and meets agreed timelines.",
                    "exp_client_deliverables": "Produces clean datasets and well-documented protocols.",
                    "exp_communication": "Clear written summaries; growing comfort presenting in team meetings.",
                    "exp_mentoring": "Supports onboarding of new lab joiners on instruments and SOPs.",
                    "exp_firm_growth": "Participates in internal seminars and knowledge-sharing sessions | Contributes to lab safety + housekeeping initiatives",
                    "exp_competency_skills": "Building proficiency in core wet-lab and analytical assay techniques.",
                },
                "Senior Scientist": {
                    "exp_task_execution": "Designs and runs moderately complex experiments independently; troubleshoots assays.",
                    "exp_ownership": "Owns workstreams across a project and partners cross-functionally with Mfg/Commercial.",
                    "exp_project_management": "Plans experiment timelines, manages reagent supply, tracks risks.",
                    "exp_client_deliverables": "Authors method documents and study reports to GMP-friendly standards.",
                    "exp_communication": "Leads internal reviews and presents data confidently to senior stakeholders.",
                    "exp_mentoring": "Mentors junior scientists on experimental design and data interpretation.",
                    "exp_firm_growth": "Contributes to internal best-practice docs | Helps interview new scientists | Drives at least one knowledge-share per year",
                    "exp_competency_skills": "SME in one platform / assay; expanding into adjacent technologies.",
                },
                "Team Lead": {
                    "exp_task_execution": "Leads scientific direction and protocol design across the team.",
                    "exp_ownership": "Accountable for project outcomes; balances scientific rigor with delivery timelines.",
                    "exp_project_management": "Owns project plan, milestones, budget, and stakeholder communication.",
                    "exp_client_deliverables": "Reviews and signs off on regulatory-grade deliverables.",
                    "exp_communication": "Represents the team to leadership and external partners.",
                    "exp_mentoring": "Coaches scientists through career growth and structured feedback.",
                    "exp_firm_growth": "Acts as role model on culture and rigor | Drives R&D capability uplift | Identifies process improvements across the function | Participates in hiring and team-building decisions",
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
                    "exp_firm_growth": "Participates in continuous-improvement (Kaizen) sessions | Contributes ideas for safety + waste reduction",
                    "exp_competency_skills": "Building proficiency on key production instruments and aseptic technique.",
                },
                "Senior Scientist": {
                    "exp_task_execution": "Owns process improvements and root-cause analysis on deviations.",
                    "exp_ownership": "Drives a workstream across one or more product lines.",
                    "exp_project_management": "Coordinates with R&D on tech-transfer and runs production planning.",
                    "exp_client_deliverables": "Authors validation reports and CAPA documentation.",
                    "exp_communication": "Leads cross-functional production review meetings.",
                    "exp_mentoring": "Mentors junior staff on GMP and analytical methods.",
                    "exp_firm_growth": "Drives at least one continuous-improvement initiative per year | Supports interviewing | Contributes to compliance training material",
                    "exp_competency_skills": "Deep expertise in one production platform; growing breadth across related lines.",
                },
                "Team Lead": {
                    "exp_task_execution": "Sets manufacturing strategy and ensures regulatory readiness across the line.",
                    "exp_ownership": "Owns line-level KPIs (throughput, yield, deviation rate, customer complaints).",
                    "exp_project_management": "Owns multi-site programs end-to-end with budget and milestone accountability.",
                    "exp_client_deliverables": "Final sign-off on validation, CAPA, and audit-ready documentation.",
                    "exp_communication": "Owns regulatory and customer-facing communications for the line.",
                    "exp_mentoring": "Coaches the team on technical depth, GMP rigor, and career growth.",
                    "exp_firm_growth": "Champions operational excellence | Drives capability investments | Owns hiring plans for the line | Represents Mfg in cross-functional leadership forums",
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
                    "exp_firm_growth": "Participates in customer events and knowledge-sharing | Contributes case studies",
                    "exp_competency_skills": "Building proficiency in commercial systems, CRM, and product fundamentals.",
                },
                "Senior Scientist": {
                    "exp_task_execution": "Independently scopes and runs customer engagements end-to-end.",
                    "exp_ownership": "Owns one region / segment with quota and pipeline accountability.",
                    "exp_project_management": "Drives launch readiness across stakeholders (R&D, Mfg, Marketing).",
                    "exp_client_deliverables": "Crafts compelling pitch material and strategy briefs.",
                    "exp_communication": "Leads customer pitches and senior internal reviews.",
                    "exp_mentoring": "Mentors junior commercial staff on customer skills.",
                    "exp_firm_growth": "Owns at least one launch or commercial initiative per year | Supports recruiting | Builds case studies for eminence",
                    "exp_competency_skills": "SME in a product line or therapeutic area; growing strategic breadth.",
                },
                "Team Lead": {
                    "exp_task_execution": "Sets commercial strategy across multiple regions / product lines.",
                    "exp_ownership": "Accountable for regional pipeline, revenue, and customer satisfaction.",
                    "exp_project_management": "Owns launch programs end-to-end with cross-functional governance.",
                    "exp_client_deliverables": "Final sign-off on enterprise customer proposals and strategy decks.",
                    "exp_communication": "Owns C-level customer relationships and internal leadership reviews.",
                    "exp_mentoring": "Coaches the team on customer skills, deal craft, and career growth.",
                    "exp_firm_growth": "Drives go-to-market evolution | Champions cross-functional collaboration | Owns hiring + retention | Represents Commercial in leadership forums",
                    "exp_competency_skills": "Recognised authority on the region / segment; sets commercial playbooks.",
                },
            },
        }

        if db.query(RoleExpectation).filter(RoleExpectation.org_id == miltenyi_org.id).count() == 0:
            mil_added = 0
            for dept_name, designations_dict in MIL_EXPECTATIONS.items():
                _dept = db.query(Department).filter_by(org_id=miltenyi_org.id, name=dept_name).first()
                if not _dept:
                    continue
                for desig_name, competencies in designations_dict.items():
                    _desig = db.query(Designation).filter_by(org_id=miltenyi_org.id, name=desig_name).first()
                    if not _desig:
                        continue
                    db.add(RoleExpectation(
                        org_id=miltenyi_org.id,
                        department_id=_dept.id,
                        designation_id=_desig.id,
                        exp_task_execution=competencies.get("exp_task_execution", ""),
                        exp_ownership=competencies.get("exp_ownership", ""),
                        exp_project_management=competencies.get("exp_project_management", ""),
                        exp_client_deliverables=competencies.get("exp_client_deliverables", ""),
                        exp_communication=competencies.get("exp_communication", ""),
                        exp_mentoring=competencies.get("exp_mentoring", ""),
                        exp_firm_growth=competencies.get("exp_firm_growth", ""),
                        exp_competency_skills=competencies.get("exp_competency_skills", ""),
                    ))
                    mil_added += 1
            db.commit()
            print(f"  [+] Seeded {mil_added} Role Expectations for Miltenyi")
        else:
            print("  [~] Miltenyi Role expectations already exist, skipping...")

        # ================================================================== #
        # 8. PROJECT REVIEWS                                                  #
        # ================================================================== #


        # ── Miltenyi Project Reviews ──────────────────────────────────
        def _pr_mil(user, project, reviewer, cycle, status, pg=None, impact=None, **comments):
            if not project or not user or not reviewer:
                return
            if not db.query(ProjectReview).filter_by(
                org_id=miltenyi_org.id, user_id=user.id, project_id=project.id, cycle=cycle,
            ).first():
                db.add(ProjectReview(
                    org_id=miltenyi_org.id, user_id=user.id, project_id=project.id,
                    reviewer_id=reviewer.id, cycle=cycle, status=status,
                    performance_group=pg, impact_statement=impact, **comments,
                ))

        if proj_cell_mil and proj_macs_mil:
            # Q4 FY25-26 — completed reviews on the original two projects.
            _pr_mil(charlie, proj_cell_mil, bob_lead, "Q4 FY25-26", "reviewed", pg="4",
                impact="Charlie drove the upstream automation module with strong technical depth.",
                comment_task_execution="Independently designed and validated the upstream module.",
                comment_ownership="Owned the deliverable end-to-end and cleared blockers proactively.",
                comment_project_management="Tight tracker discipline; risk flags were raised early.",
                comment_client_deliverables="Validation reports were GMP-ready on first review.",
                comment_communication="Clear with both R&D peers and the Mfg liaison.",
                comment_mentoring="Coached Dana on assay troubleshooting.",
                comment_competency_skills="Strong cell-therapy assay expertise; growing depth in automation.",
            )
            _pr_mil(dana, proj_cell_mil, bob_lead, "Q4 FY25-26", "reviewed", pg="3",
                impact="Dana delivered the assay validation package on time with steady quality.",
                comment_task_execution="Completed validation runs methodically with light guidance.",
                comment_ownership="Reliable on assigned modules; growing initiative.",
                comment_project_management="Met sprint commitments; improving on estimation.",
                comment_client_deliverables="Documentation quality lifted notably across the quarter.",
                comment_communication="Improving verbal confidence; written summaries are tight.",
                comment_mentoring="Active learner in code/protocol reviews.",
                comment_competency_skills="Foundational cell-therapy assay skill set is solid.",
            )
            _pr_mil(fiona, proj_macs_mil, evan_mfg, "Q4 FY25-26", "reviewed", pg="4",
                impact="Fiona authored the scale-up SOP set and led the validation runs.",
                comment_task_execution="Structured the SOP framework end-to-end with strong rigor.",
                comment_ownership="Took ownership beyond scope on the validation runs.",
                comment_project_management="Excellent timeline discipline; zero deviations on critical path.",
                comment_client_deliverables="SOPs accepted on first internal audit pass.",
                comment_communication="Clear shift hand-offs and proactive cross-team updates.",
                comment_mentoring="Supported Klaus on aseptic technique.",
                comment_competency_skills="Senior Scientist trajectory in production validation.",
            )
            _pr_mil(bob_lead, proj_macs_mil, evan_mfg, "Q4 FY25-26", "reviewed", pg="3",
                impact="Bob's R&D liaison support kept the platform tech-transfer on track.",
                comment_task_execution="Effective bridge between R&D and Mfg context-switching.",
                comment_ownership="Owned the tech-transfer package across teams.",
                comment_project_management="Reliable cadence for cross-functional updates.",
                comment_client_deliverables="Hand-off documentation was tight and audit-ready.",
                comment_communication="Translated R&D nuance for the Mfg team well.",
                comment_mentoring="N/A in this scope.",
                comment_competency_skills="Solid platform-knowledge bridge skills.",
            )
            db.commit()

            # Q1 FY26-27 (current) — pending evaluations across all four projects.
            _pr_mil(charlie, proj_cell_mil,       bob_lead, "Q1 FY26-27", "pending")
            _pr_mil(dana,    proj_cell_mil,       bob_lead, "Q1 FY26-27", "pending")
            _pr_mil(fiona,   proj_macs_mil,       evan_mfg, "Q1 FY26-27", "pending")
            _pr_mil(bob_lead, proj_macs_mil,      evan_mfg, "Q1 FY26-27", "pending")
            if proj_validation_mil:
                _pr_mil(charlie, proj_validation_mil, bob_lead, "Q1 FY26-27", "pending")
                _pr_mil(iris,    proj_validation_mil, bob_lead, "Q1 FY26-27", "pending")
                _pr_mil(dana,    proj_validation_mil, bob_lead, "Q1 FY26-27", "pending")
                _pr_mil(evan_mfg, proj_validation_mil, bob_lead, "Q1 FY26-27", "pending")
            if proj_launch_mil:
                _pr_mil(mia,    proj_launch_mil, lukas, "Q1 FY26-27", "pending")
                _pr_mil(nils,   proj_launch_mil, lukas, "Q1 FY26-27", "pending")
                _pr_mil(evan_mfg, proj_launch_mil, lukas, "Q1 FY26-27", "pending")
            db.commit()
            print("  [+] Ensured Miltenyi Project Reviews (Q4 FY25-26 completed, Q1 FY26-27 pending)")

        # ================================================================== #
        # 9. ANNUAL REVIEWS                                                   #
        # ================================================================== #

        STRONG_SELF = (
            "Owned the full workstream end-to-end with clear accountability. "
            "Delivered client-ready artifacts with minimal rework, structured "
            "stakeholder updates, planned and mitigated risks proactively, "
            "coached juniors on methodology, and contributed to firm-level "
            "initiatives beyond day-to-day project work."
        )
        STRONG_MENTOR = (
            "Consistently takes charge without prompting. Full accountability "
            "across every workstream I observed — artifacts land in "
            "client-ready shape with minimal edits, team looks to them for "
            "guidance, and they contribute visibly to firm initiatives. "
            "Technical depth and trajectory are excellent."
        )
        SOLID_SELF = (
            "Completed assigned tasks reliably and flagged issues early. "
            "Quality of deliverables improved through the cycle. Managed my "
            "workstreams with guidance from my mentor, supported peers during "
            "tooling onboarding, and picked up new frameworks this cycle."
        )
        SOLID_MENTOR = (
            "Dependable on assigned work; initiative is growing. Artifact "
            "quality is improving cycle over cycle and communications are "
            "becoming more proactive. Planning independence is growing and "
            "early mentoring instincts are starting to show."
        )
        DIRECTOR_SELF = (
            "Led multiple workstreams and practice initiatives in parallel. "
            "Maintained full accountability across client engagements, coached "
            "the team on strategic thinking and delivery standards, and drove "
            "firm-level initiatives on business development and knowledge management."
        )
        DIRECTOR_MENTOR = (
            "Exceptional leadership across all dimensions. Drives outcomes for "
            "clients and the firm simultaneously, builds team capability "
            "proactively, and maintains very high standards on every deliverable. "
            "A clear role model for the practice."
        )


        # ── Miltenyi Annual Reviews ───────────────────────────────────
        def _ar_mil(user, mentor, cycle, status, **fields):
            if not user:
                return
            if not db.query(AnnualReview).filter_by(
                org_id=miltenyi_org.id, user_id=user.id, cycle_name=cycle,
            ).first():
                db.add(AnnualReview(
                    org_id=miltenyi_org.id, user_id=user.id,
                    mentor_id=mentor.id if mentor else None,
                    cycle_name=cycle, status=status, **fields,
                ))

        MIL_PAIRS = [
            (hans, alice_admin),  (greta, alice_admin),  (lukas, alice_admin),
            (bob_lead, hans),     (evan_mfg, greta),
            (charlie, bob_lead),  (dana, bob_lead),      (iris, bob_lead),
            (fiona, evan_mfg),    (klaus, evan_mfg),
            (mia, lukas),         (nils, lukas),
        ]

        # FY25-26 — fully completed history for everyone (used for Profile + Mentee summary).
        for _u, _m in MIL_PAIRS:
            _ar_mil(_u, _m, "FY25-26", "completed",
                self_overall_review=SOLID_SELF, self_performance_rating=2,
                mentor_overall_review=SOLID_MENTOR, mentor_performance_rating=2,
                management_performance_rating=2, final_performance_rating=2,
                management_comments="Strong contribution to the platform. Continue building depth.",
                final_rating_enabled=True,
            )
        db.commit()

        # FY26-27 (current) — mixed states for demo.
        # Hans + Greta + Lukas (Alice's mentees) → pending_management.
        _ar_mil(hans, alice_admin, "FY26-27", "pending_management",
            self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
            mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
        )
        _ar_mil(greta, alice_admin, "FY26-27", "pending_management",
            self_overall_review=DIRECTOR_SELF, self_performance_rating=1,
            mentor_overall_review=DIRECTOR_MENTOR, mentor_performance_rating=1,
        )
        _ar_mil(lukas, alice_admin, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=2,
        )
        # Bob + Evan (under Hans / Greta) → one pending_mentor, one draft.
        _ar_mil(bob_lead, hans, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=1,
        )
        _ar_mil(evan_mfg, greta, "FY26-27", "draft",
            self_overall_review="Drafting the year-end self review — leading the MACS Quant scale-up program.",
        )
        # Bob's mentees — varied states.
        _ar_mil(charlie, bob_lead, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=1,
        )
        _ar_mil(dana, bob_lead, "FY26-27", "pending_mentor",
            self_overall_review=SOLID_SELF, self_performance_rating=2,
        )
        _ar_mil(iris, bob_lead, "FY26-27", "draft",
            self_overall_review="Drafting — strong Q1 with the validation pipeline.",
        )
        # Evan's mentees.
        _ar_mil(fiona, evan_mfg, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=1,
        )
        _ar_mil(klaus, evan_mfg, "FY26-27", "pending_mentor",
            self_overall_review=SOLID_SELF, self_performance_rating=2,
        )
        # Lukas's mentees.
        _ar_mil(mia, lukas, "FY26-27", "pending_mentor",
            self_overall_review=STRONG_SELF, self_performance_rating=1,
        )
        _ar_mil(nils, lukas, "FY26-27", "draft",
            self_overall_review="Building my first commercial cycle self review — supporting the EMEA launch.",
        )
        db.commit()
        print("  [+] Ensured Miltenyi Annual Reviews (FY25-26 completed, FY26-27 mixed states)")

        # ================================================================== #
        # 10. ANNUAL GOALS + PER-HALF SELF REVIEWS                            #
        # ================================================================== #

        SELF_REVIEW_DEFAULT = (
            "Delivered all key tasks against the goal with disciplined execution and "
            "consistent quality checks. Took end-to-end ownership with proactive status "
            "updates and risk flagging, producing client-ready outputs that required "
            "minimal iteration post-review. Tracked milestones and dependencies with a "
            "well-maintained plan and early risk escalation, and supported teammates "
            "informally on methodology and tooling. The work fed into reusable playbooks "
            "and noticeably strengthened applicable skills — measurable on the scope and "
            "complexity handled independently."
        )


        # Miltenyi annual goals
        if db.query(Goal).filter(Goal.org_id == miltenyi_org.id).count() == 0:

            def _mil_goal(user, manager, title, desc, approval, cycle_name, fy_year,
                          progress_notes=None, manager_feedback=None, self_reviewed_halves=()):
                if db.query(Goal).filter_by(
                    org_id=miltenyi_org.id, user_id=user.id, title=title, cycle_name=cycle_name,
                ).first():
                    return
                approved_at = (
                    datetime(fy_year, 4, 20, tzinfo=timezone.utc) if approval == "approved" else None
                )
                g = Goal(
                    org_id=miltenyi_org.id, user_id=user.id,
                    manager_id=manager.id if manager else None,
                    title=title, description=desc,
                    goal_type="annual", cycle_name=cycle_name,
                    approval_status=approval,
                    progress_notes=progress_notes,
                    manager_feedback=manager_feedback,
                    approved_at=approved_at,
                )
                db.add(g)
                db.flush()
                for half in self_reviewed_halves:
                    db.add(GoalSelfReview(
                        goal_id=g.id,
                        org_id=miltenyi_org.id,
                        cycle_half=half,
                        self_overall_review=SELF_REVIEW_DEFAULT,
                    ))
                # Advance to the furthest *_self_reviewed milestone present.
                # Miltenyi runs on the quarterly cadence (Q1..Q4) — pick the
                # latest Q in the seeded set.
                if approval == "approved" and self_reviewed_halves:
                    order = ("Q1", "Q2", "Q3", "Q4", "H1", "H2")
                    latest = max(self_reviewed_halves, key=order.index)
                    g.approval_status = f"{latest.lower()}_self_reviewed"

            _mil_goal(charlie, bob_lead, "CAR-T Workflow Automation Module",
                      "Own the automation of the upstream CAR-T processing workflow on the new instrument.",
                      approval="approved", cycle_name="H1 2025", fy_year=2025,
                      progress_notes="Module deployed. Cycle time reduced by ~30%.",
                      self_reviewed_halves=("Q1", "Q2", "Q3", "Q4"))
            _mil_goal(dana, bob_lead, "Assay Validation for Next-Gen CAR-T",
                      "Design and run validation assays for the next-gen CAR-T platform.",
                      approval="approved", cycle_name="H1 2026", fy_year=2026,
                      progress_notes="Validation assays underway; first read scheduled.")
            _mil_goal(fiona, evan_mfg, "MACS Quant Scale-Up Documentation",
                      "Author the scale-up documentation package for the new MACS Quant platform.",
                      approval="pending_approval", cycle_name="H1 2026", fy_year=2026)

            db.commit()
            print("  [+] Created Miltenyi Annual Goals + Self Reviews")
        else:
            print("  [~] Miltenyi base goals already exist, ensuring expanded set...")

        # Idempotent additions for the expanded Miltenyi goal set so new
        # staff have something on the Annual Goals tab. `_mil_goal`
        # checks per-row existence so re-runs are safe.
        if "_mil_goal" not in dir():
            # Define a local `_mil_goal` for the case where the outer
            # block didn't run (existing DBs that already had base goals).
            def _mil_goal(user, manager, title, desc, approval, cycle_name, fy_year,
                          progress_notes=None, manager_feedback=None, self_reviewed_halves=()):
                if not user or not manager:
                    return
                if db.query(Goal).filter_by(
                    org_id=miltenyi_org.id, user_id=user.id, title=title, cycle_name=cycle_name,
                ).first():
                    return
                approved_at = (
                    datetime(fy_year, 4, 20, tzinfo=timezone.utc) if approval == "approved" else None
                )
                g = Goal(
                    org_id=miltenyi_org.id, user_id=user.id,
                    manager_id=manager.id,
                    title=title, description=desc,
                    goal_type="annual", cycle_name=cycle_name,
                    approval_status=approval,
                    progress_notes=progress_notes,
                    manager_feedback=manager_feedback,
                    approved_at=approved_at,
                )
                db.add(g)
                db.flush()
                for half in self_reviewed_halves:
                    db.add(GoalSelfReview(
                        goal_id=g.id,
                        org_id=miltenyi_org.id,
                        cycle_half=half,
                        self_overall_review=(
                            "Delivered on the goal with consistent quality and proactive "
                            "stakeholder updates."
                        ),
                    ))
                if approval == "approved" and self_reviewed_halves:
                    order = ("Q1", "Q2", "Q3", "Q4", "H1", "H2")
                    latest = max(self_reviewed_halves, key=order.index)
                    g.approval_status = f"{latest.lower()}_self_reviewed"

        # FY26-27 expanded goal set across the new staff.
        _mil_goal(charlie, bob_lead, "Cell Therapy Validation Lead",
                  "Lead protocol design + execution for the FY26 validation runs.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Protocol locked; runs underway.",
                  self_reviewed_halves=("Q1",))
        _mil_goal(dana, bob_lead, "Assay Optimisation Pipeline",
                  "Optimise turnaround time for the validation assay pipeline.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)
        _mil_goal(iris, bob_lead, "Next-Gen Reagent Workstream",
                  "Drive evaluation + qualification of the next-gen reagents for FY26.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Vendor screening complete; lab evaluation in progress.")
        _mil_goal(klaus, evan_mfg, "Aseptic Process Documentation",
                  "Author the next revision of the aseptic processing SOPs.",
                  approval="draft", cycle_name="H1 2026", fy_year=2026)
        _mil_goal(mia, lukas, "EMEA Launch Readiness",
                  "Own EMEA launch readiness for the new MACS Quant product line.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Customer outreach kicked off; collateral 80% done.",
                  self_reviewed_halves=("Q1",))
        _mil_goal(nils, lukas, "APAC Customer Discovery",
                  "Run discovery interviews with target accounts across APAC.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)
        _mil_goal(bob_lead, hans, "R&D Capability Uplift",
                  "Lift the R&D team's automation tooling capability for FY26.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Two new tooling tracks set up; trainings underway.",
                  self_reviewed_halves=("Q1",))
        _mil_goal(evan_mfg, greta, "Mfg Throughput +20%",
                  "Drive a 20% throughput uplift across the MACS Quant line by year-end.",
                  approval="pending_approval", cycle_name="H1 2026", fy_year=2026)
        _mil_goal(lukas, alice_admin, "FY26 Commercial Strategy",
                  "Own + execute the FY26 commercial strategy across EMEA + APAC.",
                  approval="approved", cycle_name="H1 2026", fy_year=2026,
                  progress_notes="Strategy locked; quarterly tracking cadence in place.",
                  self_reviewed_halves=("Q1",))
        db.commit()
        print("  [+] Ensured Miltenyi expanded goal set for FY26-27")

        # ================================================================== #
        # 11. 360 FEEDBACK (anonymous peer review)                            #
        # ================================================================== #
        #
        # Seeds enough reviews on a few targets so the four tabs of the
        # 360 module render their major UI states out-of-the-box:
        #   - Bob:     4 worked-with + 3 not-worked-with  → both bars
        #   - Charlie: 3 worked-with + 1 not-worked-with  → only worked-with
        #   - Alice:           0    + 4 not-worked-with   → only not-worked-with
        # The threshold is 3 per cohort (see feedback_360_routes.py); below
        # that the cohort is hidden behind the "Need 3+ reviewers" placeholder.
        #
        # We compute the reviewer hash inline using the same HMAC algorithm
        # as feedback_360_service.reviewer_hash so the uniqueness check
        # holds. The plaintext reviewer_id is consumed and dropped — the
        # rows persisted carry only the opaque hash.

        import hmac as _hmac
        import hashlib as _hashlib
        from app.core.config import settings as _settings

        # Active FY for the seeded "H1 FY26-27" cycle.
        _F360_FY = 2026

        def _f360_hash(reviewer_id: int, target_id: int, fy_year: int) -> str:
            msg = f"{reviewer_id}|{target_id}|{fy_year}".encode("utf-8")
            secret = _settings.FEEDBACK_HASH_SECRET.encode("utf-8")
            return _hmac.new(secret, msg, _hashlib.sha256).hexdigest()

        def _f360_did_work(reviewer_id: int, target_id: int, scoped_org_id: int) -> bool:
            """Mirrors feedback_360_service.did_work_together — true iff
            both users have at least one shared project assignment in the
            same org."""
            r_proj = {
                pid for (pid,) in db.query(ProjectAssignment.project_id)
                .filter(ProjectAssignment.user_id == reviewer_id,
                        ProjectAssignment.org_id == scoped_org_id)
                .all()
            }
            if not r_proj:
                return False
            t_proj = {
                pid for (pid,) in db.query(ProjectAssignment.project_id)
                .filter(ProjectAssignment.user_id == target_id,
                        ProjectAssignment.org_id == scoped_org_id)
                .all()
            }
            return bool(r_proj & t_proj)

        def _f360(reviewer, target, ratings: dict[str, int]):
            """Upsert a 360 review. If a review with the same reviewer
            hash already exists (re-running seed.py against an existing
            DB), its answers are dropped and re-inserted from `ratings`
            so the seed remains the source of truth across runs."""
            if not reviewer or not target:
                return
            rev_hash = _f360_hash(reviewer.id, target.id, _F360_FY)
            existing = db.query(Feedback360Review).filter_by(
                target_user_id=target.id,
                fy_year=_F360_FY,
                reviewer_hash=rev_hash,
            ).first()
            if existing:
                # Refresh: nuke the answers, keep the row + creation
                # timestamp + worked_with snapshot so anonymity isn't
                # disturbed for any consumers downstream.
                db.query(Feedback360Answer).filter_by(
                    review_id=existing.id
                ).delete(synchronize_session=False)
                db.flush()
                review = existing
            else:
                review = Feedback360Review(
                    org_id=reviewer.org_id,
                    target_user_id=target.id,
                    fy_year=_F360_FY,
                    reviewer_hash=rev_hash,
                    worked_with=_f360_did_work(
                        reviewer.id, target.id, reviewer.org_id
                    ),
                )
                db.add(review)
                db.flush()
            for key, rating in ratings.items():
                db.add(Feedback360Answer(
                    review_id=review.id,
                    question_key=key,
                    rating=rating,
                ))

        # All 12 question keys, in registry order. Helper below maps a
        # 12-element list of ratings onto these keys so each reviewer's
        # full ballot is one line. Every reviewer rates every question
        # so each cohort hits the per-question count we'd see at scale
        # — without that, individual questions can sit below the 3-per-
        # cohort anonymity threshold and the dot stays hidden even
        # though the header shows a non-zero total review count.
        _F360_KEYS = [
            "collab_inclusive_env",
            "empathy_consideration",
            "empower_support_autonomy",
            "empower_recognition",
            "equity_fair_treatment",
            "growth_dev_feedback",
            "impact_outcomes",
            "values_integrity",
            "comm_clarity",
            "comm_alignment",
            "core_expertise",
            "domain_knowledge",
        ]

        def _all_q(values: list[int]) -> dict[str, int]:
            assert len(values) == len(_F360_KEYS), "Need 12 ratings."
            return dict(zip(_F360_KEYS, values))


        # ── Miltenyi 360 feedback ─────────────────────────────────────
        # Bob (full demo): 4 worked-with + 3 not-worked-with → both cohorts.
        _f360(charlie, bob_lead, _all_q([5, 4, 5, 5, 4, 4, 5, 5, 5, 4, 4, 5]))
        _f360(dana,    bob_lead, _all_q([4, 5, 4, 4, 4, 5, 4, 5, 4, 4, 4, 4]))
        _f360(iris,    bob_lead, _all_q([5, 4, 4, 4, 5, 4, 5, 5, 5, 5, 4, 5]))
        _f360(evan_mfg, bob_lead, _all_q([4, 4, 4, 4, 4, 4, 5, 5, 5, 4, 5, 4]))
        _f360(mia,     bob_lead, _all_q([3, 4, 3, 3, 4, 3, 3, 4, 3, 3, 3, 4]))
        _f360(nils,    bob_lead, _all_q([4, 4, 3, 4, 4, 4, 4, 4, 3, 3, 4, 5]))
        _f360(klaus,   bob_lead, _all_q([3, 4, 3, 4, 4, 3, 3, 4, 3, 4, 3, 4]))

        # Charlie (worked-with only): 3 worked-with + 1 not-worked-with.
        _f360(bob_lead, charlie, _all_q([4, 4, 4, 4, 4, 4, 5, 5, 4, 4, 5, 5]))
        _f360(dana,     charlie, _all_q([5, 4, 5, 4, 4, 5, 5, 5, 4, 5, 5, 5]))
        _f360(iris,     charlie, _all_q([5, 5, 5, 5, 4, 5, 4, 5, 4, 4, 5, 5]))
        _f360(klaus,    charlie, _all_q([4, 4, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4]))

        # Alice (top admin, no projects → only not-worked-with cohort).
        _f360(hans,     alice_admin, _all_q([5, 5, 5, 5, 5, 4, 5, 5, 4, 5, 5, 5]))
        _f360(greta,    alice_admin, _all_q([5, 4, 4, 5, 5, 4, 5, 5, 4, 4, 5, 5]))
        _f360(lukas,    alice_admin, _all_q([5, 5, 5, 4, 5, 5, 4, 5, 4, 5, 4, 5]))
        _f360(bob_lead, alice_admin, _all_q([4, 5, 4, 5, 5, 4, 5, 5, 4, 4, 5, 4]))

        db.commit()
        print(
            "  [+] Seeded 360 feedback (full 12-question coverage per reviewer; "
            "Bob: both cohorts; Charlie: worked-with only; "
            "Alice: not-worked-with only)"
        )

        # ================================================================== #
        # DONE                                                                #
        # ================================================================== #

        print("\n" + "=" * 60)
        print("Database seeding completed successfully!")
        print("=" * 60)
        print("--- MILTENYI Accounts (Quarterly Cycle | all passwords: password123) ---")
        print("  ADMIN:    admin@miltenyi.com      Alice Admin      (Admin, no mentor — top of hierarchy)")
        print("  ADMIN:    hans@miltenyi.com       Hans Mueller     (Admin, mentor: Alice, mentors Bob)")
        print("  ADMIN:    greta@miltenyi.com      Greta Schmidt    (Admin, mentor: Alice, mentors Evan)")
        print("  R&D:      bob@miltenyi.com        Bob Builder      (mentor: Hans, mentors Charlie + Dana + Iris)")
        print("            charlie@miltenyi.com    Charlie Chemist  (mentor: Bob)")
        print("            dana@miltenyi.com       Dana DNA         (mentor: Bob)")
        print("            iris@miltenyi.com       Iris Immel       (mentor: Bob)")
        print("  MFG:      evan@miltenyi.com       Evan Engineer    (mentor: Greta, mentors Fiona + Klaus)")
        print("            fiona@miltenyi.com      Fiona Factory    (mentor: Evan)")
        print("            klaus@miltenyi.com      Klaus Koehler    (mentor: Evan)")
        print("  COMM:     lukas@miltenyi.com      Lukas Lange      (mentor: Alice, mentors Mia + Nils)")
        print("            mia@miltenyi.com        Mia Markt        (mentor: Lukas)")
        print("            nils@miltenyi.com       Nils Niedermeier (mentor: Lukas)")
        print()
        print("--- 360 FEEDBACK seeded for Miltenyi (FY26-27) ---")
        print("  Bob:     4 worked-with + 3 not-worked-with reviews -> both cohorts visible")
        print("  Charlie: 3 worked-with + 1 not-worked-with review  -> only worked-with shown")
        print("  Alice:           0   + 4 not-worked-with reviews   -> only not-worked-with shown")
        print("  Log in as Hans/Greta to demo Org Feedback (Management).")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
