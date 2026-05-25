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
        # 2. FUNCTIONS & DESIGNATIONS (Miltenyi GCC career-path)        #
        # ============================================================ #
        # 8 GCC functions × 4 career levels. Some career levels host
        # multiple titles (Typical Titles in the GCC doc); each title
        # becomes its own Designation row sharing the same career_level.
        # RoleExpectation rows are keyed by (function, career_level),
        # so multiple Designations at the same band point at the same
        # expectations row.
        _LEVEL_LABEL = {1: "Entry", 2: "Mid", 3: "Senior", 4: "Lead"}

        # (function_name, career_level, [titles...])
        GCC_DESIGNATIONS: list[tuple[str, int, list[str]]] = [
            # Clinical Data Management
            ("Clinical Data Management", 1, ["Clinical Data Management Associate"]),
            ("Clinical Data Management", 2, ["Clinical Data Manager"]),
            ("Clinical Data Management", 3, ["Senior Clinical Data Manager"]),
            ("Clinical Data Management", 4, ["Lead - Clinical Data Manager"]),
            # Biostatistics
            ("Biostatistics", 1, ["Statistical Programmer", "Data Analyst"]),
            ("Biostatistics", 2, ["Biostatistician"]),
            ("Biostatistics", 3, ["Senior BioStatistician"]),
            ("Biostatistics", 4, ["Lead Biostatistician"]),
            # Regulatory Affairs
            ("Regulatory Affairs", 1, ["Regulatory Affairs Associate"]),
            ("Regulatory Affairs", 2, ["Senior Regulatory Affairs Associate",
                                       "Regulatory Affairs Specialist"]),
            ("Regulatory Affairs", 3, ["Regulatory Affairs Manager"]),
            ("Regulatory Affairs", 4, ["Regulatory Affairs Lead"]),
            # Pharmacovigilance
            ("Pharmacovigilance", 1, ["Pharmacovigilance Associate"]),
            ("Pharmacovigilance", 2, ["Pharmacovigilance Analyst"]),
            ("Pharmacovigilance", 3, ["Senior Pharmacovigilance Analyst"]),
            ("Pharmacovigilance", 4, ["Pharmacovigilance Lead"]),
            # Clinical Trial Management
            ("Clinical Trial Management", 1, ["Clinical Trial Associate"]),
            ("Clinical Trial Management", 2, ["Clinical Trial Manager"]),
            ("Clinical Trial Management", 3, ["Senior Clinical Trial Manager"]),
            ("Clinical Trial Management", 4, ["Lead - Clinical Trial Manager"]),
            # Medical Writing
            ("Medical Writing", 1, ["Medical Writing Associate"]),
            ("Medical Writing", 2, ["Medical Writer"]),
            ("Medical Writing", 3, ["Senior Medical Writer"]),
            ("Medical Writing", 4, ["Lead Medical Writing"]),
            # Clinical Trial Finance
            ("Clinical Trial Finance", 1, ["Clinical Finance Analyst"]),
            ("Clinical Trial Finance", 2, ["Senior Clinical Finance Analyst"]),
            ("Clinical Trial Finance", 3, ["Clinical Finance Manager"]),
            ("Clinical Trial Finance", 4, ["Lead Clinical Finance Manager"]),
            # Legal
            ("Legal", 1, ["Legal Associate"]),
            ("Legal", 2, ["Legal Counsel"]),
            ("Legal", 3, ["Senior Legal Counsel", "Legal Manager"]),
            ("Legal", 4, ["Lead Legal Counsel"]),
        ]

        if db.query(Function).filter(Function.org_id == miltenyi.id).count() == 0:
            # Functions
            gcc_function_names = sorted({fname for fname, _, _ in GCC_DESIGNATIONS})
            for fname in gcc_function_names:
                db.add(Function(org_id=miltenyi.id, name=fname))
            db.flush()

            # Designations — each title gets its own row. `level` (legacy
            # int) is left at the default of 1; `career_level` carries the
            # GCC band that everything actually keys on.
            for _, lvl, titles in GCC_DESIGNATIONS:
                for title in titles:
                    db.add(Designation(
                        org_id=miltenyi.id,
                        name=title,
                        level=lvl,                  # legacy sort, matches band for now
                        career_level=lvl,
                        career_level_label=_LEVEL_LABEL[lvl],
                    ))
            db.commit()
            print(f"  [+] Created {len(gcc_function_names)} GCC Functions and "
                  f"{sum(len(t) for _, _, t in GCC_DESIGNATIONS)} Designations")
        else:
            print("  [~] Reference data already exists; reusing.")

        # ── Resolve function handles ──────────────────────────────────
        def _fn(name: str) -> Function:
            return db.query(Function).filter_by(org_id=miltenyi.id, name=name).first()

        func_cdm   = _fn("Clinical Data Management")
        func_bio   = _fn("Biostatistics")
        func_ra    = _fn("Regulatory Affairs")
        func_pv    = _fn("Pharmacovigilance")
        func_ctm   = _fn("Clinical Trial Management")
        func_mw    = _fn("Medical Writing")
        func_ctf   = _fn("Clinical Trial Finance")
        func_legal = _fn("Legal")

        # ── Resolve designation handles ───────────────────────────────
        def _desig(name: str) -> Designation:
            return db.query(Designation).filter_by(org_id=miltenyi.id, name=name).first()

        # Regulatory Affairs band
        d_ra_specialist  = _desig("Regulatory Affairs Specialist")        # L2 Mid
        d_ra_assoc_sr    = _desig("Senior Regulatory Affairs Associate")  # L2 Mid
        d_ra_manager     = _desig("Regulatory Affairs Manager")           # L3 Senior
        d_ra_lead        = _desig("Regulatory Affairs Lead")              # L4 Lead
        # Clinical Data Management band
        d_cdm_sr         = _desig("Senior Clinical Data Manager")         # L3 Senior
        d_cdm_lead       = _desig("Lead - Clinical Data Manager")         # L4 Lead
        # Clinical Trial Management band
        d_ctm_mgr        = _desig("Clinical Trial Manager")               # L2 Mid
        d_ctm_lead       = _desig("Lead - Clinical Trial Manager")        # L4 Lead
        # Pharmacovigilance band
        d_pv_analyst     = _desig("Pharmacovigilance Analyst")            # L2 Mid
        d_pv_sr_analyst  = _desig("Senior Pharmacovigilance Analyst")     # L3 Senior
        d_pv_lead        = _desig("Pharmacovigilance Lead")               # L4 Lead
        # Medical Writing band
        d_mw_writer      = _desig("Medical Writer")                       # L2 Mid
        d_mw_sr_writer   = _desig("Senior Medical Writer")                # L3 Senior
        d_mw_lead        = _desig("Lead Medical Writing")                 # L4 Lead

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

        # HR + Mentors don't sit inside a GCC function — they're framework-
        # external. Their function_id / designation_id stay None.

        # ── HR · Healthark (full super-admin) ─────────────────────────
        sarah = _ensure_user(
            "sarah.patel@healthark.ai",
            employee_code="HRK-001", full_name="Sarah Patel",
            phone="+91 98000 00001",
            role=Role.HR_MYORG.value,
            function_id=None, designation_id=None,
        )

        # ── HR · Miltenyi (limited admin) ─────────────────────────────
        karin = _ensure_user(
            "karin.weber@miltenyi.com",
            employee_code="MIL-HR-001", full_name="Karin Weber",
            phone="+49 30 1234 0001",
            role=Role.HR_MILTENYI.value,
            function_id=None, designation_id=None,
        )

        # ── Mentors (Healthark — fixed pool of 3) ─────────────────────
        anjali = _ensure_user(
            "anjali.rao@healthark.ai",
            employee_code="HRK-M01", full_name="Anjali Rao",
            phone="+91 98000 00010",
            role=Role.MENTOR.value,
            function_id=None, designation_id=None,
        )
        mark = _ensure_user(
            "mark.singh@healthark.ai",
            employee_code="HRK-M02", full_name="Mark Singh",
            phone="+91 98000 00011",
            role=Role.MENTOR.value,
            function_id=None, designation_id=None,
        )
        priya = _ensure_user(
            "priya.mehta@healthark.ai",
            employee_code="HRK-M03", full_name="Priya Mehta",
            phone="+91 98000 00012",
            role=Role.MENTOR.value,
            function_id=None, designation_id=None,
        )

        # ── PMs (Miltenyi — each sits in a GCC function at Lead band) ─
        hans = _ensure_user(
            "hans@miltenyi.com",
            employee_code="MIL-PM-01", full_name="Hans Müller",
            phone="+49 30 1234 1001",
            role=Role.PM.value,
            function_id=func_ra.id, designation_id=d_ra_lead.id,
        )
        greta = _ensure_user(
            "greta@miltenyi.com",
            employee_code="MIL-PM-02", full_name="Greta Schmidt",
            phone="+49 30 1234 1002",
            role=Role.PM.value,
            function_id=func_ctm.id, designation_id=d_ctm_lead.id,
        )
        lukas = _ensure_user(
            "lukas@miltenyi.com",
            employee_code="MIL-PM-03", full_name="Lukas Lange",
            phone="+49 30 1234 1003",
            role=Role.PM.value,
            function_id=func_mw.id, designation_id=d_mw_lead.id,
        )
        dieter = _ensure_user(
            "dieter@miltenyi.com",
            employee_code="MIL-PM-04", full_name="Dieter Becker",
            phone="+49 30 1234 1004",
            role=Role.PM.value,
            function_id=func_pv.id, designation_id=d_pv_lead.id,
        )

        # ── Employees ─────────────────────────────────────────────────
        # Mentor pairings (preserved from the original seed):
        #   Anjali → Bob, Charlie, Dana    (all Regulatory Affairs)
        #   Mark   → Iris, Evan, Fiona     (cross-functional: CDM, CTM, PV)
        #   Priya  → Klaus, Mia, Nils      (cross-functional: PV, MW, MW)
        #
        # Bob is the demo-grade mentee for "My Mentees" walkthroughs and
        # is intentionally pinned to Regulatory Affairs Manager (L3).
        bob = _ensure_user(
            "bob@miltenyi.com",
            employee_code="STF-001", full_name="Bob Builder",
            phone="+49 30 1234 2001",
            role=Role.EMPLOYEE.value, mentor_id=anjali.id,
            function_id=func_ra.id, designation_id=d_ra_manager.id,
        )
        charlie = _ensure_user(
            "charlie@miltenyi.com",
            employee_code="STF-002", full_name="Charlie Chemist",
            phone="+49 30 1234 2002",
            role=Role.EMPLOYEE.value, mentor_id=anjali.id,
            function_id=func_ra.id, designation_id=d_ra_specialist.id,
        )
        dana = _ensure_user(
            "dana@miltenyi.com",
            employee_code="STF-003", full_name="Dana DNA",
            phone="+49 30 1234 2003",
            role=Role.EMPLOYEE.value, mentor_id=anjali.id,
            function_id=func_ra.id, designation_id=d_ra_assoc_sr.id,
        )
        iris = _ensure_user(
            "iris@miltenyi.com",
            employee_code="STF-004", full_name="Iris Immel",
            phone="+49 30 1234 2004",
            role=Role.EMPLOYEE.value, mentor_id=mark.id,
            function_id=func_cdm.id, designation_id=d_cdm_sr.id,
        )
        evan = _ensure_user(
            "evan@miltenyi.com",
            employee_code="STF-005", full_name="Evan Engineer",
            phone="+49 30 1234 2005",
            role=Role.EMPLOYEE.value, mentor_id=mark.id,
            function_id=func_ctm.id, designation_id=d_ctm_mgr.id,
        )
        fiona = _ensure_user(
            "fiona@miltenyi.com",
            employee_code="STF-006", full_name="Fiona Factory",
            phone="+49 30 1234 2006",
            role=Role.EMPLOYEE.value, mentor_id=mark.id,
            function_id=func_pv.id, designation_id=d_pv_analyst.id,
        )
        klaus = _ensure_user(
            "klaus@miltenyi.com",
            employee_code="STF-007", full_name="Klaus Köhler",
            phone="+49 30 1234 2007",
            role=Role.EMPLOYEE.value, mentor_id=priya.id,
            function_id=func_pv.id, designation_id=d_pv_sr_analyst.id,
        )
        mia = _ensure_user(
            "mia@miltenyi.com",
            employee_code="STF-008", full_name="Mia Markt",
            phone="+49 30 1234 2008",
            role=Role.EMPLOYEE.value, mentor_id=priya.id,
            function_id=func_mw.id, designation_id=d_mw_sr_writer.id,
        )
        nils = _ensure_user(
            "nils@miltenyi.com",
            employee_code="STF-009", full_name="Nils Niedermeier",
            phone="+49 30 1234 2009",
            role=Role.EMPLOYEE.value, mentor_id=priya.id,
            function_id=func_mw.id, designation_id=d_mw_writer.id,
        )
        print("  [+] Users (HR×2, Mentors×3, PMs×4, Employee×9 across 5 GCC functions)")

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
        # Reframed as a Regulatory Affairs programme to match Bob's
        # Regulatory Affairs Manager designation under the GCC framework.
        proj_bob_flagship = _ensure_project(
            "MIL-PRJ-100",
            "FY25-26 Global Regulatory Submissions Programme",
            "Year-long Regulatory Affairs programme covering EMA + FDA submissions across the cell-therapy portfolio — Bob's flagship engagement.",
            pm=hans, secondary=sarah,
            start=date(2025, 4, 1), end=date(2026, 3, 31),
            members=[
                (bob, d_ra_manager, func_ra, date(2025, 4, 1)),
            ],
        )
        proj_cell = _ensure_project(
            "MIL-PRJ-101",
            "Next-Gen CAR-T Regulatory Strategy",
            "Build the regulatory submission strategy for the next-gen CAR-T platform ahead of EMA + FDA filings.",
            pm=hans, secondary=sarah,
            start=date(2025, 1, 15), end=date(2025, 8, 15),
            members=[
                (bob,     d_ra_manager,    func_ra, date(2025, 1, 15)),
                (charlie, d_ra_specialist, func_ra, date(2025, 1, 22)),
                (dana,    d_ra_assoc_sr,   func_ra, date(2025, 2, 1)),
            ],
        )
        proj_macs = _ensure_project(
            "MIL-PRJ-102",
            "MACS Quant Clinical Trial Program",
            "Multi-site clinical trial programme for the next-gen MACS Quant platform — operations, monitoring, safety.",
            pm=greta, secondary=karin,
            start=date(2025, 3, 5), end=date(2025, 11, 30),
            members=[
                (evan,  d_ctm_mgr,       func_ctm, date(2025, 3, 5)),
                (fiona, d_pv_analyst,    func_pv,  date(2025, 3, 5)),
                (klaus, d_pv_sr_analyst, func_pv,  date(2025, 3, 18)),
            ],
        )
        proj_validation = _ensure_project(
            "MIL-PRJ-103",
            "Cell Therapy Submission Readiness",
            "Coordinated CDM + RA workstream preparing the submission package for the cell-therapy pipeline ahead of clinical hand-off.",
            pm=hans, secondary=sarah,
            start=date(2026, 1, 8), end=date(2026, 9, 30),
            members=[
                (iris,    d_cdm_sr,        func_cdm, date(2026, 1, 8)),
                (charlie, d_ra_specialist, func_ra,  date(2026, 1, 8)),
                (dana,    d_ra_assoc_sr,   func_ra,  date(2026, 1, 22)),
            ],
        )
        proj_launch = _ensure_project(
            "MIL-PRJ-104",
            "Medical Writing — Launch Documentation 2026",
            "End-to-end medical-writing deliverables (study reports, regulatory dossier sections, launch collateral) for the 2026 launches.",
            pm=lukas, secondary=karin,
            start=date(2026, 1, 5), end=date(2026, 12, 31),
            members=[
                (mia,  d_mw_sr_writer, func_mw, date(2026, 1, 5)),
                (nils, d_mw_writer,    func_mw, date(2026, 1, 5)),
            ],
        )
        print("  [+] Projects: MIL-PRJ-100..104")

        # ============================================================ #
        # 6. ROLE EXPECTATIONS (Miltenyi GCC career-path content)       #
        # ============================================================ #
        # Verbatim transcription of the v1.1 Miltenyi GCC career-path
        # spreadsheet. 32 rows keyed by (function_name, career_level).
        # Inserted into role_expectations such that every designation at
        # a given (function, career_level) bucket points at this row.
        GCC_ROLE_EXPECTATIONS: dict[tuple[str, int], dict[str, str]] = {
            # ── Clinical Data Management ─────────────────────────────
            ("Clinical Data Management", 1): {
                "exp_scope_of_role": "Supports CRF review, data entry validation, and data cleaning activities",
                "exp_key_responsibilities": "Performs data review, query generation, discrepancy management, and study data tracking.",
                "exp_technical_competencies": "EDC systems (Medidata Rave/Oracle Clinical), data validation, query management, CDISC awareness.",
                "exp_delivery_ownership": "Task level",
                "exp_regulatory_compliance": "Query management, data validation checks.",
                "exp_project_resource_management": "Works under supervision",
            },
            ("Clinical Data Management", 2): {
                "exp_scope_of_role": "Manages study-level data review cycles and query resolution.",
                "exp_key_responsibilities": "Oversees data cleaning, database updates, reconciliation activities, and data quality checks.",
                "exp_technical_competencies": "Database build review, edit checks, reconciliation (SAE/lab/vendor data), CDISC standards.",
                "exp_delivery_ownership": "Study / functional deliverables",
                "exp_regulatory_compliance": "Database lock activities, SAE reconciliation.",
                "exp_project_resource_management": "Limited project coordination",
            },
            ("Clinical Data Management", 3): {
                "exp_scope_of_role": "Leads data management activities across clinical studies.",
                "exp_key_responsibilities": "Manages database lock readiness, vendor coordination, and cross-functional data governance.",
                "exp_technical_competencies": "Advanced CDISC implementation (SDTM/ADaM), vendor data integration, database governance.",
                "exp_delivery_ownership": "Study or program ownership",
                "exp_regulatory_compliance": "Vendor coordination, risk-based data review.",
                "exp_project_resource_management": "Team management and resource allocation",
            },
            ("Clinical Data Management", 4): {
                "exp_scope_of_role": "Provides strategic oversight of clinical data management across programs",
                "exp_key_responsibilities": "Defines CDM strategy, oversees multi-study data governance, and drives data quality frameworks",
                "exp_technical_competencies": "Enterprise data standards, global CDISC compliance, data architecture strategy.",
                "exp_delivery_ownership": "Portfolio or organizational oversight",
                "exp_regulatory_compliance": "Data strategy, inspection readiness, CDISC governance.",
                "exp_project_resource_management": "Department leadership and budget accountability",
            },
            # ── Biostatistics ─────────────────────────────────────────
            ("Biostatistics", 1): {
                "exp_scope_of_role": "Supports statistical programming and clinical data analysis activities.",
                "exp_key_responsibilities": "Assists in generating datasets, statistical outputs, and data summaries for clinical studies",
                "exp_technical_competencies": "SAS/R programming, clinical data standards awareness, data validation, statistical reporting.",
                "exp_delivery_ownership": "Task Level",
                "exp_regulatory_compliance": "Compliance with CDISC standards and statistical documentation requirements.",
                "exp_project_resource_management": "Works under supervision",
            },
            ("Biostatistics", 2): {
                "exp_scope_of_role": "Performs statistical analysis and supports study design and data interpretation.",
                "exp_key_responsibilities": "Develops statistical analysis plans, performs data analysis, and interprets clinical study data",
                "exp_technical_competencies": "Statistical modeling, SAS/R programming, clinical trial design, CDISC standards (SDTM/ADaM).",
                "exp_delivery_ownership": "Task level/functional deliverables",
                "exp_regulatory_compliance": "Statistical analysis compliance for regulatory submissions.",
                "exp_project_resource_management": "Limited project coordination",
            },
            ("Biostatistics", 3): {
                "exp_scope_of_role": "Leads statistical analysis for clinical studies and ensures methodological accuracy.",
                "exp_key_responsibilities": "Oversees statistical analysis plans, reviews outputs, and supports regulatory submissions.",
                "exp_technical_competencies": "Advanced biostatistics methods, trial design strategy, regulatory submission support.",
                "exp_delivery_ownership": "Study or program ownership/functional deliverables",
                "exp_regulatory_compliance": "Health authority statistical review readiness and regulatory compliance",
                "exp_project_resource_management": "Team management and resource allocation",
            },
            ("Biostatistics", 4): {
                "exp_scope_of_role": "Provides strategic statistical leadership across clinical programs.",
                "exp_key_responsibilities": "Defines statistical strategy, oversees complex analyses, and supports regulatory interactions.",
                "exp_technical_competencies": "Advanced statistical methodologies, regulatory strategy alignment, portfolio-level analytics.",
                "exp_delivery_ownership": "Portfolio or organizational oversight",
                "exp_regulatory_compliance": "Global regulatory submission strategy and statistical governance.",
                "exp_project_resource_management": "Department leadership and budget accountability",
            },
            # ── Regulatory Affairs ────────────────────────────────────
            ("Regulatory Affairs", 1): {
                "exp_scope_of_role": "Supports regulatory documentation and submission preparation activities.",
                "exp_key_responsibilities": "Assists in preparation, formatting, and tracking of regulatory submission documents and correspondence.",
                "exp_technical_competencies": "Regulatory guidelines awareness, document management systems, submission formatting, regulatory research.",
                "exp_delivery_ownership": "Task level",
                "exp_regulatory_compliance": "Basic awareness of regulatory frameworks (ICH, GCP)",
                "exp_project_resource_management": "Works under supervision",
            },
            ("Regulatory Affairs", 2): {
                "exp_scope_of_role": "Manages regulatory submission preparation and supports regulatory strategy execution.",
                "exp_key_responsibilities": "Prepares regulatory submissions, tracks approval timelines, and coordinates with cross-functional teams.",
                "exp_technical_competencies": "Regulatory submission preparation, regulatory intelligence, dossier management, submission systems (eCTD).",
                "exp_delivery_ownership": "Study / functional deliverables",
                "exp_regulatory_compliance": "Submission compliance monitoring and regulatory documentation management.",
                "exp_project_resource_management": "Limited project coordination",
            },
            ("Regulatory Affairs", 3): {
                "exp_scope_of_role": "Leads regulatory submission activities and ensures compliance with global regulatory requirements.",
                "exp_key_responsibilities": "Oversees regulatory submissions, manages health authority interactions, and drives regulatory strategy implementation.",
                "exp_technical_competencies": "Regulatory strategy development, submission management, regulatory intelligence, risk assessment",
                "exp_delivery_ownership": "Study or program ownership",
                "exp_regulatory_compliance": "Regulatory authority interactions and submission governance.",
                "exp_project_resource_management": "Team management and resource allocation",
            },
            ("Regulatory Affairs", 4): {
                "exp_scope_of_role": "Provides strategic regulatory oversight across programs and ensures global regulatory compliance.",
                "exp_key_responsibilities": "Defines regulatory strategy, oversees global submissions, and manages regulatory risk and governance.",
                "exp_technical_competencies": "Global regulatory strategy, health authority negotiation, regulatory policy interpretation, governance frameworks.",
                "exp_delivery_ownership": "Portfolio or organizational oversight",
                "exp_regulatory_compliance": "Global regulatory compliance leadership and health authority engagement.",
                "exp_project_resource_management": "Department leadership and budget accountability",
            },
            # ── Pharmacovigilance ─────────────────────────────────────
            ("Pharmacovigilance", 1): {
                "exp_scope_of_role": "Performs individual case safety report (ICSR) processing under supervision.",
                "exp_key_responsibilities": "• Review source documents to identify AEs/SAEs. • Enter safety data into PV database (Argus/ArisG) as per CDSCO/DCGI timelines. • Draft medically sound case narratives. • Code adverse events using MedDRA. • Track follow-up requests to ensure case completeness.",
                "exp_technical_competencies": "MedDRA coding, safety database systems (Argus/ArisG), ICSR processing basics.",
                "exp_delivery_ownership": "Task level",
                "exp_regulatory_compliance": "ICSR data entry, MedDRA coding, narrative writing, follow-up tracking.",
                "exp_project_resource_management": "Works under supervision",
            },
            ("Pharmacovigilance", 2): {
                "exp_scope_of_role": "Independently manages case processing, literature review, and supports signal detection activities.",
                "exp_key_responsibilities": "• Independently process and QC AE/SAE cases. • Perform database reconciliation and ensure timely reporting. • Monitor safety signal trends and escalate potential risks. • Contribute to aggregate reports (PSUR/PBRER). • Support audit and inspection documentation readiness.",
                "exp_technical_competencies": "Advanced case processing, safety database management, signal monitoring basics.",
                "exp_delivery_ownership": "Study / functional deliverables",
                "exp_regulatory_compliance": "Quality review of cases, reconciliation activities, aggregate report inputs (PSUR/PBRER/DSUR).",
                "exp_project_resource_management": "Limited project coordination",
            },
            ("Pharmacovigilance", 3): {
                "exp_scope_of_role": "Leads PV case teams, oversees aggregate reporting and signal management processes.",
                "exp_key_responsibilities": "• Lead signal detection and benefit-risk evaluations. • Oversee SAE reporting compliance and quality metrics. • Manage vendor oversight and workload distribution. • Interface with Regulatory and Medical teams for safety strategy.",
                "exp_technical_competencies": "Advanced GVP knowledge, signal detection methods, safety data analysis.",
                "exp_delivery_ownership": "Study or program ownership",
                "exp_regulatory_compliance": "Signal detection review, health authority response coordination, vendor oversight.",
                "exp_project_resource_management": "Team management and resource allocation",
            },
            ("Pharmacovigilance", 4): {
                "exp_scope_of_role": "Drives PV strategy, inspection readiness, global safety governance.",
                "exp_key_responsibilities": "• Define pharmacovigilance governance framework. • Lead regulatory authority inspections (CDSCO/FDA/EMA). • Drive risk management strategy and signal governance. • Ensure enterprise-level compliance and PV system optimization.",
                "exp_technical_competencies": "Global pharmacovigilance strategy, safety governance frameworks, regulatory risk management.",
                "exp_delivery_ownership": "Portfolio or organizational oversight",
                "exp_regulatory_compliance": "Risk management strategy, global audit readiness, HA inspections (FDA/EMA/MHRA).",
                "exp_project_resource_management": "Department leadership and budget accountability",
            },
            # ── Clinical Trial Management ─────────────────────────────
            ("Clinical Trial Management", 1): {
                "exp_scope_of_role": "Supports clinical trial operations and documentation activities.",
                "exp_key_responsibilities": "Assists in site documentation review, trial tracking, and coordination of study activities.",
                "exp_technical_competencies": "GCP awareness, clinical trial documentation, CTMS usage, site communication.",
                "exp_delivery_ownership": "Task level",
                "exp_regulatory_compliance": "Protocol compliance and trial documentation standards.",
                "exp_project_resource_management": "Works under supervision supporting study coordination, tracker updates, and operational task execution.",
            },
            ("Clinical Trial Management", 2): {
                "exp_scope_of_role": "Manages operational execution of clinical trials across sites.",
                "exp_key_responsibilities": "Oversees site performance, trial timelines, vendor coordination, and monitoring activities.",
                "exp_technical_competencies": "Clinical trial management, CTMS tools, site management, risk mitigation.",
                "exp_delivery_ownership": "Study / functional deliverables",
                "exp_regulatory_compliance": "Monitoring compliance and audit readiness support.",
                "exp_project_resource_management": "Limited project coordination including site performance tracking, vendor coordination, and milestone monitoring.",
            },
            ("Clinical Trial Management", 3): {
                "exp_scope_of_role": "Leads global or regional clinical trial operations and delivery.",
                "exp_key_responsibilities": "Manages cross-functional coordination, study timelines, vendor oversight, and quality compliance.",
                "exp_technical_competencies": "Global trial management, risk-based monitoring, vendor governance.",
                "exp_delivery_ownership": "Study or program ownership",
                "exp_regulatory_compliance": "Health authority inspection readiness and regulatory compliance.",
                "exp_project_resource_management": "Team management and resource allocation across study-level clinical trial activities and operational deliverables.",
            },
            ("Clinical Trial Management", 4): {
                "exp_scope_of_role": "Provides strategic oversight for clinical trial programs across the portfolio.",
                "exp_key_responsibilities": "Defines trial execution strategy, oversees multiple studies, and drives operational excellence.",
                "exp_technical_competencies": "Clinical development strategy, portfolio trial governance, operational leadership.",
                "exp_delivery_ownership": "Portfolio or organizational oversight",
                "exp_regulatory_compliance": "Global clinical trial compliance and regulatory governance.",
                "exp_project_resource_management": "Team management and resource allocation across study-level clinical trial activities and operational deliverables.",
            },
            # ── Medical Writing ───────────────────────────────────────
            ("Medical Writing", 1): {
                "exp_scope_of_role": "Supports preparation and formatting of clinical and regulatory documents under supervision while ensuring adherence to scientific accuracy and regulatory guidelines.",
                "exp_key_responsibilities": "Assists in drafting, editing, formatting, and quality checking of clinical and regulatory documents while coordinating with cross-functional teams.",
                "exp_technical_competencies": "Scientific writing fundamentals, literature review, clinical study document structure, referencing tools, and basic regulatory writing guidelines.",
                "exp_delivery_ownership": "Basic awareness of ICH GCP / regulatory frameworks",
                "exp_regulatory_compliance": "Document formatting, literature citation compliance, basic regulatory document review.",
                "exp_project_resource_management": "Works under supervision",
            },
            ("Medical Writing", 2): {
                "exp_scope_of_role": "Independently develops clinical and regulatory documents by interpreting scientific data and collaborating with cross-functional teams.",
                "exp_key_responsibilities": "Drafts and manages clinical and regulatory documents such as protocols, CSRs, and study reports while ensuring consistency and adherence to timelines.",
                "exp_technical_competencies": "Regulatory writing expertise, data interpretation, clinical document development, referencing systems, and document management systems.",
                "exp_delivery_ownership": "Working knowledge of regulatory submission requirements",
                "exp_regulatory_compliance": "Submission document preparation, regulatory writing compliance, document QC for submission readiness.",
                "exp_project_resource_management": "Limited project coordination",
            },
            ("Medical Writing", 3): {
                "exp_scope_of_role": "Leads development of complex clinical and regulatory documents while ensuring quality, regulatory compliance, and strategic alignment with clinical programs.",
                "exp_key_responsibilities": "Oversees preparation of complex regulatory documents, reviews deliverables, mentors junior writers, and ensures consistency across clinical programs.",
                "exp_technical_competencies": "Advanced regulatory writing strategy, complex document development, clinical data interpretation, publication planning, and quality review expertise.",
                "exp_delivery_ownership": "Regulatory inspection readiness",
                "exp_regulatory_compliance": "Regulatory submission documentation oversight, health authority response coordination, and audit readiness support.",
                "exp_project_resource_management": "Team management and resource allocation",
            },
            ("Medical Writing", 4): {
                "exp_scope_of_role": "Provides strategic oversight of medical writing activities across programs, ensuring consistency, regulatory compliance, and alignment with global clinical development objectives.",
                "exp_key_responsibilities": "Defines medical writing strategy, oversees global document development, ensures regulatory submission readiness, and drives writing standards and governance.",
                "exp_technical_competencies": "Global regulatory writing strategy, document governance frameworks, enterprise writing standards, submission strategy alignment, and digital authoring tools.",
                "exp_delivery_ownership": "Global regulatory and compliance oversight",
                "exp_regulatory_compliance": "Global regulatory submission strategy, health authority interactions, and enterprise compliance oversight.",
                "exp_project_resource_management": "Department leadership and budget accountability",
            },
            # ── Clinical Trial Finance ────────────────────────────────
            ("Clinical Trial Finance", 1): {
                "exp_scope_of_role": "Supports financial tracking and reporting for clinical trials, including budget monitoring, invoice processing, and financial data reconciliation under supervision.",
                "exp_key_responsibilities": "Assists in study budget tracking, invoice processing, financial reconciliation, and preparation of financial reports for clinical trials.",
                "exp_technical_competencies": "Clinical trial budgeting basics, financial data analysis, Excel-based financial tracking, invoice reconciliation, and financial reporting fundamentals.",
                "exp_delivery_ownership": "Task level",
                "exp_regulatory_compliance": "Financial documentation accuracy, invoice verification, and compliance with internal financial policies.",
                "exp_project_resource_management": "Works under supervision",
            },
            ("Clinical Trial Finance", 2): {
                "exp_scope_of_role": "Independently manages study-level financial tracking, budget reconciliation, and financial reporting while coordinating with clinical operations and vendors.",
                "exp_key_responsibilities": "Monitors study budgets, reviews vendor invoices, manages financial reconciliation, and prepares financial reports aligned with study timelines.",
                "exp_technical_competencies": "Clinical trial budget management, financial forecasting, cost tracking tools, financial reconciliation, and financial analytics",
                "exp_delivery_ownership": "Study / functional deliverables",
                "exp_regulatory_compliance": "Budget compliance monitoring, audit documentation support, and financial reporting accuracy.",
                "exp_project_resource_management": "Limited project coordination",
            },
            ("Clinical Trial Finance", 3): {
                "exp_scope_of_role": "Leads financial management of clinical trials including budget planning, forecasting, financial risk monitoring, and oversight of study financial performance.",
                "exp_key_responsibilities": "Oversees clinical trial budget planning, financial forecasting, cost variance analysis, and vendor financial performance monitoring.",
                "exp_technical_competencies": "Advanced clinical finance strategy, budget forecasting, financial risk assessment, contract and vendor financial oversight.",
                "exp_delivery_ownership": "Study or program ownership",
                "exp_regulatory_compliance": "Financial governance, regulatory financial audit readiness, and compliance with clinical trial financial regulations.",
                "exp_project_resource_management": "Team management and resource allocation",
            },
            ("Clinical Trial Finance", 4): {
                "exp_scope_of_role": "Provides strategic oversight of clinical trial financial operations across programs, ensuring budget governance, financial compliance, and alignment with global clinical development strategy.",
                "exp_key_responsibilities": "Defines financial governance frameworks, oversees portfolio-level budgets, manages financial risk strategies, and aligns clinical finance with global R&D strategy.",
                "exp_technical_competencies": "Enterprise financial strategy, portfolio budget governance, financial analytics frameworks, and global financial compliance.",
                "exp_delivery_ownership": "Portfolio or organizational oversight",
                "exp_regulatory_compliance": "Global financial compliance oversight, audit leadership, and enterprise clinical finance governance.",
                "exp_project_resource_management": "Department leadership and budget accountability",
            },
            # ── Legal ────────────────────────────────────────────────
            ("Legal", 1): {
                "exp_scope_of_role": "Supports legal documentation review and contract management activities.",
                "exp_key_responsibilities": "Assists in contract review, legal documentation preparation, and compliance tracking.",
                "exp_technical_competencies": "Contract review basics, legal research, regulatory awareness, document management.",
                "exp_delivery_ownership": "Task level",
                "exp_regulatory_compliance": "Legal documentation compliance and regulatory policy awareness.",
                "exp_project_resource_management": "Works under supervision/Limited project coordination",
            },
            ("Legal", 2): {
                "exp_scope_of_role": "Provides legal advisory and contract management support across business functions.",
                "exp_key_responsibilities": "Reviews commercial contracts, provides legal advice, and ensures regulatory compliance.",
                "exp_technical_competencies": "Contract negotiation, legal risk analysis, regulatory interpretation, compliance frameworks.",
                "exp_delivery_ownership": "Functional deliverables",
                "exp_regulatory_compliance": "Contract compliance monitoring and regulatory advisory support.",
                "exp_project_resource_management": "Limited project coordination",
            },
            ("Legal", 3): {
                "exp_scope_of_role": "Leads legal support for business operations and manages legal risk across projects.",
                "exp_key_responsibilities": "Oversees complex contracts, manages legal disputes, and ensures governance compliance.",
                "exp_technical_competencies": "Legal strategy development, risk management, regulatory interpretation, dispute management.",
                "exp_delivery_ownership": "Study or program ownership/functional deliverables",
                "exp_regulatory_compliance": "Legal governance oversight and regulatory compliance management.",
                "exp_project_resource_management": "Team management and resource allocation",
            },
            ("Legal", 4): {
                "exp_scope_of_role": "Provides strategic legal oversight and governance across organizational operations.",
                "exp_key_responsibilities": "Defines legal strategy, manages corporate governance, and leads regulatory risk management.",
                "exp_technical_competencies": "Enterprise legal strategy, corporate governance, regulatory compliance frameworks.",
                "exp_delivery_ownership": "Portfolio or organizational oversight",
                "exp_regulatory_compliance": "Global regulatory compliance leadership and legal governance.",
                "exp_project_resource_management": "Department leadership and budget accountability",
            },
        }

        if db.query(RoleExpectation).filter(RoleExpectation.org_id == miltenyi.id).count() == 0:
            inserted = 0
            for (func_name, level), fields in GCC_ROLE_EXPECTATIONS.items():
                fn = db.query(Function).filter_by(org_id=miltenyi.id, name=func_name).first()
                if not fn:
                    continue
                db.add(RoleExpectation(
                    org_id=miltenyi.id,
                    function_id=fn.id,
                    career_level=level,
                    **fields,
                ))
                inserted += 1
            db.commit()
            print(f"  [+] Role Expectations: {inserted} rows (one per function × career level)")
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
            # Bob — Regulatory Affairs Manager, strong performer with H1 self-review submitted
            _ensure_goal(
                bob, anjali,
                "CAR-T IND Filing — Regulatory Programme Lead",
                "Own the regulatory submission programme for the CAR-T IND filing — strategy, dossier coordination, HA interactions.",
                cycle_name="FY26-27", approval=ApprovalStatus.APPROVED.value, fy_year=2026,
                with_h1_self_review=True,
            )
            # Charlie — RA Specialist, pending mentor approval
            _ensure_goal(
                charlie, anjali,
                "Module 3 Quality Submission Package",
                "Author and submit the Module 3 quality content for the next-gen CAR-T IND filing.",
                cycle_name="FY26-27", approval=ApprovalStatus.PENDING_APPROVAL.value, fy_year=2026,
            )
            # Dana — Senior RA Associate, draft
            _ensure_goal(
                dana, anjali,
                "HA Response Tracker & Documentation Hygiene",
                "Operationalise the agency response tracker and tighten documentation governance across the RA team.",
                cycle_name="FY26-27", approval=ApprovalStatus.DRAFT.value, fy_year=2026,
            )
            # Iris — Senior Clinical Data Manager, approved, no self-review yet
            _ensure_goal(
                iris, mark,
                "Cell Therapy Database Lock Programme",
                "Lead end-to-end database lock readiness for the cell-therapy trial portfolio in FY26-27.",
                cycle_name="FY26-27", approval=ApprovalStatus.APPROVED.value, fy_year=2026,
            )
            # Evan — Clinical Trial Manager, approved with H1 self-review
            _ensure_goal(
                evan, mark,
                "MACS Quant Trial Sites Activation",
                "Activate and stabilise the 12 trial sites for the MACS Quant clinical programme by Q3.",
                cycle_name="FY26-27", approval=ApprovalStatus.APPROVED.value, fy_year=2026,
                with_h1_self_review=True, self_review_text=STRONG_SELF,
            )
            # Fiona — PV Analyst, pending approval
            _ensure_goal(
                fiona, mark,
                "Signal-Detection Methodology Uplift",
                "Implement an updated signal-detection methodology across the PV team aligned with current GVP guidance.",
                cycle_name="FY26-27", approval=ApprovalStatus.PENDING_APPROVAL.value, fy_year=2026,
            )
            # Klaus — Senior PV Analyst, draft
            _ensure_goal(
                klaus, priya,
                "PSUR/PBRER Aggregate Reporting Programme",
                "Lead the FY26-27 aggregate-reporting cycle (PSUR + PBRER) end-to-end across the product portfolio.",
                cycle_name="FY26-27", approval=ApprovalStatus.DRAFT.value, fy_year=2026,
            )
            # Mia — Senior Medical Writer, approved with H1 self-review
            _ensure_goal(
                mia, priya,
                "EMA + FDA CSR Authoring Programme",
                "Author the two priority Clinical Study Reports for the FY26-27 EMA and FDA submission tracks.",
                cycle_name="FY26-27", approval=ApprovalStatus.APPROVED.value, fy_year=2026,
                with_h1_self_review=True,
            )
            # Nils — Medical Writer, pending approval
            _ensure_goal(
                nils, priya,
                "Protocol Authoring — Pediatric Indication",
                "Draft and shepherd the pediatric-indication protocol through internal review and submission readiness.",
                cycle_name="FY26-27", approval=ApprovalStatus.PENDING_APPROVAL.value, fy_year=2026,
            )
            print("  [+] Annual goals (FY26-27) for all Employees, GCC-themed, with mixed approval states")
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
                impact="Charlie owned the Module 3 quality dossier section and the IND submission preparatory work.",
                comment_scope_of_role="Operated solidly inside the Regulatory Affairs Specialist remit — submission prep + cross-functional coordination.",
                comment_key_responsibilities="Owned Module 3 quality content end-to-end; drove the agency response tracker for two HA query cycles.",
                comment_technical_competencies="Strong eCTD discipline and submission-systems fluency; deepening regulatory intelligence on cell-therapy precedent.",
                comment_delivery_ownership="Reliable on functional deliverables; willing to step into program-level coordination when asked.",
                comment_regulatory_compliance="Submissions tracked cleanly; documentation management is audit-clean.",
                comment_project_resource_management="Light project coordination across the Module 3 contributors — kept the tracker live.",
            )
            _ensure_pr(bob,  proj_cell, hans)
            _ensure_pr(dana, proj_cell, hans)

            # MIL-PRJ-102 (Greta) — Fiona reviewed, others pending
            _ensure_pr(
                fiona, proj_macs, greta, ProjectReviewStatus.REVIEWED.value, pg="4",
                impact="Fiona stood up the PV reconciliation framework for the trial and drove signal-monitoring discipline.",
                comment_scope_of_role="Operated firmly inside the Pharmacovigilance Analyst remit — case processing + signal monitoring + aggregate report support.",
                comment_key_responsibilities="Independently QC'd AE/SAE cases and contributed to two aggregate report inputs; reconciliation discipline tightened across the quarter.",
                comment_technical_competencies="Strong case processing and safety-database fluency; signal monitoring instincts growing.",
                comment_delivery_ownership="Owned functional deliverables; partnered well with the Clinical Trial Manager.",
                comment_regulatory_compliance="Quality review of cases is clean; reconciliation activities are well-documented.",
                comment_project_resource_management="Coordinated effectively on shared safety deliverables across the trial sites.",
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
                assignment_role=d_ra_specialist.name,
                function_id=func_ra.id,
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
        # Bob is a Regulatory Affairs Manager. His FY25-26 flagship goal
        # was leading the Global Regulatory Submissions Programme — EMA +
        # FDA submissions across the cell-therapy portfolio.

        BOB_FLAGSHIP_GOAL_H1_SELF = (
            "Owned the H1 submission strategy and execution end-to-end. "
            "Mapped the HA landscape, built the FY25-26 submissions plan "
            "with full dependency tracking, and filed the EMA pre-"
            "submission package on schedule. Successfully managed two HA "
            "query cycles with clean, on-time responses. The biggest "
            "unlock was tightening the cross-functional handoff with CDM "
            "and Clinical Operations — Module 3 inputs now arrive a week "
            "before the planned freeze date."
        )
        BOB_FLAGSHIP_GOAL_H1_MENTOR = (
            "Bob has been a model of regulatory program ownership this "
            "half. The EMA filing landed on schedule and the HA query "
            "responses were genuinely high-quality. He's getting sharper "
            "at framing trade-offs with the broader team too — the "
            "Module 3 handoff redesign was his initiative and is working "
            "well. Strong half."
        )
        BOB_FLAGSHIP_GOAL_H2_SELF = (
            "H2 closed the EMA cycle (zero outstanding queries) and "
            "opened the FDA pre-IND track. Authored the pre-IND briefing "
            "document, ran the agency meeting, and walked away with an "
            "agreed pathway for the FY26-27 IND filing. Mentored Charlie "
            "through his first independent Module 3 authoring as part of "
            "the H2 close — he's now operating cleanly at the Specialist "
            "band."
        )
        BOB_FLAGSHIP_GOAL_H2_MENTOR = (
            "Exceptionally clean H2 delivery. The FDA pre-IND outcome "
            "was unusually positive — agency feedback specifically called "
            "out the briefing document narrative. Mentoring of Charlie "
            "is showing real impact. Bob is operating at the top of the "
            "Regulatory Affairs Manager band and is ready for stretch "
            "Lead-band responsibilities in FY26-27."
        )

        BOB_MENTOR_GOAL_H1_SELF = (
            "H1 I focused on building Charlie's and Dana's confidence on "
            "eCTD authoring, regulatory intelligence, and agency-response "
            "drafting. Ran weekly office hours and maintained a shared "
            "internal playbook covering common HA query response patterns "
            "for our therapeutic area. Charlie now independently drafts "
            "Module 3 quality content; Dana owns the agency response "
            "tracker end-to-end."
        )
        BOB_MENTOR_GOAL_H1_MENTOR = (
            "Bob's mentoring approach is structured and consistent. The "
            "agency-response playbook has become a team reference, used "
            "beyond his direct mentees. Charlie's confidence trajectory "
            "specifically has been impressive this half."
        )
        BOB_MENTOR_GOAL_H2_SELF = (
            "H2 widened the scope — onboarded two new RA joiners through "
            "their first submission cycle, and ran a cross-team brown-bag "
            "series on HA query response strategy. The internal playbook "
            "now has 30+ patterns and is the de-facto onboarding artifact "
            "for new RA hires."
        )
        BOB_MENTOR_GOAL_H2_MENTOR = (
            "Bob has quietly become a mentoring multiplier on the RA "
            "team. The brown-bag series has expanded mentoring impact "
            "beyond his own assigned mentees, and the playbook is now "
            "actively maintained by the broader team. Real culture work "
            "— exceeds expectations for the Regulatory Affairs Manager band."
        )

        BOB_PAPER_GOAL_H1_SELF = (
            "Drafted the outline and first two sections of the internal "
            "regulatory paper on the HA query response strategy that "
            "drove the EMA cycle. Took peer review feedback from two "
            "senior RA leads and restructured the methodology section "
            "based on their comments — v2 is meaningfully sharper than v1."
        )
        BOB_PAPER_GOAL_H1_MENTOR = (
            "On track. The outline and methodology framing are solid. "
            "Bob took peer feedback constructively and the v2 is "
            "genuinely sharper than v1 — a good signal for the H2 finish."
        )
        BOB_PAPER_GOAL_H2_SELF = (
            "Completed the paper end-to-end, published to the internal "
            "knowledge base in February. Presented the work at the "
            "all-hands Regulatory Affairs session in March; received "
            "strong engagement and three new cross-team collaboration "
            "leads off the back of it."
        )
        BOB_PAPER_GOAL_H2_MENTOR = (
            "Paper landed well and the all-hands presentation was "
            "confident. The follow-on collaboration interest is a strong "
            "external signal. Bob has built up real regulatory-writing "
            "muscle this year — a stretch ask we set in April and fully "
            "delivered against."
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
            "Lead FY25-26 Global Regulatory Submissions Programme",
            "Own the FY25-26 cell-therapy submissions programme end-to-end — "
            "EMA filing, HA interactions, and FDA pre-IND pathway.",
            cycle_name="FY25-26", fy_year=2025,
            h1_self=BOB_FLAGSHIP_GOAL_H1_SELF,
            h1_mentor=BOB_FLAGSHIP_GOAL_H1_MENTOR,
            h2_self=BOB_FLAGSHIP_GOAL_H2_SELF,
            h2_mentor=BOB_FLAGSHIP_GOAL_H2_MENTOR,
        )
        _ensure_full_lifecycle_goal(
            bob, anjali,
            "Mentor Two Junior RA Team Members",
            "Coach Charlie and Dana through eCTD authoring and HA response "
            "drafting; build a team-wide regulatory playbook.",
            cycle_name="FY25-26", fy_year=2025,
            h1_self=BOB_MENTOR_GOAL_H1_SELF,
            h1_mentor=BOB_MENTOR_GOAL_H1_MENTOR,
            h2_self=BOB_MENTOR_GOAL_H2_SELF,
            h2_mentor=BOB_MENTOR_GOAL_H2_MENTOR,
        )
        _ensure_full_lifecycle_goal(
            bob, anjali,
            "Publish Internal Regulatory Paper on HA Response Strategy",
            "Author and present an internal regulatory paper on the HA query "
            "response strategy used in the FY25-26 EMA cycle; aim for an "
            "all-hands RA session.",
            cycle_name="FY25-26", fy_year=2025,
            h1_self=BOB_PAPER_GOAL_H1_SELF,
            h1_mentor=BOB_PAPER_GOAL_H1_MENTOR,
            h2_self=BOB_PAPER_GOAL_H2_SELF,
            h2_mentor=BOB_PAPER_GOAL_H2_MENTOR,
        )
        print("  [+] Bob — 3 FY25-26 annual goals, each fully lifecycle-completed (H2_MENTOR_REVIEWED)")

        # 11b. Project reviews — Q1..Q4 FY25-26 on MIL-PRJ-100
        # Q1 FY25-26 — regulatory strategy kickoff (Apr-Jun 2025).
        # Bob's flagship is reframed as a Regulatory Affairs programme:
        # planning EMA + FDA submissions for the cell-therapy portfolio.
        BOB_PR_Q1 = dict(
            cycle="Q1 FY25-26", pg="2",
            impact=(
                "Anchored the Q1 regulatory strategy: HA landscape map, "
                "submission timeline architecture, and the first draft of "
                "the Module 1 admin content for the EMA pre-submission."
            ),
            comment_scope_of_role=(
                "Owned the Regulatory Affairs Manager remit end-to-end — "
                "submission planning, HA interaction strategy, and "
                "cross-functional coordination with CDM and Clinical Ops."
            ),
            comment_key_responsibilities=(
                "Drafted the FY25-26 submissions plan with full timeline + "
                "dependency map. Initiated the Module 1 admin file. "
                "Established the agency-response tracker that the whole team "
                "now uses."
            ),
            comment_technical_competencies=(
                "Strong fluency in regulatory submission preparation and "
                "regulatory intelligence. Brought eCTD discipline to the "
                "team workflow from week one. Risk-assessment thinking is "
                "operating at the senior band."
            ),
            comment_delivery_ownership=(
                "Took clear program ownership of the submissions workstream "
                "without me needing to chase. Stepped beyond the strict "
                "Regulatory Affairs Manager scope when the timeline "
                "demanded coordination across CDM."
            ),
            comment_regulatory_compliance=(
                "HA interaction strategy is well-grounded in ICH guidance. "
                "Submission governance discipline is exemplary — every "
                "artifact has a traceable owner and audit log."
            ),
            comment_project_resource_management=(
                "Started light team coordination from week three — Charlie "
                "and Dana have a clear sub-workstream allocation. Resource "
                "tracking is live."
            ),
        )
        # Q2 FY25-26 — first submission cycle (Jul-Sep 2025)
        BOB_PR_Q2 = dict(
            cycle="Q2 FY25-26", pg="2",
            impact=(
                "Drove the EMA pre-submission package to first filing. "
                "Successfully managed two HA query rounds with on-time, "
                "on-quality responses."
            ),
            comment_scope_of_role=(
                "Operating firmly at the Regulatory Affairs Manager band — "
                "led the submission, owned HA interactions, and coordinated "
                "the cross-functional Module 3 inputs."
            ),
            comment_key_responsibilities=(
                "Closed Module 1 + Module 2.7 + Module 3 quality content. "
                "Filed on schedule. Managed two HA query rounds without "
                "escalation — clean, on-time, on-quality responses."
            ),
            comment_technical_competencies=(
                "eCTD submission management is at the senior band. "
                "Regulatory intelligence on EMA precedent for the therapeutic "
                "area is genuinely deep. Risk assessment on HA query strategy "
                "was sharp."
            ),
            comment_delivery_ownership=(
                "Owned the program through the submission window. Held the "
                "line on quality when timeline pressure tried to compress "
                "the QC step — the right call, and the data backs it."
            ),
            comment_regulatory_compliance=(
                "HA interactions handled with appropriate gravitas and "
                "precision. Documentation governance is audit-ready."
            ),
            comment_project_resource_management=(
                "Resource allocation across the submission workstream was "
                "well-judged — Charlie carried Module 3 cleanly, Dana "
                "carried the response tracker. Both are growing under his "
                "coordination."
            ),
        )
        # Q3 FY25-26 — response cycles + FDA pre-IND (Oct-Dec 2025)
        BOB_PR_Q3 = dict(
            cycle="Q3 FY25-26", pg="1",
            impact=(
                "Closed the EMA response cycle and opened the FDA pre-IND "
                "track. Quality response narrative was specifically called "
                "out by the agency as exemplary."
            ),
            comment_scope_of_role=(
                "Operating at the top of the Regulatory Affairs Manager band "
                "and starting to demonstrate Lead-band scope on the "
                "FDA workstream — defining strategy, not just executing."
            ),
            comment_key_responsibilities=(
                "Closed all outstanding EMA queries with one round-trip. "
                "Opened the FDA pre-IND meeting request and authored the "
                "briefing document. Negotiated the agency meeting agenda."
            ),
            comment_technical_competencies=(
                "Regulatory strategy development is genuinely senior-level. "
                "Submission management discipline is becoming a team "
                "standard. Cross-agency regulatory intelligence is sharp."
            ),
            comment_delivery_ownership=(
                "Owns the full submission portfolio. Took ownership of the "
                "pre-IND briefing scope beyond the original ask — recognized "
                "the strategic value of the broader narrative and made the "
                "right call."
            ),
            comment_regulatory_compliance=(
                "EMA agency feedback on the quality narrative was unusually "
                "positive. Submission governance is rock-solid. Inspection "
                "readiness mindset is fully in place."
            ),
            comment_project_resource_management=(
                "Resource allocation across the EMA close + FDA opening is "
                "well-balanced. The team is operating well under his "
                "coordination — Charlie is now independently leading Module "
                "3 for the FDA track."
            ),
        )
        # Q4 FY25-26 — FDA pre-IND + program close (Jan-Mar 2026)
        BOB_PR_Q4 = dict(
            cycle="Q4 FY25-26", pg="1",
            impact=(
                "Successful FDA pre-IND meeting outcome with agreed pathway "
                "for the IND filing. Closed FY25-26 program with full "
                "audit-readiness across all submission packages."
            ),
            comment_scope_of_role=(
                "Demonstrated Lead-band scope across the FDA workstream and "
                "the program close. Strategic regulatory leadership is "
                "clearly in evidence."
            ),
            comment_key_responsibilities=(
                "Led the pre-IND meeting with a positive outcome. Authored "
                "the post-meeting minutes that the agency adopted with no "
                "amendments. Closed the FY25-26 program with full "
                "audit-traceable artifact set."
            ),
            comment_technical_competencies=(
                "Health-authority negotiation in evidence — meeting "
                "outcome reflects real skill. Regulatory policy "
                "interpretation is at the senior + level. Governance "
                "frameworks are mature."
            ),
            comment_delivery_ownership=(
                "Owned the program close end-to-end. Audit-readiness mindset "
                "drove every artifact decision in Q4. Set the team up for "
                "FY26-27 IND filing success."
            ),
            comment_regulatory_compliance=(
                "FDA interaction quality was outstanding. Submission "
                "governance is the team standard. Audit readiness is "
                "complete and verified."
            ),
            comment_project_resource_management=(
                "Resource allocation through the program close was excellent. "
                "Team performed at the top of its range under his "
                "coordination. Recommend stretch scope at Lead band in FY26-27."
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
                "FY25-26 was the year I stepped from 'execute on a "
                "workstream' into 'own the regulatory programme.' The "
                "headline outcome was the FY25-26 Global Regulatory "
                "Submissions Programme — EMA filing on schedule, two HA "
                "query cycles closed cleanly, and a successful FDA "
                "pre-IND meeting outcome that gave us the agreed pathway "
                "for the FY26-27 IND filing. Beyond the submission "
                "portfolio itself, I doubled down on mentoring — Charlie "
                "and Dana shipped their first independent Module 3 "
                "authoring and HA response cycles this year, and the "
                "HA-query brown-bag I started in Q3 is now a recurring "
                "team fixture. Finally, the internal regulatory paper on "
                "the HA response strategy published in February and led "
                "to three cross-team collaboration conversations off the "
                "back of the RA all-hands presentation. Headed into "
                "FY26-27 ready to take on broader programme scope and "
                "more formal Lead-band responsibilities."
            )
            bob_ar.self_performance_rating = 1
            bob_ar.mentor_overall_review = (
                "Bob has delivered a standout year. The FY25-26 "
                "Submissions Programme is the team's flagship outcome of "
                "the cycle and his ownership ran through every phase — "
                "strategy, filing, HA interactions, and the FDA pre-IND "
                "outcome. The most impressive trait this year has been "
                "the combination of regulatory depth and quiet "
                "leadership: the HA response playbook and the brown-bag "
                "series have lifted the bar across his peers, not just "
                "his direct mentees. Charlie's growth trajectory "
                "specifically is directly attributable to Bob's "
                "coaching. Comms with senior stakeholders and with the "
                "agency are confident and well-pitched. Recommend "
                "promotion consideration for FY26-27 alongside stretch "
                "Lead-band scope."
            )
            bob_ar.mentor_performance_rating = 1
            bob_ar.management_performance_rating = 1
            bob_ar.final_performance_rating = 1
            bob_ar.management_comments = (
                "Calibrated at the top of the Regulatory Affairs Manager "
                "band. Mentor rating endorsed without adjustment. "
                "Promotion to Regulatory Affairs Lead track flagged for "
                "the FY26-27 mid-year review. Stretch scope: lead the "
                "FY26-27 IND filing programme end-to-end."
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
        print("\n  PMs (Miltenyi — each Lead band in a GCC function):")
        print("    hans@miltenyi.com           Hans Müller   (Regulatory Affairs Lead)")
        print("    greta@miltenyi.com          Greta Schmidt (Clinical Trial Management Lead)")
        print("    lukas@miltenyi.com          Lukas Lange   (Medical Writing Lead)")
        print("    dieter@miltenyi.com         Dieter Becker (Pharmacovigilance Lead, reserve)")
        print("\n  Employees (across GCC functions):")
        print("    Regulatory Affairs:        bob@ (Manager), charlie@ (Specialist), dana@ (Sr Associate)")
        print("    Clinical Data Management:  iris@ (Sr CDM)")
        print("    Clinical Trial Management: evan@ (CTM)")
        print("    Pharmacovigilance:         fiona@ (PV Analyst), klaus@ (Sr PV Analyst)")
        print("    Medical Writing:           mia@ (Sr Med Writer), nils@ (Med Writer)")
        print("\n--- LIFECYCLE TEST DATA ---")
        print("  MIL-PRJ-101 -> Completed (Sarah, 2025-09-01); 3 historical assignments")
        print("  MIL-PRJ-103 -> Charlie has TWO stints: ended 2026-04-30 + active 2026-06-01")
        print("    His Q1 PENDING review stays in Hans's queue (in-flight finish).")
        print("\n--- DEMO-READY MENTEE (FULL FY25-26 HISTORY) ---")
        print("  Bob Builder  ->  bob@miltenyi.com          (Regulatory Affairs Manager)")
        print("    Mentor    : Anjali Rao (anjali.rao@healthark.ai)")
        print("    Project   : MIL-PRJ-100 (FY25-26 Global Regulatory Submissions Programme)")
        print("    Goals     : 3 annual goals (RA-themed), all H2_MENTOR_REVIEWED (full lifecycle)")
        print("    Project Rv: 4 reviews on MIL-PRJ-100 — Q1..Q4 FY25-26, all REVIEWED")
        print("    Annual Rv : FY25-26 COMPLETED at rating 1, final published")
        print("  -> Demo: log in as anjali.rao@healthark.ai; My Mentees -> Bob.")
        print()

    except Exception as e:
        print(f"\n[ERROR] Seeding failed: {e}")
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
