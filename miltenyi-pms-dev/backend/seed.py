"""
seed.py — Deterministic dev seed for the Miltenyi PMS instance.

Models the new collaborative role taxonomy: MyOrg (Healthark) staffs
employees to Miltenyi, who manage them on projects.

Accounts (all passwords: password123):
  HR · Healthark:
    sarah.patel@healthark.ai      Sarah Patel       (HR_MyOrg, super-admin)

  HR · Miltenyi:

  Mentors (Healthark — fixed pool of 3):
    anjali.rao@healthark.ai       Anjali Rao        (mentors Bob, Charlie, Dana)
    mark.singh@healthark.ai       Mark Singh        (mentors Iris, Evan, Fiona)
    priya.mehta@healthark.ai      Priya Mehta       (mentors Klaus, Mia, Nils)

  PMs (Miltenyi):

  Employee (Healthark employees with Miltenyi-issued accounts):
    bob@, charlie@, dana@, iris@healthark.ai               (R&D)
    evan@, fiona@, klaus@healthark.ai                       (Manufacturing)
    mia@, nils@healthark.ai                                 (Commercial)

Run:
  python seed.py
"""

from datetime import date, datetime, timezone

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.reference_models import Function, Designation
from app.models.project_goal_models import (
    GoalFramework,
    GoalFrameworkKpi,
    ProjectGoalItem,
    ProjectGoalPeriodSettings,
    ProjectGoalQuarter,
    ProjectGoalReview,
    ProjectGoalReviewItem,
    ProjectGoalSet,
)
from seed_data.goal_themes import GOAL_THEMES, PERIOD_LABEL
from app.models.user_models import User, Role
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
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

