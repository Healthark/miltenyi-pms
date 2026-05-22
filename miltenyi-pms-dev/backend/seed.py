"""
seed.py — Deterministic dev seed for the Miltenyi PMS instance.

Models the new collaborative role taxonomy: MyOrg (Healthark) staffs
employees to Miltenyi, who manage them on projects.

Accounts (all passwords: password123):
  HR · Healthark:
    sarah.patel@healthark.ai      Sarah Patel       (HR_MyOrg, super-admin)

  HR · Miltenyi:
    karin.weber@miltenyi.com      Karin Weber       (HR_Miltenyi, limited admin)

  Mentors (Healthark — fixed pool of 3):
    anjali.rao@healthark.ai       Anjali Rao        (mentors Bob, Charlie, Dana)
    mark.singh@healthark.ai       Mark Singh        (mentors Iris, Evan, Fiona)
    priya.mehta@healthark.ai      Priya Mehta       (mentors Klaus, Mia, Nils)

  PMs (Miltenyi):
    hans@miltenyi.com             Hans Müller       (PM)
    greta@miltenyi.com            Greta Schmidt     (PM)
    lukas@miltenyi.com            Lukas Lange       (PM)
    dieter@miltenyi.com           Dieter Becker     (PM, reserve)

  Employee (Healthark employees with Miltenyi-issued accounts):
    bob@, charlie@, dana@, iris@miltenyi.com               (R&D)
    evan@, fiona@, klaus@miltenyi.com                       (Manufacturing)
    mia@, nils@miltenyi.com                                 (Commercial)

Run:
  python seed.py
"""

from datetime import date, datetime, timezone

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.reference_models import Function, Designation
from app.models.user_models import User, Role
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.project_models import (
    Project, ProjectAssignment,
    PROJECT_STATUS_ACTIVE, PROJECT_STATUS_COMPLETED,
)
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.goal_models import Goal, ApprovalStatus, GoalType
from app.models.goal_self_review_models import GoalSelfReview, SelfReviewCycleHalf
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.role_expectation_models import RoleExpectation


# ── Reusable narrative blocks ──────────────────────────────────────────────────

STRONG_SELF = (
    "Owned the full workstream end-to-end with clear accountability. "
    "Delivered client-ready artifacts with minimal rework, planned and "
    "mitigated risks proactively, and supported peers on methodology and tooling."
)
SOLID_SELF = (
    "Completed assigned tasks reliably and flagged issues early. Quality "
    "of deliverables improved through the cycle. Picked up new frameworks "
    "and supported peers during onboarding."
)
STRONG_MENTOR = (
    "Consistently takes charge without prompting. Artifacts land in "
    "client-ready shape with minimal edits; technical depth and trajectory "
    "are excellent."
)
SOLID_MENTOR = (
    "Dependable on assigned work; initiative is growing. Artifact quality "
    "and stakeholder communication are improving cycle over cycle."
)


