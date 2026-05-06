"""
seed.py — Deterministic dev seed for the Miltenyi PMS instance.

Models the new collaborative role taxonomy: MyOrg (Healthark) staffs
employees to Miltenyi, who manage them on projects.

Accounts (all passwords: password123):
  HR · MyOrg (Healthark):
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

  Staff (Healthark employees with Miltenyi-issued accounts):
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
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.goal_models import Goal, ApprovalStatus, GoalType
from app.models.goal_self_review_models import GoalSelfReview, SelfReviewCycleHalf
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

        # ── HR · MyOrg (full super-admin) ─────────────────────────────
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

        # ── Staff (Healthark employees, Miltenyi-issued logins) ───────
        # Mentor pairings:
        #   Anjali → Bob, Charlie, Dana
        #   Mark   → Iris, Evan, Fiona
        #   Priya  → Klaus, Mia, Nils
        bob = _ensure_user(
            "bob@miltenyi.com",
            employee_code="STF-001", full_name="Bob Builder",
            phone="+49 30 1234 2001",
            role=Role.STAFF.value, mentor_id=anjali.id,
            function_id=func_rnd.id, designation_id=d_sr.id,
        )
        charlie = _ensure_user(
            "charlie@miltenyi.com",
            employee_code="STF-002", full_name="Charlie Chemist",
            phone="+49 30 1234 2002",
            role=Role.STAFF.value, mentor_id=anjali.id,
            function_id=func_rnd.id, designation_id=d_sci.id,
        )
        dana = _ensure_user(
            "dana@miltenyi.com",
            employee_code="STF-003", full_name="Dana DNA",
            phone="+49 30 1234 2003",
            role=Role.STAFF.value, mentor_id=anjali.id,
            function_id=func_rnd.id, designation_id=d_sci.id,
        )
        iris = _ensure_user(
            "iris@miltenyi.com",
            employee_code="STF-004", full_name="Iris Immel",
            phone="+49 30 1234 2004",
            role=Role.STAFF.value, mentor_id=mark.id,
            function_id=func_rnd.id, designation_id=d_sr.id,
        )
        evan = _ensure_user(
            "evan@miltenyi.com",
            employee_code="STF-005", full_name="Evan Engineer",
            phone="+49 30 1234 2005",
            role=Role.STAFF.value, mentor_id=mark.id,
            function_id=func_mfg.id, designation_id=d_lead.id,
        )
        fiona = _ensure_user(
            "fiona@miltenyi.com",
            employee_code="STF-006", full_name="Fiona Factory",
            phone="+49 30 1234 2006",
            role=Role.STAFF.value, mentor_id=mark.id,
            function_id=func_mfg.id, designation_id=d_sci.id,
        )
        klaus = _ensure_user(
            "klaus@miltenyi.com",
            employee_code="STF-007", full_name="Klaus Köhler",
            phone="+49 30 1234 2007",
            role=Role.STAFF.value, mentor_id=priya.id,
            function_id=func_mfg.id, designation_id=d_sci.id,
        )
        mia = _ensure_user(
            "mia@miltenyi.com",
            employee_code="STF-008", full_name="Mia Markt",
            phone="+49 30 1234 2008",
            role=Role.STAFF.value, mentor_id=priya.id,
            function_id=func_com.id, designation_id=d_sr.id,
        )
        nils = _ensure_user(
            "nils@miltenyi.com",
            employee_code="STF-009", full_name="Nils Niedermeier",
            phone="+49 30 1234 2009",
            role=Role.STAFF.value, mentor_id=priya.id,
            function_id=func_com.id, designation_id=d_sci.id,
        )
        print("  [+] Users (HR×2, Mentors×3, PMs×4, Staff×9)")

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
                updated_by_id=sarah.id,
            ))
            db.commit()
            print("  [+] System Settings (quarterly, Q1 FY26-27, MyOrg HR as updater)")
        else:
            print("  [~] System settings already exist; reusing.")

        # ============================================================ #
        # 5. PROJECTS                                                   #
        # ============================================================ #
        # PM = Miltenyi PM. Secondary = a non-PM/non-Mentor user (HR or other).
        # Members are Staff only — the PM is NOT in `assignments`.
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
        print("  [+] Projects: MIL-PRJ-101..104")

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
        # 7. ANNUAL GOALS + H1 SELF-REVIEWS (Staff only)                #
        # ============================================================ #
        # Goals are owned by Staff; the manager_id is the Staff's mentor.
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
            print("  [+] Annual goals (FY26-27) for all Staff with mixed approval states")
        else:
            print("  [~] Goals already exist; reusing.")

        # ============================================================ #
        # 8. ANNUAL REVIEWS (Staff only, mentor-driven)                 #
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
        # DONE                                                          #
        # ============================================================ #
        print("\n" + "=" * 64)
        print("Database seeding completed.")
        print("=" * 64)
        print("\n--- ACCOUNTS (all passwords: password123) ---")
        print("  HR · MyOrg :   sarah.patel@healthark.ai     Sarah Patel")
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
        print("\n  Staff (Healthark @ Miltenyi):")
        print("    R&D:        bob@, charlie@, dana@, iris@miltenyi.com")
        print("    Mfg:        evan@, fiona@, klaus@miltenyi.com")
        print("    Commercial: mia@, nils@miltenyi.com")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