# Shared GCC career-path content (functions, designations, role-expectation
# prose). Both this dev seed and miltenyi-test-seed.py import from here so
# edits to the framework happen in one place.
from seed_data.gcc import (
    LEVEL_LABEL,
    GCC_DESIGNATIONS,
    GCC_ROLE_EXPECTATIONS,
)


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
                # `project_reviews` is deliberately absent: the per-project
                # PM review queue is retired for the Miltenyi instance in
                # favour of `project_goals` (Sep 2026 stakeholder decision).
                # The code stays; the server-side feature gate hides it.
                enabled_features=[
                    "dashboard", "goals", "project_goals",
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
        #
        # GCC_DESIGNATIONS + LEVEL_LABEL come from seed_data.gcc — one
        # source of truth shared with miltenyi-test-seed.py.

        if db.query(Function).filter(Function.org_id == miltenyi.id).count() == 0:
            # Functions
            gcc_function_names = sorted({fname for fname, _, _ in GCC_DESIGNATIONS})
            for fname in gcc_function_names:
                db.add(Function(org_id=miltenyi.id, name=fname))
            db.flush()

            # Designations — each title gets its own row. `level` (legacy
            # int) is left at the default of 1; `career_level` carries the
            # GCC band that everything actually keys on. `function_id`
            # links the title to its department so the Project Goals
            # framework editor can list titles under each level column.
            fn_ids = {
                f.name: f.id
                for f in db.query(Function).filter(Function.org_id == miltenyi.id).all()
            }
            for fname, lvl, titles in GCC_DESIGNATIONS:
                for title in titles:
                    db.add(Designation(
                        org_id=miltenyi.id,
                        name=title,
                        level=lvl,                  # legacy sort, matches band for now
                        career_level=lvl,
                        career_level_label=LEVEL_LABEL[lvl],
                        function_id=fn_ids.get(fname),
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
            role=Role.ADMIN.value,
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

        # ── Employees ─────────────────────────────────────────────────
        # Mentor pairings (preserved from the original seed):
        #   Anjali → Bob, Charlie, Dana    (all Regulatory Affairs)
        #   Mark   → Iris, Evan, Fiona     (cross-functional: CDM, CTM, PV)
        #   Priya  → Klaus, Mia, Nils      (cross-functional: PV, MW, MW)
        #
        # Bob is the demo-grade mentee for "My Mentees" walkthroughs and
        # is intentionally pinned to Regulatory Affairs Manager (L3).
        bob = _ensure_user(
            "bob@healthark.ai",
            employee_code="STF-001", full_name="Bob Builder",
            phone="+49 30 1234 2001",
            role=Role.STAFF.value, mentor_id=anjali.id,
            function_id=func_ra.id, designation_id=d_ra_manager.id,
        )
        charlie = _ensure_user(
            "charlie@healthark.ai",
            employee_code="STF-002", full_name="Charlie Chemist",
            phone="+49 30 1234 2002",
            role=Role.STAFF.value, mentor_id=anjali.id,
            function_id=func_ra.id, designation_id=d_ra_specialist.id,
        )
        dana = _ensure_user(
            "dana@healthark.ai",
            employee_code="STF-003", full_name="Dana DNA",
            phone="+49 30 1234 2003",
            role=Role.STAFF.value, mentor_id=anjali.id,
            function_id=func_ra.id, designation_id=d_ra_assoc_sr.id,
        )
        iris = _ensure_user(
            "iris@healthark.ai",
            employee_code="STF-004", full_name="Iris Immel",
            phone="+49 30 1234 2004",
            role=Role.STAFF.value, mentor_id=mark.id,
            function_id=func_cdm.id, designation_id=d_cdm_sr.id,
        )
        evan = _ensure_user(
            "evan@healthark.ai",
            employee_code="STF-005", full_name="Evan Engineer",
            phone="+49 30 1234 2005",
            role=Role.STAFF.value, mentor_id=mark.id,
            function_id=func_ctm.id, designation_id=d_ctm_mgr.id,
        )
        fiona = _ensure_user(
            "fiona@healthark.ai",
            employee_code="STF-006", full_name="Fiona Factory",
            phone="+49 30 1234 2006",
            role=Role.STAFF.value, mentor_id=mark.id,
            function_id=func_pv.id, designation_id=d_pv_analyst.id,
        )
        klaus = _ensure_user(
            "klaus@healthark.ai",
            employee_code="STF-007", full_name="Klaus Köhler",
            phone="+49 30 1234 2007",
            role=Role.STAFF.value, mentor_id=priya.id,
            function_id=func_pv.id, designation_id=d_pv_sr_analyst.id,
        )
        mia = _ensure_user(
            "mia@healthark.ai",
            employee_code="STF-008", full_name="Mia Markt",
            phone="+49 30 1234 2008",
            role=Role.STAFF.value, mentor_id=priya.id,
            function_id=func_mw.id, designation_id=d_mw_sr_writer.id,
        )
        nils = _ensure_user(
            "nils@healthark.ai",
            employee_code="STF-009", full_name="Nils Niedermeier",
            phone="+49 30 1234 2009",
            role=Role.STAFF.value, mentor_id=priya.id,
            function_id=func_mw.id, designation_id=d_mw_writer.id,
        )
        print("  [+] Users (Admin×1, Mentors×3, Staff×9 across 5 GCC functions)")

        # ============================================================ #
        # 4. SYSTEM SETTINGS                                            #
        # ============================================================ #
        if not db.query(SystemSettings).filter(SystemSettings.org_id == miltenyi.id).first():
            db.add(SystemSettings(
                org_id=miltenyi.id,
                active_cycle_name="H1 FY26-27",
                cycle_type=CycleType.HALF_YEARLY.value,
                fiscal_start_month=4,
                timezone="Asia/Kolkata",
                # Dev convenience: bypass the H1/H2 calendar gate so we can
                # test both halves' goal reviews in one session without
                # waiting for October. Production should leave this False.
                cycle_window_override=True,
                updated_by_id=sarah.id,
            ))
            db.commit()
            print("  [+] System Settings (half-yearly, H1 FY26-27, Asia/Kolkata, H1/H2 review window bypass on)")
        else:
            print("  [~] System settings already exist; reusing.")

        # Per-FY access toggles live on their own table (one row per FY).
        for fy in ("FY25-26", "FY26-27"):
            if not db.query(SystemSettingsYearOverride).filter_by(org_id=miltenyi.id, fy_label=fy).first():
                db.add(SystemSettingsYearOverride(
                    org_id=miltenyi.id, fy_label=fy,
                    annual_reviews_enabled=True,
                    annual_review_final_rating_visible=True,
                    annual_goals_edit_enabled=True,
                    updated_by_id=sarah.id,
                ))
        db.commit()

        # ============================================================ #
        # 6. ROLE EXPECTATIONS (Miltenyi GCC career-path content)       #
        # ============================================================ #
        # GCC_ROLE_EXPECTATIONS comes from seed_data.gcc — 32 rows keyed
        # by (function_name, career_level), one source of truth shared
        # with miltenyi-test-seed.py. Inserted into role_expectations
        # such that every designation at a given (function, career_level)
        # bucket points at this row.

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
        # 6b. PROJECT GOALS (Miltenyi CY 26-27 goal themes)                    #
        # ============================================================ #
        # Framework rows from seed_data.goal_themes (the seven documents
        # Gautham shared on 2 Sep 2026), one active period with the HR
        # switches, the Miltenyi reviewer name per employee, and sample
        # goal sets in different stages so every role has something to
        # look at. Pharmacovigilance has no document, so Fiona and Klaus
        # show up as "No framework" in the mapping tab on purpose.
        if db.query(GoalFramework).filter(GoalFramework.org_id == miltenyi.id).count() == 0:
            from datetime import datetime as _dt, timezone as _tz

            fw_rows = 0
            for func_name, levels in GOAL_THEMES.items():
                fn = db.query(Function).filter_by(org_id=miltenyi.id, name=func_name).first()
                if not fn:
                    continue
                for level, row in levels.items():
                    fw = GoalFramework(
                        org_id=miltenyi.id, function_id=fn.id, level=level, period_label=PERIOD_LABEL,
                        title=row["title"], business_outcomes=row["business_outcomes"],
                        functional_goals=row["functional_goals"], created_by_id=sarah.id,
                    )
                    db.add(fw)
                    db.flush()
                    for seq, (text, weight) in enumerate(row["kpis"], start=1):
                        db.add(GoalFrameworkKpi(framework_id=fw.id, seq=seq, text=text, weightage=weight))
                    fw_rows += 1
            # Goals are set once a year; reviews run every quarter. The demo
            # sits in Q3 CY 26-27 with Q1–Q3 rolled out (Q3 = the writable window,
            # Q1/Q2 open for backfill, Q4 locked until the Admin rolls it out).
            CURRENT_QUARTER = 3
            CURRENT_CYCLE = f"Q{CURRENT_QUARTER} {PERIOD_LABEL}"
            db.add(ProjectGoalPeriodSettings(
                org_id=miltenyi.id, period_label=PERIOD_LABEL, is_active=True,
                entry_open=True, weightages_visible=True, current_quarter_seq=CURRENT_QUARTER,
                extra_goal_enabled=True, extra_goal_weightage=10,   # HR: one "Additional goals" row on every sheet
                updated_by_id=sarah.id,
            ))
            for seq in range(1, CURRENT_QUARTER + 1):
                db.add(ProjectGoalQuarter(
                    org_id=miltenyi.id, period_label=PERIOD_LABEL, seq=seq, cycle_label=f"Q{seq} {PERIOD_LABEL}",
                    ratings_visible=False, opened_by_id=sarah.id,
                ))
            db.commit()
            print(f"  [+] Project Goals: {fw_rows} framework rows for {PERIOD_LABEL}; period active (goal entry open, current quarter Q{CURRENT_QUARTER}, ratings hidden)")

            # Miltenyi reviewers are names only — Miltenyi staff have no login.
            miltenyi_reviewers = {
                "bob@healthark.ai": "Stefan Bauer", "charlie@healthark.ai": "Stefan Bauer", "dana@healthark.ai": "Stefan Bauer",
                "iris@healthark.ai": "Dr. Ute Krämer", "evan@healthark.ai": "Marc Dubois",
                "fiona@healthark.ai": "Dr. Lena Vogel", "klaus@healthark.ai": "Dr. Lena Vogel",
                "mia@healthark.ai": "Dr. Elena Rossi", "nils@healthark.ai": "Dr. Elena Rossi",
            }
            for email, name in miltenyi_reviewers.items():
                u = db.query(User).filter_by(org_id=miltenyi.id, email=email).first()
                if u:
                    u.miltenyi_reviewer_name = name
            db.commit()

            def _pg_framework_for(u):
                lvl = u.designation.career_level if u.designation else None
                if not u.function_id or not lvl:
                    return None
                return db.query(GoalFramework).filter_by(
                    org_id=miltenyi.id, function_id=u.function_id, level=lvl, period_label=PERIOD_LABEL,
                ).first()

            def _pg_set(email, status, self_rating=None, final_rating=None, partial=False):
                """`status` is the goals lifecycle (draft/submitted/approved) or one
                of the demo stages "self_reviewed" / "reviewed", which mean: goals
                approved + the current quarter's self-review (and review) submitted."""
                u = db.query(User).filter_by(org_id=miltenyi.id, email=email).first()
                fw = _pg_framework_for(u) if u else None
                if fw is None:
                    return None
                first = u.full_name.split()[0]
                goals_status = "approved" if status in ("self_reviewed", "reviewed") else status
                s = ProjectGoalSet(org_id=miltenyi.id, user_id=u.id, period_label=PERIOD_LABEL, framework_id=fw.id, status=goals_status)
                if status != "draft":
                    s.submitted_at = _dt(2026, 1, 12, 9, 0, tzinfo=_tz.utc)
                if status in ("approved", "self_reviewed", "reviewed"):
                    s.approved_at = _dt(2026, 1, 20, 11, 0, tzinfo=_tz.utc)
                    s.approved_by_id = u.mentor_id
                    s.approved_agreed_with = u.miltenyi_reviewer_name
                    s.approved_agreed_on = date(2026, 1, 19)
                    s.approval_note = "Confirmed by email; no wording changes."
                db.add(s)
                db.flush()
                items = []
                for k in fw.kpis:
                    goal = None
                    if not (partial and k.seq > 2):
                        goal = (f"{first}'s {PERIOD_LABEL} commitment on this KPI: deliver against the agreed study plan, "
                                f"with evidence reviewed at each quarterly checkpoint and no critical findings attributable to this work.")
                    it = ProjectGoalItem(set_id=s.id, seq=k.seq, kpi_id=k.id, kpi_text=k.text, weightage=k.weightage, goal_text=goal)
                    db.add(it)
                    items.append(it)
                extra = ProjectGoalItem(set_id=s.id, seq=len(fw.kpis) + 1, kpi_id=None, kpi_text="Additional goals", weightage=10, is_extra=True,
                                        goal_text=None if partial else "Mentor two new joiners on the study documentation SOPs.")
                db.add(extra)
                items.append(extra)
                db.flush()
                if status in ("self_reviewed", "reviewed"):
                    # The current quarter's review (Q3). Earlier quarters are left
                    # empty so the demo shows backfill.
                    rv = ProjectGoalReview(
                        org_id=miltenyi.id, set_id=s.id, cycle_label=CURRENT_CYCLE,
                        self_rating=self_rating, self_is_draft=False, self_submitted_at=_dt(2026, 9, 8, 10, 0, tzinfo=_tz.utc),
                        reviewer_id=u.mentor_id, miltenyi_reviewer_name=u.miltenyi_reviewer_name, final_rating_by="miltenyi",
                    )
                    if status == "reviewed":
                        rv.entered_by_id = u.mentor_id
                        rv.source_received_on = date(2026, 9, 19)
                        rv.final_rating = final_rating
                        rv.review_is_draft = False
                        rv.review_submitted_at = _dt(2026, 9, 22, 15, 0, tzinfo=_tz.utc)
                    db.add(rv)
                    db.flush()
                    for it in items:
                        db.add(ProjectGoalReviewItem(
                            review_id=rv.id, item_id=it.id,
                            self_text=(f"Delivered as planned this quarter; the July slippage on this item was recovered by August "
                                       f"and the Q3 evidence is filed with the study documentation."),
                            primary_comment=(f"Met expectations on this KPI in Q3 — consistent quality and timeliness."
                                             if status == "reviewed" else None),
                            healthark_note=("Consistent with the H1 mentor review." if (status == "reviewed" and it.seq == 1) else None),
                        ))
                db.flush()
                return s

            _pg_set("bob@healthark.ai", "reviewed", self_rating=1, final_rating=1)      # Regulatory Affairs Manager — Q3 reviewed
            _pg_set("evan@healthark.ai", "self_reviewed", self_rating=2)                # Clinical Trial Manager — Q3 self-review in, waiting for Marc Dubois's comments
            _pg_set("iris@healthark.ai", "approved")                                    # Senior CDM — goals approved, Q3 self-review open
            _pg_set("charlie@healthark.ai", "submitted")                                # RA Specialist — mentor to mark approved
            _pg_set("mia@healthark.ai", "draft", partial=True)                          # Senior Medical Writer — two goals written
            db.commit()
            print("  [+] Project Goals: sample sets — bob Q3 reviewed, evan Q3 self-reviewed, iris approved, charlie submitted, mia draft; dana/nils not started; fiona/klaus have no PV framework")
        else:
            print("  [~] Project Goals framework already exists; reusing.")

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
        # 11. FULL-YEAR DEMO DATA — Bob Builder, FY25-26                #
        # ============================================================ #
        # Loads Bob (bob@healthark.ai, mentor Anjali Rao) with a
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
        # open this account: bob@healthark.ai (password123).
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
        print("  Admin (Healthark HR): sarah.patel@healthark.ai   Sarah Patel")
        print("\n  Mentors (Healthark):")
        print("    anjali.rao@healthark.ai     Anjali Rao    (Bob, Charlie, Dana)")
        print("    mark.singh@healthark.ai     Mark Singh    (Iris, Evan, Fiona)")
        print("    priya.mehta@healthark.ai    Priya Mehta   (Klaus, Mia, Nils)")
        print("\n  Staff (across GCC functions):")
        print("    Regulatory Affairs:        bob@ (Manager), charlie@ (Specialist), dana@ (Sr Associate)")
        print("    Clinical Data Management:  iris@ (Sr CDM)")
        print("    Clinical Trial Management: evan@ (CTM)")
        print("    Pharmacovigilance:         fiona@ (PV Analyst), klaus@ (Sr PV Analyst)")
        print("    Medical Writing:           mia@ (Sr Med Writer), nils@ (Med Writer)")
        print("\n--- DEMO-READY MENTEE (FULL FY25-26 HISTORY) ---")
        print("  Bob Builder  ->  bob@healthark.ai           (Regulatory Affairs Manager)")
        print("    Mentor    : Anjali Rao (anjali.rao@healthark.ai)")
        print("    Goals     : 3 annual goals (RA-themed), all H2_MENTOR_REVIEWED (full lifecycle)")
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