def seed_database() -> None:
    print("Starting database seeding process...")
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
            print("  [+] Created Organization: Miltenyi")
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
            print("  [+] Created Functions & Designations")
        else:
            print("  [~] Reference data already exists; reusing.")

        # Resolve handles
        func_rnd  = db.query(Function).filter_by(org_id=miltenyi.id, name="R&D").first()
        func_mfg  = db.query(Function).filter_by(org_id=miltenyi.id, name="Manufacturing").first()
        func_com  = db.query(Function).filter_by(org_id=miltenyi.id, name="Commercial").first()

        d_sci  = db.query(Designation).filter_by(org_id=miltenyi.id, name="Scientist").first()
        d_sr   = db.query(Designation).filter_by(org_id=miltenyi.id, name="Senior Scientist").first()
        d_lead = db.query(Designation).filter_by(org_id=miltenyi.id, name="Team Lead").first()
        d_dir  = db.query(Designation).filter_by(org_id=miltenyi.id, name="Director").first()

        # ============================================================ #
        # 3. USERS                                                       #
        # ============================================================ #
        # Helper: create-or-fetch idempotently. Returns the row.
        def _ensure_user(email: str, **kwargs) -> User:
            existing = db.query(User).filter_by(org_id=miltenyi.id, email=email).first()
            if existing:
                return existing
            u = User(org_id=miltenyi.id, email=email, password_hash=pw, **kwargs)
            db.add(u)
            db.commit()
            db.refresh(u)
            return u

        # ── HR · Healthark (full super-admin) ─────────────────────────
        sarah = _ensure_user(
            "sarah.patel@healthark.ai",
            employee_code="HRK-001", full_name="Sarah Patel",
            phone="+91 98000 00001",
            role=Role.HR_MYORG.value,
            function_id=None, designation_id=d_dir.id,
        )

        # ── HR · Miltenyi (limited admin) ─────────────────────────────
        karin = _ensure_user(
            "karin.weber@miltenyi.com",
            employee_code="MIL-HR-001", full_name="Karin Weber",
            phone="+49 30 1234 0001",
            role=Role.HR_MILTENYI.value,
            function_id=None, designation_id=d_dir.id,
        )

        # ── Mentors (Healthark — fixed pool of 3) ─────────────────────
        anjali = _ensure_user(
            "anjali.rao@healthark.ai",
            employee_code="HRK-M01", full_name="Anjali Rao",
            phone="+91 98000 00010",
            role=Role.MENTOR.value,
            function_id=None, designation_id=d_dir.id,
        )
        mark = _ensure_user(
            "mark.singh@healthark.ai",
            employee_code="HRK-M02", full_name="Mark Singh",
            phone="+91 98000 00011",
            role=Role.MENTOR.value,
            function_id=None, designation_id=d_dir.id,
        )
        priya = _ensure_user(
            "priya.mehta@healthark.ai",
            employee_code="HRK-M03", full_name="Priya Mehta",
            phone="+91 98000 00012",
            role=Role.MENTOR.value,
            function_id=None, designation_id=d_dir.id,
        )

        # ── PMs (Miltenyi) ────────────────────────────────────────────
        hans = _ensure_user(
            "hans@miltenyi.com",
            employee_code="MIL-PM-01", full_name="Hans Müller",
            phone="+49 30 1234 1001",
            role=Role.PM.value,
            function_id=func_rnd.id, designation_id=d_dir.id,
        )
        greta = _ensure_user(
            "greta@miltenyi.com",
            employee_code="MIL-PM-02", full_name="Greta Schmidt",
            phone="+49 30 1234 1002",
            role=Role.PM.value,
            function_id=func_mfg.id, designation_id=d_dir.id,
        )
        lukas = _ensure_user(
            "lukas@miltenyi.com",
            employee_code="MIL-PM-03", full_name="Lukas Lange",
            phone="+49 30 1234 1003",
            role=Role.PM.value,
            function_id=func_com.id, designation_id=d_lead.id,
        )
        dieter = _ensure_user(
            "dieter@miltenyi.com",
            employee_code="MIL-PM-04", full_name="Dieter Becker",
            phone="+49 30 1234 1004",
            role=Role.PM.value,
            function_id=func_rnd.id, designation_id=d_lead.id,
        )

        # ── Employee (Healthark employees, Miltenyi-issued logins) ───────
        # Mentor pairings:
        #   Anjali → Bob, Charlie, Dana
        #   Mark   → Iris, Evan, Fiona
        #   Priya  → Klaus, Mia, Nils
        bob = _ensure_user(
            "bob@miltenyi.com",
            employee_code="STF-001", full_name="Bob Builder",
            phone="+49 30 1234 2001",
            role=Role.EMPLOYEE.value, mentor_id=anjali.id,
            function_id=func_rnd.id, designation_id=d_sr.id,
        )
        charlie = _ensure_user(
            "charlie@miltenyi.com",
            employee_code="STF-002", full_name="Charlie Chemist",
            phone="+49 30 1234 2002",
            role=Role.EMPLOYEE.value, mentor_id=anjali.id,
            function_id=func_rnd.id, designation_id=d_sci.id,
        )
        dana = _ensure_user(
            "dana@miltenyi.com",
            employee_code="STF-003", full_name="Dana DNA",
            phone="+49 30 1234 2003",
            role=Role.EMPLOYEE.value, mentor_id=anjali.id,
            function_id=func_rnd.id, designation_id=d_sci.id,
        )
        iris = _ensure_user(
            "iris@miltenyi.com",
            employee_code="STF-004", full_name="Iris Immel",
            phone="+49 30 1234 2004",
            role=Role.EMPLOYEE.value, mentor_id=mark.id,
            function_id=func_rnd.id, designation_id=d_sr.id,
        )
        evan = _ensure_user(
            "evan@miltenyi.com",
            employee_code="STF-005", full_name="Evan Engineer",
            phone="+49 30 1234 2005",
            role=Role.EMPLOYEE.value, mentor_id=mark.id,
            function_id=func_mfg.id, designation_id=d_lead.id,
        )
        fiona = _ensure_user(
            "fiona@miltenyi.com",
            employee_code="STF-006", full_name="Fiona Factory",
            phone="+49 30 1234 2006",
            role=Role.EMPLOYEE.value, mentor_id=mark.id,
            function_id=func_mfg.id, designation_id=d_sci.id,
        )
        klaus = _ensure_user(
            "klaus@miltenyi.com",
            employee_code="STF-007", full_name="Klaus Köhler",
            phone="+49 30 1234 2007",
            role=Role.EMPLOYEE.value, mentor_id=priya.id,
            function_id=func_mfg.id, designation_id=d_sci.id,
        )
        mia = _ensure_user(
            "mia@miltenyi.com",
            employee_code="STF-008", full_name="Mia Markt",
            phone="+49 30 1234 2008",
            role=Role.EMPLOYEE.value, mentor_id=priya.id,
            function_id=func_com.id, designation_id=d_sr.id,
        )
        nils = _ensure_user(
            "nils@miltenyi.com",
            employee_code="STF-009", full_name="Nils Niedermeier",
            phone="+49 30 1234 2009",
            role=Role.EMPLOYEE.value, mentor_id=priya.id,
            function_id=func_com.id, designation_id=d_sci.id,
        )
        print("  [+] Users (HR×2, Mentors×3, PMs×4, Employee×9)")

        # ============================================================ #
        # 4. SYSTEM SETTINGS                                            #
        # ============================================================ #
        if not db.query(SystemSettings).filter(SystemSettings.org_id == miltenyi.id).first():
            db.add(SystemSettings(
                org_id=miltenyi.id,
                active_cycle_name="Q1 FY26-27",
                cycle_type=CycleType.QUARTERLY.value,
                fiscal_start_month=4,
                goals_submission_open=True,
                reviews_submission_open=True,
                annual_goals_edit_enabled=True,
                annual_reviews_enabled=True,
                # Dev convenience: bypass the H1/H2 calendar gate so we can
                # test both halves' goal reviews in one session without
                # waiting for October. Production should leave this False.
                cycle_window_override=True,
                updated_by_id=sarah.id,
            ))
            db.commit()
            print("  [+] System Settings (quarterly, Q1 FY26-27, Healthark HR as updater, H1/H2 review window bypass on)")
        else:
            print("  [~] System settings already exist; reusing.")

        # ============================================================ #
        # 5. PROJECTS                                                   #
        # ============================================================ #
        # PM = Miltenyi PM. Secondary = a non-PM/non-Mentor user (HR or other).
        # Members are Employee only — the PM is NOT in `assignments`.
        def _ensure_project(
            code: str, name: str, description: str,
            pm: User, secondary: User | None,
            start: date, end: date,
            members: list[tuple[User, Designation, Function, date]],
        ) -> Project:
            proj = db.query(Project).filter_by(org_id=miltenyi.id, project_code=code).first()
            if proj:
                return proj
            proj = Project(
                org_id=miltenyi.id,
                project_code=code, name=name, description=description,
                start_date=start, expected_end_date=end,
                pm_id=pm.id,
                secondary_evaluator_id=secondary.id if secondary else None,
            )
            db.add(proj)
            db.flush()
            for user, desig, func_, joined in members:
                db.add(ProjectAssignment(
                    org_id=miltenyi.id,
                    project_id=proj.id,
                    user_id=user.id,
                    assignment_role=desig.name,
                    function_id=func_.id,
                    assigned_date=joined,
                ))
            db.commit()
            db.refresh(proj)
            return proj

        # Bob's flagship — full FY25-26 span; underwrites the demo data in §11.
        proj_bob_flagship = _ensure_project(
            "MIL-PRJ-100",
            "CAR-T Platform Development Programme",
            "Year-long platform development running across the full FY25-26 — Bob's flagship engagement.",
            pm=hans, secondary=sarah,
            start=date(2025, 4, 1), end=date(2026, 3, 31),
            members=[
                (bob, d_sr, func_rnd, date(2025, 4, 1)),
            ],
        )
        proj_cell = _ensure_project(
            "MIL-PRJ-101",
            "Next-Gen CAR-T Workflow Automation",
            "Automate end-to-end CAR-T cell processing workflow on the new instrument.",
            pm=hans, secondary=sarah,
            start=date(2025, 1, 15), end=date(2025, 8, 15),
            members=[
                (bob,     d_sr,  func_rnd, date(2025, 1, 15)),
                (charlie, d_sci, func_rnd, date(2025, 1, 22)),
                (dana,    d_sci, func_rnd, date(2025, 2, 1)),
            ],
        )
        proj_macs = _ensure_project(
            "MIL-PRJ-102",
            "MACS Quant Scale-Up Program",
            "Scale manufacturing of the next MACS Quant platform for global rollout.",
            pm=greta, secondary=karin,
            start=date(2025, 3, 5), end=date(2025, 11, 30),
            members=[
                (evan,  d_lead, func_mfg, date(2025, 3, 5)),
                (fiona, d_sci,  func_mfg, date(2025, 3, 5)),
                (klaus, d_sci,  func_mfg, date(2025, 3, 18)),
            ],
        )
        proj_validation = _ensure_project(
            "MIL-PRJ-103",
            "Cell Therapy Process Validation",
            "GMP-grade process validation for the next-gen CAR-T pipeline ahead of clinical hand-off.",
            pm=hans, secondary=sarah,
            start=date(2026, 1, 8), end=date(2026, 9, 30),
            members=[
                (iris,    d_sr,  func_rnd, date(2026, 1, 8)),
                (charlie, d_sci, func_rnd, date(2026, 1, 8)),
                (dana,    d_sci, func_rnd, date(2026, 1, 22)),
            ],
        )
        proj_launch = _ensure_project(
            "MIL-PRJ-104",
            "Commercial Launch Strategy 2026",
            "Cross-functional commercial readiness for the EMEA + APAC launch waves.",
            pm=lukas, secondary=karin,
            start=date(2026, 1, 5), end=date(2026, 12, 31),
            members=[
                (mia,  d_sr,  func_com, date(2026, 1, 5)),
                (nils, d_sci, func_com, date(2026, 1, 5)),
            ],
        )
        print("  [+] Projects: MIL-PRJ-100..104")

        # ============================================================ #
        # 6. ROLE EXPECTATIONS                                          #
        # ============================================================ #
        # Reference data shown to PMs while evaluating; one row per
        # (function × designation).
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
        # 7. ANNUAL GOALS + H1 SELF-REVIEWS (Employee only)                #
        # ============================================================ #
        # Goals are owned by Employee; the manager_id is the Employee's mentor.
        def _ensure_goal(
            owner: User, mentor: User, title: str, description: str,
            cycle_name: str, approval: str, fy_year: int,
            with_h1_self_review: bool = False,
            self_review_text: str = STRONG_SELF,
        ) -> Goal | None:
            existing = db.query(Goal).filter_by(
                org_id=miltenyi.id, user_id=owner.id, title=title, cycle_name=cycle_name,
            ).first()
            if existing:
                return existing
            approved_at = (
                datetime(fy_year, 4, 20, tzinfo=timezone.utc)
                if approval == ApprovalStatus.APPROVED.value else None
            )
            g = Goal(
                org_id=miltenyi.id,
                user_id=owner.id,
                manager_id=mentor.id,
                title=title, description=description,
                goal_type=GoalType.ANNUAL.value, cycle_name=cycle_name,
                approval_status=approval,
                approved_at=approved_at,
            )
            db.add(g)
            db.flush()
            if with_h1_self_review:
                db.add(GoalSelfReview(
                    goal_id=g.id,
                    org_id=miltenyi.id,
                    cycle_half=SelfReviewCycleHalf.H1.value,
                    self_overall_review=self_review_text,
                ))
                # Advance the lifecycle so the dashboard shows it correctly.
                g.approval_status = ApprovalStatus.H1_SELF_REVIEWED.value
            db.commit()
            return g

        if db.query(Goal).filter(Goal.org_id == miltenyi.id).count() == 0:
            # Bob — strong performer with H1 self-review submitted
            _ensure_goal(
                bob, anjali,
                "CAR-T Workflow Automation Module",
                "Own the automation of the upstream CAR-T processing workflow on the new instrument.",
                cycle_name="FY26-27", approval=ApprovalStatus.APPROVED.value, fy_year=2026,
                with_h1_self_review=True,
            )
            # Charlie — pending mentor approval
            _ensure_goal(
                charlie, anjali,
                "Assay Validation for Next-Gen CAR-T",
                "Design and run validation assays for the next-gen CAR-T platform.",
                cycle_name="FY26-27", approval=ApprovalStatus.PENDING_APPROVAL.value, fy_year=2026,
            )
            # Dana — draft (employee still drafting)
            _ensure_goal(
                dana, anjali,
                "Reagent Optimisation Pipeline",
                "Reduce turnaround time for the validation reagent prep pipeline by 25%.",
                cycle_name="FY26-27", approval=ApprovalStatus.DRAFT.value, fy_year=2026,
            )
            # Iris — approved, no self-review yet (mid-cycle)
            _ensure_goal(
                iris, mark,
                "Cell Therapy Validation Lead",
                "Lead protocol design + execution for FY26 validation runs.",
                cycle_name="FY26-27", approval=ApprovalStatus.APPROVED.value, fy_year=2026,
            )
            # Evan — approved with H1 self-review
            _ensure_goal(
                evan, mark,
                "Mfg Throughput +15% Initiative",
                "Drive a 15% throughput uplift across the MACS Quant line by year-end.",
                cycle_name="FY26-27", approval=ApprovalStatus.APPROVED.value, fy_year=2026,
                with_h1_self_review=True, self_review_text=STRONG_SELF,
            )
            # Fiona — pending approval
            _ensure_goal(
                fiona, mark,
                "Aseptic Process Documentation",
                "Author the next revision of the aseptic processing SOPs.",
                cycle_name="FY26-27", approval=ApprovalStatus.PENDING_APPROVAL.value, fy_year=2026,
            )
            # Klaus — draft
            _ensure_goal(
                klaus, priya,
                "Mfg QC Capability Uplift",
                "Lead QC tooling capability uplift initiative across two product lines.",
                cycle_name="FY26-27", approval=ApprovalStatus.DRAFT.value, fy_year=2026,
            )
            # Mia — approved with H1 self-review
            _ensure_goal(
                mia, priya,
                "EMEA Launch Readiness",
                "Own EMEA launch readiness for the new MACS Quant product line.",
                cycle_name="FY26-27", approval=ApprovalStatus.APPROVED.value, fy_year=2026,
                with_h1_self_review=True,
            )
            # Nils — pending approval
            _ensure_goal(
                nils, priya,
                "APAC Customer Discovery",
                "Run discovery interviews with target accounts across APAC.",
                cycle_name="FY26-27", approval=ApprovalStatus.PENDING_APPROVAL.value, fy_year=2026,
            )
            print("  [+] Annual goals (FY26-27) for all Employee with mixed approval states")
        else:
            print("  [~] Goals already exist; reusing.")

        # ============================================================ #
        # 8. ANNUAL REVIEWS (Employee only, mentor-driven)                 #
        # ============================================================ #
        STAFF_BY_MENTOR = [
            (bob, anjali), (charlie, anjali), (dana, anjali),
            (iris, mark),  (evan, mark),      (fiona, mark),
            (klaus, priya), (mia, priya),      (nils, priya),
        ]

        def _ensure_review(user: User, mentor: User, cycle: str, status: str, **fields) -> None:
            existing = db.query(AnnualReview).filter_by(
                org_id=miltenyi.id, user_id=user.id, cycle_name=cycle,
            ).first()
            if existing:
                return
            db.add(AnnualReview(
                org_id=miltenyi.id, user_id=user.id, mentor_id=mentor.id,
                cycle_name=cycle, status=status, **fields,
            ))

        if db.query(AnnualReview).filter(AnnualReview.org_id == miltenyi.id).count() == 0:
            # FY25-26 — fully completed history
            for s, m in STAFF_BY_MENTOR:
                _ensure_review(s, m, "FY25-26", ReviewStatus.COMPLETED.value,
                    self_overall_review=SOLID_SELF, self_performance_rating=2,
                    mentor_overall_review=SOLID_MENTOR, mentor_performance_rating=2,
                    management_performance_rating=2, final_performance_rating=2,
                    management_comments="Solid contribution; continue building depth.",
                    final_rating_enabled=True,
                )
            db.commit()

            # FY26-27 — mixed states for demo
            _ensure_review(bob, anjali, "FY26-27", ReviewStatus.PENDING_MENTOR.value,
                self_overall_review=STRONG_SELF, self_performance_rating=1,
            )
            _ensure_review(charlie, anjali, "FY26-27", ReviewStatus.DRAFT.value,
                self_overall_review="Drafting — building out the validation narrative.",
            )
            _ensure_review(dana, anjali, "FY26-27", ReviewStatus.PENDING_MENTOR.value,
                self_overall_review=SOLID_SELF, self_performance_rating=2,
            )
            _ensure_review(iris, mark, "FY26-27", ReviewStatus.PENDING_MENTOR.value,
                self_overall_review=STRONG_SELF, self_performance_rating=1,
            )
            _ensure_review(evan, mark, "FY26-27", ReviewStatus.PENDING_MANAGEMENT.value,
                self_overall_review=STRONG_SELF, self_performance_rating=1,
                mentor_overall_review=STRONG_MENTOR, mentor_performance_rating=1,
            )
            _ensure_review(fiona, mark, "FY26-27", ReviewStatus.PENDING_MENTOR.value,
                self_overall_review=SOLID_SELF, self_performance_rating=2,
            )
            _ensure_review(klaus, priya, "FY26-27", ReviewStatus.DRAFT.value,
                self_overall_review="Will summarise QC initiative wins shortly.",
            )
            _ensure_review(mia, priya, "FY26-27", ReviewStatus.PENDING_MENTOR.value,
                self_overall_review=STRONG_SELF, self_performance_rating=1,
            )
            _ensure_review(nils, priya, "FY26-27", ReviewStatus.PENDING_MENTOR.value,
                self_overall_review=SOLID_SELF, self_performance_rating=2,
            )
            db.commit()
            print("  [+] Annual reviews: FY25-26 completed, FY26-27 mixed states")
        else:
            print("  [~] Annual reviews already exist; reusing.")

        # ============================================================ #
        # 9. PROJECT REVIEWS (Q1 FY26-27, PM-driven)                    #
        # ============================================================ #
        active_cycle = "Q1 FY26-27"

        def _ensure_pr(
            employee: User, project: Project, pm: User,
            status: str = ProjectReviewStatus.PENDING.value, pg: str | None = None,
            impact: str | None = None, **comments,
        ) -> None:
            existing = db.query(ProjectReview).filter_by(
                org_id=miltenyi.id, user_id=employee.id, project_id=project.id, cycle=active_cycle,
            ).first()
            if existing:
                return
            db.add(ProjectReview(
                org_id=miltenyi.id, user_id=employee.id, project_id=project.id,
                reviewer_id=pm.id if status != ProjectReviewStatus.PENDING.value else None,
                cycle=active_cycle, status=status,
                performance_group=pg, impact_statement=impact, **comments,
            ))

        if db.query(ProjectReview).filter(ProjectReview.org_id == miltenyi.id).count() == 0:
            # MIL-PRJ-101 (Hans) — Charlie reviewed, Bob/Dana pending
            _ensure_pr(
                charlie, proj_cell, hans, ProjectReviewStatus.REVIEWED.value, pg="4",
                impact="Charlie drove the upstream automation module with strong technical depth.",
                comment_task_execution="Independently designed and validated the upstream module.",
                comment_ownership="Owned the deliverable end-to-end and cleared blockers proactively.",
                comment_project_management="Tight tracker discipline; risk flags raised early.",
                comment_client_deliverables="Validation reports were GMP-ready on first review.",
                comment_communication="Clear with peers and the Mfg liaison.",
                comment_mentoring="Coached Dana on assay troubleshooting.",
                comment_competency_skills="Strong cell-therapy assay expertise; growing depth in automation.",
            )
            _ensure_pr(bob,  proj_cell, hans)
            _ensure_pr(dana, proj_cell, hans)

            # MIL-PRJ-102 (Greta) — Fiona reviewed, others pending
            _ensure_pr(
                fiona, proj_macs, greta, ProjectReviewStatus.REVIEWED.value, pg="4",
                impact="Fiona authored the scale-up SOP set and led validation runs.",
                comment_task_execution="Structured the SOP framework end-to-end with strong rigor.",
                comment_ownership="Took ownership beyond scope on the validation runs.",
                comment_project_management="Excellent timeline discipline; zero deviations on critical path.",
                comment_client_deliverables="SOPs accepted on first internal audit pass.",
                comment_communication="Clear shift hand-offs and proactive cross-team updates.",
                comment_mentoring="Supported Klaus on aseptic technique.",
                comment_competency_skills="Senior Scientist trajectory in production validation.",
            )
            _ensure_pr(evan,  proj_macs, greta)
            _ensure_pr(klaus, proj_macs, greta)

            # MIL-PRJ-103 (Hans) — all pending
            _ensure_pr(iris,    proj_validation, hans)
            _ensure_pr(charlie, proj_validation, hans)
            _ensure_pr(dana,    proj_validation, hans)

            # MIL-PRJ-104 (Lukas) — all pending
            _ensure_pr(mia,  proj_launch, lukas)
            _ensure_pr(nils, proj_launch, lukas)

            db.commit()
            print(f"  [+] Project reviews ({active_cycle}): mix of pending + reviewed")
        else:
            print("  [~] Project reviews already exist; reusing.")

        # ============================================================ #
        # 10. LIFECYCLE TEST DATA                                       #
        # ============================================================ #
        # Pre-populate at least one of each new state so the dev env
        # exercises the Project completion + Assignment soft-end paths.
        # Each block is idempotent: re-running the seed is a no-op once
        # the target state is reached.
        #
        #   10a. MIL-PRJ-101 → Completed (all 3 assignments end-dated).
        #        Demonstrates the Completed pill, Re-open button, and
        #        the PM queue's exclusion of completed projects.
        #   10b. Charlie's MIL-PRJ-103 stint → ended 2026-04-30 (mid-Q1).
        #        Demonstrates "PM keeps the in-flight review" — his Q1
        #        PENDING row stays in Hans's queue so Hans can still
        #        write up the partial period.
        #   10c. Charlie re-joins MIL-PRJ-103 with a new active stint
        #        starting 2026-06-01. Demonstrates two-row coexistence
        #        per (project, user) after the unique-index drop.

        # 10a — Mark MIL-PRJ-101 completed.
        if proj_cell.status != PROJECT_STATUS_COMPLETED:
            proj_cell.status = PROJECT_STATUS_COMPLETED
            proj_cell.completed_at = datetime(2025, 9, 1, tzinfo=timezone.utc)
            proj_cell.completed_by_id = sarah.id
            for a in db.query(ProjectAssignment).filter(
                ProjectAssignment.project_id == proj_cell.id,
                ProjectAssignment.end_date.is_(None),
            ).all():
                a.end_date = date(2025, 8, 31)
                a.ended_by_id = sarah.id
            db.commit()
            print("  [+] MIL-PRJ-101 marked Completed (3 assignments auto-end-dated)")
        else:
            print("  [~] MIL-PRJ-101 already Completed; skipping.")

        # 10b — End Charlie's MIL-PRJ-103 stint mid-Q1.
        charlie_103_active = db.query(ProjectAssignment).filter(
            ProjectAssignment.project_id == proj_validation.id,
            ProjectAssignment.user_id == charlie.id,
            ProjectAssignment.end_date.is_(None),
            ProjectAssignment.assigned_date == date(2026, 1, 8),
        ).first()
        if charlie_103_active:
            charlie_103_active.end_date = date(2026, 4, 30)
            charlie_103_active.ended_by_id = hans.id
            db.commit()
            print("  [+] Charlie's MIL-PRJ-103 stint ended 2026-04-30 (Hans)")
        else:
            print("  [~] Charlie's original MIL-PRJ-103 stint already ended; skipping.")

        # 10c — Re-join Charlie on MIL-PRJ-103 as a new active stint.
        charlie_103_rejoin = db.query(ProjectAssignment).filter(
            ProjectAssignment.project_id == proj_validation.id,
            ProjectAssignment.user_id == charlie.id,
            ProjectAssignment.end_date.is_(None),
        ).first()
        if not charlie_103_rejoin:
            db.add(ProjectAssignment(
                org_id=miltenyi.id,
                project_id=proj_validation.id,
                user_id=charlie.id,
                assignment_role=d_sci.name,
                function_id=func_rnd.id,
                assigned_date=date(2026, 6, 1),
            ))
            db.commit()
            print("  [+] Charlie re-joined MIL-PRJ-103 (new active stint from 2026-06-01)")
        else:
            print("  [~] Charlie already has an active MIL-PRJ-103 stint; skipping re-join.")

        # ============================================================ #
        # 11. FULL-YEAR DEMO DATA — Bob Builder, FY25-26                #
        # ============================================================ #
        # Loads Bob (bob@miltenyi.com, mentor Anjali Rao) with a
        # demo-quality "complete fiscal year" view for FY25-26:
        #   • 3 annual goals — every one walked end-to-end through
        #     APPROVED → H1 self → H1 mentor → H2 self → H2 mentor
        #     (final approval_status = H2_MENTOR_REVIEWED).
        #   • 4 project reviews on MIL-PRJ-100 (Q1..Q4 FY25-26),
        #     all REVIEWED with the full 7-competency comment set
        #     plus performance_group + impact_statement.
        #   • Annual review FY25-26 upgraded from baseline rating-2
        #     to a fully-published COMPLETED row at rating 1 with
        #     rich self + mentor + management calibration content.
        #
        # When demoing the "My Mentees → mentee detail" page,
        # open this account: bob@miltenyi.com (password123).
        # Log in as anjali.rao@healthark.ai to see the mentor view.

        # ── Narrative blocks for goal self-reviews / mentor reviews ──
        BOB_FLAGSHIP_GOAL_H1_SELF = (
            "Owned the full automation stack design for the CAR-T MVP this half — "
            "instrument selection, vendor evaluation, integration spec, and the "
            "first end-to-end pipeline demo. The biggest unlock was reframing the "
            "cellscreen handoff from a manual two-step into a fully automated "
            "single-pass — knocked ~40% off the per-run timeline. "
            "Authored the platform RFC and walked it through engineering, Mfg, "
            "and the senior R&D council without rework."
        )
        BOB_FLAGSHIP_GOAL_H1_MENTOR = (
            "Bob has been a model of self-starting ownership this half. The "
            "cellscreen handoff redesign was entirely his initiative and the data "
            "backs the timeline gains. He's getting sharper at framing trade-offs "
            "for senior stakeholders too — the platform RFC landed cleanly with "
            "engineering and Mfg leadership on the first review. Strong half."
        )
        BOB_FLAGSHIP_GOAL_H2_SELF = (
            "H2 was the validation push. Drove the GMP-grade validation campaign "
            "for the upstream module — 3 protocol revisions, 12 validation runs, "
            "zero deviations on the critical path. Handed off the validated module "
            "to Mfg in March with a complete artifact set. Also mentored Charlie "
            "through his first independent assay design as part of the H2 close."
        )
        BOB_FLAGSHIP_GOAL_H2_MENTOR = (
            "Exceptionally clean H2 delivery. Mfg accepted the validation "
            "artifacts on first pass — rare for a platform of this novelty. The "
            "mentoring of Charlie is showing real impact; Charlie's own H2 "
            "assay work has noticeably tightened. Bob is operating at the "
            "Senior Scientist mid-band confidently and is ready for stretch "
            "responsibilities in FY26-27."
        )

        BOB_MENTOR_GOAL_H1_SELF = (
            "H1 I focused on building Charlie's and Dana's confidence on "
            "instrument SOPs and data interpretation. Ran weekly office hours "
            "and maintained a shared internal doc with troubleshooting recipes. "
            "Charlie now independently designs his own validation plates."
        )
        BOB_MENTOR_GOAL_H1_MENTOR = (
            "Bob's mentoring approach is structured and consistent. The "
            "instrument troubleshooting recipe doc has become a team reference, "
            "used beyond his direct mentees. Charlie's confidence trajectory "
            "specifically has been impressive this half."
        )
        BOB_MENTOR_GOAL_H2_SELF = (
            "H2 widened the mentoring scope — onboarded two new joiners through "
            "their first validation runs, and ran a cross-team brown-bag series "
            "on assay debugging. The internal recipe doc now has 30+ entries and "
            "is the de-facto onboarding artifact for new R&D scientists."
        )
        BOB_MENTOR_GOAL_H2_MENTOR = (
            "Bob has quietly become a mentoring multiplier on this team. The "
            "brown-bag series has expanded mentoring impact beyond his own "
            "assigned mentees, and the recipe doc is now actively maintained by "
            "the broader team. Real culture work — exceeds expectations for the "
            "Senior Scientist band."
        )

        BOB_PAPER_GOAL_H1_SELF = (
            "Drafted the outline and first two sections of the internal "
            "technical paper on the cellscreen automation results. Took peer "
            "review feedback from two senior scientists and restructured the "
            "methodology section based on their comments — v2 is meaningfully "
            "sharper than v1."
        )
        BOB_PAPER_GOAL_H1_MENTOR = (
            "On track. The outline and methodology framing are solid. Bob took "
            "peer feedback constructively and the v2 is genuinely sharper than "
            "v1 — a good signal for the H2 finish."
        )
        BOB_PAPER_GOAL_H2_SELF = (
            "Completed the paper end-to-end, published to the internal "
            "knowledge base in February. Presented the work at the all-hands "
            "R&D session in March; received strong engagement and three new "
            "collaboration leads off the back of it."
        )
        BOB_PAPER_GOAL_H2_MENTOR = (
            "Paper landed well and the all-hands presentation was confident. "
            "The follow-on collaboration interest is a strong external signal. "
            "Bob has built up real technical-writing muscle this year — a "
            "stretch ask we set in April and fully delivered against."
        )

        # ── Helper: fully-completed annual goal ──────────────────────
        def _ensure_full_lifecycle_goal(
            owner: User, mentor: User, title: str, description: str,
            cycle_name: str, fy_year: int,
            h1_self: str, h1_mentor: str, h2_self: str, h2_mentor: str,
        ) -> Goal:
            existing = db.query(Goal).filter_by(
                org_id=miltenyi.id, user_id=owner.id,
                title=title, cycle_name=cycle_name,
            ).first()
            if existing:
                return existing
            g = Goal(
                org_id=miltenyi.id,
                user_id=owner.id, manager_id=mentor.id,
                title=title, description=description,
                goal_type=GoalType.ANNUAL.value, cycle_name=cycle_name,
                approval_status=ApprovalStatus.H2_MENTOR_REVIEWED.value,
                approved_at=datetime(fy_year, 4, 20, tzinfo=timezone.utc),
            )
            db.add(g)
            db.flush()
            db.add_all([
                GoalSelfReview(
                    goal_id=g.id, org_id=miltenyi.id,
                    cycle_half=SelfReviewCycleHalf.H1.value,
                    self_overall_review=h1_self,
                ),
                GoalMentorReview(
                    goal_id=g.id, org_id=miltenyi.id,
                    cycle_half=SelfReviewCycleHalf.H1.value,
                    mentor_overall_review=h1_mentor,
                ),
                GoalSelfReview(
                    goal_id=g.id, org_id=miltenyi.id,
                    cycle_half=SelfReviewCycleHalf.H2.value,
                    self_overall_review=h2_self,
                ),
                GoalMentorReview(
                    goal_id=g.id, org_id=miltenyi.id,
                    cycle_half=SelfReviewCycleHalf.H2.value,
                    mentor_overall_review=h2_mentor,
                ),
            ])
            db.commit()
            return g

        # 11a. Three FY25-26 annual goals, all fully lifecycle-completed
        _ensure_full_lifecycle_goal(
            bob, anjali,
            "Lead CAR-T Lab Automation MVP",
            "Stand up the end-to-end automated CAR-T processing MVP — own the "
            "design, build, validation, and hand-off to Mfg.",
            cycle_name="FY25-26", fy_year=2025,
            h1_self=BOB_FLAGSHIP_GOAL_H1_SELF,
            h1_mentor=BOB_FLAGSHIP_GOAL_H1_MENTOR,
            h2_self=BOB_FLAGSHIP_GOAL_H2_SELF,
            h2_mentor=BOB_FLAGSHIP_GOAL_H2_MENTOR,
        )
        _ensure_full_lifecycle_goal(
            bob, anjali,
            "Mentor Two Junior Scientists",
            "Coach Charlie and Dana through assay design and instrument SOPs; "
            "build a team-wide troubleshooting reference.",
            cycle_name="FY25-26", fy_year=2025,
            h1_self=BOB_MENTOR_GOAL_H1_SELF,
            h1_mentor=BOB_MENTOR_GOAL_H1_MENTOR,
            h2_self=BOB_MENTOR_GOAL_H2_SELF,
            h2_mentor=BOB_MENTOR_GOAL_H2_MENTOR,
        )
        _ensure_full_lifecycle_goal(
            bob, anjali,
            "Publish Internal Technical Paper on Automation Results",
            "Author and present an internal technical paper on the cellscreen "
            "automation outcomes; aim for an all-hands R&D session.",
            cycle_name="FY25-26", fy_year=2025,
            h1_self=BOB_PAPER_GOAL_H1_SELF,
            h1_mentor=BOB_PAPER_GOAL_H1_MENTOR,
            h2_self=BOB_PAPER_GOAL_H2_SELF,
            h2_mentor=BOB_PAPER_GOAL_H2_MENTOR,
        )
        print("  [+] Bob — 3 FY25-26 annual goals, each fully lifecycle-completed (H2_MENTOR_REVIEWED)")

        # 11b. Project reviews — Q1..Q4 FY25-26 on MIL-PRJ-100
        # Q1 FY25-26: platform design phase (Apr-Jun 2025)
        BOB_PR_Q1 = dict(
            cycle="Q1 FY25-26", pg="2",
            impact=(
                "Anchored the early platform design phase — instrument shortlist, "
                "integration spec, and the first cellscreen handoff prototype."
            ),
            comment_task_execution=(
                "Delivered the integration spec on a tight timeline; vendor "
                "evaluation matrix was thorough and decision-ready."
            ),
            comment_ownership=(
                "Took ownership of the platform design without prompting; "
                "raised the instrument-procurement risk early enough that we "
                "had buffer to react."
            ),
            comment_project_management=(
                "Clean tracker discipline from week one. Milestones reset "
                "transparently when the vendor pushback came in."
            ),
            comment_client_deliverables=(
                "Integration spec was client-ready on first review — "
                "engineering accepted it without redlines."
            ),
            comment_communication=(
                "Confident framing in cross-functional reviews. Wrote "
                "concise weekly summaries that the senior R&D council relied on."
            ),
            comment_mentoring=(
                "Started weekly office hours for Charlie and Dana from Week 3; "
                "engagement is good."
            ),
            comment_competency_skills=(
                "Strong foundation in cellscreen automation; growing breadth "
                "into vendor-management."
            ),
        )
        # Q2 FY25-26: build phase (Jul-Sep 2025)
        BOB_PR_Q2 = dict(
            cycle="Q2 FY25-26", pg="2",
            impact=(
                "Drove the upstream module build through the cellscreen handoff "
                "redesign — the 40% timeline gain on per-run cycle landed here."
            ),
            comment_task_execution=(
                "Reframed the cellscreen handoff to a single-pass automated "
                "step; ran the comparator analysis cleanly."
            ),
            comment_ownership=(
                "Stepped up when the vendor delivery slipped — improvised the "
                "stop-gap and kept the build moving."
            ),
            comment_project_management=(
                "Risk register stayed live; the vendor delay flag was raised "
                "with mitigation options, not just the problem."
            ),
            comment_client_deliverables=(
                "Build documentation is GMP-friendly already — will pay back "
                "in Q4 during validation."
            ),
            comment_communication=(
                "Clear cross-team comms when the timeline reset was needed; "
                "stakeholders aligned without escalation."
            ),
            comment_mentoring=(
                "Charlie attributes his first independent assay design to "
                "Bob's office-hours coaching."
            ),
            comment_competency_skills=(
                "Deepening on integration tooling; the comparator analysis "
                "showed real analytical rigor."
            ),
        )
        # Q3 FY25-26: validation prep (Oct-Dec 2025)
        BOB_PR_Q3 = dict(
            cycle="Q3 FY25-26", pg="1",
            impact=(
                "Authored the validation protocol set and ran the dry runs — "
                "set up the Q4 validation campaign to land cleanly."
            ),
            comment_task_execution=(
                "Validation protocols are exceptionally well-structured; the "
                "dry-run learnings folded back into protocol v2 efficiently."
            ),
            comment_ownership=(
                "Owned the whole validation prep without me needing to chase. "
                "Self-directed and reliable."
            ),
            comment_project_management=(
                "Validation plan with milestones, reagent ordering, and risk "
                "buffer all in one tracker. Best example on the line right now."
            ),
            comment_client_deliverables=(
                "Protocols passed internal QA review on first submission."
            ),
            comment_communication=(
                "Presented the validation plan to senior R&D council — "
                "confident, well-prepared, took pushback constructively."
            ),
            comment_mentoring=(
                "Started a cross-team brown-bag series on assay debugging — "
                "well-received beyond his immediate mentees."
            ),
            comment_competency_skills=(
                "Operating at the Senior Scientist mid-band confidently; "
                "validation rigor is genuinely strong."
            ),
        )
        # Q4 FY25-26: validation push + handoff (Jan-Mar 2026)
        BOB_PR_Q4 = dict(
            cycle="Q4 FY25-26", pg="1",
            impact=(
                "Closed the validation campaign — 12 runs, zero critical-path "
                "deviations — and handed the validated module to Mfg in March."
            ),
            comment_task_execution=(
                "Twelve validation runs with zero critical deviations is an "
                "outstanding result. Execution discipline through the close was "
                "exceptional."
            ),
            comment_ownership=(
                "Owned the Mfg handoff end-to-end including the post-handoff "
                "support window. Saw the work through, didn't just throw it "
                "over the wall."
            ),
            comment_project_management=(
                "Handoff plan was complete before the final run finished — "
                "rare for a project of this scope."
            ),
            comment_client_deliverables=(
                "Validation artifact set was accepted by Mfg on the first "
                "review pass. This basically never happens."
            ),
            comment_communication=(
                "Handoff briefing to Mfg leadership was crisp and "
                "well-pitched. Set up the relationship for FY26-27 work."
            ),
            comment_mentoring=(
                "Charlie's H2 work shows clear influence from Bob's mentoring "
                "model — independent design, GMP rigor, clean documentation."
            ),
            comment_competency_skills=(
                "Recognized SME on cellscreen automation; ready for stretch "
                "scope in FY26-27."
            ),
        )

        existing_bob_prs = (
            db.query(ProjectReview)
            .filter(
                ProjectReview.user_id == bob.id,
                ProjectReview.project_id == proj_bob_flagship.id,
            )
            .count()
        )
        if existing_bob_prs == 0:
            for spec in (BOB_PR_Q1, BOB_PR_Q2, BOB_PR_Q3, BOB_PR_Q4):
                cycle = spec.pop("cycle")
                pg = spec.pop("pg")
                impact = spec.pop("impact")
                db.add(ProjectReview(
                    org_id=miltenyi.id,
                    user_id=bob.id,
                    project_id=proj_bob_flagship.id,
                    reviewer_id=hans.id,
                    cycle=cycle,
                    status=ProjectReviewStatus.REVIEWED.value,
                    performance_group=pg,
                    impact_statement=impact,
                    **spec,
                ))
            db.commit()
            print("  [+] Bob — 4 project reviews on MIL-PRJ-100 (Q1..Q4 FY25-26), all REVIEWED")
        else:
            print("  [~] Bob's project reviews on MIL-PRJ-100 already exist; skipping.")

        # 11c. Upgrade Bob's existing FY25-26 annual review to demo-grade
        bob_ar = db.query(AnnualReview).filter_by(
            org_id=miltenyi.id, user_id=bob.id, cycle_name="FY25-26",
        ).first()
        if bob_ar:
            bob_ar.status = ReviewStatus.COMPLETED.value
            bob_ar.self_overall_review = (
                "FY25-26 was the year I stepped from 'execute on a workstream' "
                "into 'own the platform.' The headline outcome was the CAR-T "
                "automation MVP — designed, built, validated, and handed off to "
                "Mfg in March. The cellscreen handoff redesign in H1 was the "
                "single biggest unlock (~40% timeline gain per run), and the "
                "H2 validation campaign closed clean with 12 runs and zero "
                "critical-path deviations. Beyond the platform itself, I "
                "doubled down on mentoring — Charlie and Dana shipped their "
                "first independent assay designs this year, and the assay "
                "debugging brown-bag I started in Q3 is now a recurring team "
                "fixture. Finally, the internal technical paper on the "
                "automation results published in February and led to three "
                "collaboration conversations off the back of the R&D all-hands "
                "presentation. Headed into FY26-27 ready to take on broader "
                "platform scope and more formal team-lead responsibilities."
            )
            bob_ar.self_performance_rating = 1
            bob_ar.mentor_overall_review = (
                "Bob has delivered a standout year. The CAR-T automation MVP "
                "is the team's flagship outcome of the cycle and his ownership "
                "ran through every phase of it — design, build, validation, "
                "and the Mfg handoff. The most impressive trait this year has "
                "been the combination of technical depth and quiet leadership: "
                "the troubleshooting recipe doc and the assay-debugging "
                "brown-bag have lifted the bar across his peers, not just his "
                "direct mentees. Charlie's growth trajectory specifically is "
                "directly attributable to Bob's coaching. Comms with senior "
                "stakeholders are confident and well-pitched. Recommend "
                "promotion consideration for FY26-27 alongside stretch "
                "platform scope."
            )
            bob_ar.mentor_performance_rating = 1
            bob_ar.management_performance_rating = 1
            bob_ar.final_performance_rating = 1
            bob_ar.management_comments = (
                "Calibrated at the top of the Senior Scientist band. Mentor "
                "rating endorsed without adjustment. Promotion to Team Lead "
                "track flagged for the FY26-27 mid-year review. Stretch "
                "scope: lead the FY26-27 platform expansion programme."
            )
            bob_ar.final_rating_enabled = True
            db.commit()
            print("  [+] Bob — FY25-26 annual review upgraded to COMPLETED at rating 1 (demo-grade)")
        else:
            print("  [~] Bob's FY25-26 annual review row missing; demo upgrade skipped.")

        # ============================================================ #
        # DONE                                                          #
        # ============================================================ #
        print("\n" + "=" * 64)
        print("Database seeding completed.")
        print("=" * 64)
        print("\n--- ACCOUNTS (all passwords: password123) ---")
        print("  HR · Healthark : sarah.patel@healthark.ai   Sarah Patel")
        print("  HR · Miltenyi: karin.weber@miltenyi.com     Karin Weber")
        print("\n  Mentors (Healthark):")
        print("    anjali.rao@healthark.ai     Anjali Rao    (Bob, Charlie, Dana)")
        print("    mark.singh@healthark.ai     Mark Singh    (Iris, Evan, Fiona)")
        print("    priya.mehta@healthark.ai    Priya Mehta   (Klaus, Mia, Nils)")
        print("\n  PMs (Miltenyi):")
        print("    hans@miltenyi.com           Hans Müller   (PRJ-101, PRJ-103)")
        print("    greta@miltenyi.com          Greta Schmidt (PRJ-102)")
        print("    lukas@miltenyi.com          Lukas Lange   (PRJ-104)")
        print("    dieter@miltenyi.com         Dieter Becker (reserve)")
        print("\n  Employee (Healthark @ Miltenyi):")
        print("    R&D:        bob@, charlie@, dana@, iris@miltenyi.com")
        print("    Mfg:        evan@, fiona@, klaus@miltenyi.com")
        print("    Commercial: mia@, nils@miltenyi.com")
        print("\n--- LIFECYCLE TEST DATA ---")
        print("  MIL-PRJ-101 → Completed (Sarah, 2025-09-01); 3 historical assignments")
        print("  MIL-PRJ-103 → Charlie has TWO stints: ended 2026-04-30 + active 2026-06-01")
        print("    His Q1 PENDING review stays in Hans's queue (in-flight finish).")
        print("\n--- DEMO-READY MENTEE (FULL FY25-26 HISTORY) ---")
        print("  Bob Builder  →  bob@miltenyi.com          (Employee)")
        print("    Mentor    : Anjali Rao (anjali.rao@healthark.ai)")
        print("    Project   : MIL-PRJ-100 (CAR-T Platform Development Programme)")
        print("    Goals     : 3 annual goals, all H2_MENTOR_REVIEWED (full lifecycle)")
        print("    Project   : 4 reviews on MIL-PRJ-100 — Q1..Q4 FY25-26, all REVIEWED")
        print("    Annual Rv : FY25-26 COMPLETED at rating 1, final published")
        print("  → Demo: log in as anjali.rao@healthark.ai; My Mentees → Bob.")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
