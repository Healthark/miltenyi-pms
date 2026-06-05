"""
Dashboard Schemas — The Dashboard Page's API Contract.

Annual goals are summarised on the dashboard by APPROVAL state, which
reflects where the goal sits in the mentor-approval workflow + the
post-approval half-cycle review machinery. The per-criterion progress
tracking was retired in the goal-criteria deprecation PR — progress
through the cycle is now visible via approval_status transitions and
the half-cycle review history on each goal's detail page.

The payload is role-additive: every authenticated user gets the
"Personal" fields filled in (goals, own annual review, project review
queue). Users with direct mentees additionally get the "Mentor" fields
filled in. The frontend gates which widgets to render off the user's
auth claims (has_mentees, hasFeature(...)) — so we always return every
field regardless of role, defaulting to zero/null when the layer
doesn't apply.
"""

from datetime import datetime
from pydantic import BaseModel
from typing import Optional


class DashboardSummary(BaseModel):
    """
    Aggregated widget data for the Dashboard page.

    One GET, one response, all widgets fed at once.
    """
    # ── Personal: Annual Goals ───────────────────────────────────────
    # `approved_goals` rolls every post-approval state (APPROVED + the 8
    # H1/H2/Q1..Q4 self/mentor-reviewed states — see POST_APPROVAL_STATES
    # in goal_models.py) into a single bucket. The frontend dashboard
    # labels this bucket "Active Goals" to convey "approved + still
    # progressing through cycle reviews" without listing every state.
    total_goals: int = 0
    draft_goals: int = 0
    submitted_goals: int = 0
    approved_goals: int = 0
    changes_requested_goals: int = 0

    # ── Personal: Active Cycle ───────────────────────────────────────
    active_cycle: Optional[str] = None

    # ── Personal: My Annual Review (current FY) ──────────────────────
    # All None when no AnnualReview row exists yet for the active FY —
    # the widget treats that as "not started" and renders the start CTA.
    annual_review_id: Optional[int] = None
    annual_review_status: Optional[str] = None  # draft|pending_mentor|pending_management|completed
    annual_review_cycle: Optional[str] = None   # bare FY label, e.g. "FY26-27"

    # ── Personal: Project Reviews where caller is evaluator ──────────
    # All four counters (pending pair below + done pair further down)
    # are scoped to the ACTIVE project cycle so the PM dashboard's
    # Project Reviews donut reads as "this cycle" — done + pending sum
    # to the PM's total queue for the live period. Past-cycle stale
    # rows (the rare case of an unfilled review left behind when HR
    # advanced the cycle) are excluded so the percentage isn't diluted
    # by historical noise; HR's org-wide ProjectReviewCompletion widget
    # already surfaces those at the FY rollup level.
    #
    # Primary: Project.pm_id == me AND status in (pending, draft) — keyed
    # off the live PM relationship so a freshly-pending row (reviewer_id
    # is NULL until the PM saves) still counts. Cycle filter applied via
    # ProjectReview.cycle.
    # Secondary: ProjectReviewEvaluator.evaluator_id == me AND status ==
    # draft, joined to ProjectReview for the cycle filter.
    project_reviews_pending_primary: int = 0
    project_reviews_pending_secondary: int = 0

    # ── Personal: Project Reviews DONE in the active cycle ───────────
    # Mirror counters to the pending pair above — reviews the caller has
    # already submitted as Primary (ProjectReview.status == REVIEWED) or
    # Secondary (ProjectReviewEvaluator.status == SUBMITTED) in the
    # active cycle. The PM dashboard's Project Reviews donut combines
    # these with the pending pair into one progress ring (Submitted vs
    # Pending).
    project_reviews_done_primary: int = 0
    project_reviews_done_secondary: int = 0

    # ── Personal: Project Reviews RECEIVED in the active cycle ───────
    # Inverse perspective from the two pending counters above — counts
    # how many PM evaluations have been submitted (status=REVIEWED)
    # AGAINST the caller in the active project cycle. Drives the
    # compact "N project reviews this cycle" strip on the Employee
    # dashboard's Annual Review card. PMs / Mentors / HR roles never
    # receive PM evaluations so this is naturally 0 for them.
    project_reviews_received_count: int = 0

    # ── Mentor: only meaningful when caller has direct mentees ───────
    mentee_count: int = 0


# ── HR org-wide dashboard ─────────────────────────────────────────────
#
# Separate response model from DashboardSummary because the HR view is
# org-wide rollups, not the caller's personal queue. Both HR roles
# (HR_MyOrg, HR_Miltenyi) receive the same shape for now — divergent
# widgets in later versions will be either gated on the frontend or
# split into role-specific endpoints if the payloads grow apart.

class HeadcountByRole(BaseModel):
    """Active-user breakdown by role. HR combines HR_MyOrg + HR_Miltenyi."""
    employee: int = 0
    mentor: int = 0
    pm: int = 0
    hr: int = 0


class HeadcountSummary(BaseModel):
    total_active: int = 0
    by_role: HeadcountByRole = HeadcountByRole()


class AnnualReviewFunnel(BaseModel):
    """Per-status row count for annual reviews in a single FY.

    `total` is the sum of the four buckets (= number of AnnualReview
    rows in the system for this FY in this org); employees with no
    review row at all aren't counted here. The "missing reviews" widget
    in Theme D will cover that separately."""
    fy_year: int | None = None
    total: int = 0
    draft: int = 0
    pending_mentor: int = 0
    pending_management: int = 0
    completed: int = 0


class GoalApprovalFunnel(BaseModel):
    """Per-stage count for annual goals in a single FY.

    Draft goals are private mentee work and are not surfaced to HR
    anywhere in the app, so they're not counted here. `approved` rolls
    up the literal APPROVED state plus all post-approval review states
    (H1/H2 + Q1..Q4 self/mentor-reviewed) — from HR's approval-funnel
    perspective, anything past APPROVED is "done with approval, now
    progressing through the review cycle". `total` is the sum of the
    three visible buckets."""
    fy_year: int | None = None
    total: int = 0
    pending_approval: int = 0
    changes_requested: int = 0
    approved: int = 0


class ProjectReviewCompletion(BaseModel):
    """Project-review completion state aggregated across every cycle
    in a single FY (H1+H2 for half-yearly orgs, Q1..Q4 for quarterly).

    Soft-deleted reviews are skipped. Buckets:
        pending  — row exists, PM hasn't started writing
        draft    — PM saved partial work, hasn't submitted
        reviewed — final, locked
    """
    fy_year: int | None = None
    total: int = 0
    pending: int = 0
    draft: int = 0
    reviewed: int = 0


class MissingAnnualReviewUser(BaseModel):
    """One row in the missing-annual-reviews chase list (not-started)."""
    user_id: int
    full_name: str
    function_name: str | None = None
    designation_name: str | None = None
    mentor_name: str | None = None


class DraftAnnualReviewUser(BaseModel):
    """One row in the in-progress (draft) annual reviews chase list.

    Shape mirrors `MissingAnnualReviewUser` for symmetric rendering,
    plus the `review_id` so the HR dashboard can deep-link to the
    existing draft row instead of asking HR to scroll the All Reviews
    list.
    """
    user_id: int
    review_id: int
    full_name: str
    function_name: str | None = None
    designation_name: str | None = None
    mentor_name: str | None = None


class MissingAnnualReviewsSummary(BaseModel):
    """Two-bucket chase list for the HR Pending Actions card.

    Buckets:
      - `users`   (count: `count`)       — Employees with NO AnnualReview
                                            row at all for the active FY.
      - `drafts`  (count: `draft_count`) — Employees who opened a review
                                            but never submitted it
                                            (status='draft'). Drafts
                                            previously got lumped in
                                            with "started" — they are
                                            no longer.

    Scope is Employee only: Mentors / PMs / HR aren't rated in this
    system so they're never expected to have an annual review row.

    `count == len(users)` and `draft_count == len(drafts)` — both kept
    for the frontend's headline numbers without forcing a length call.
    """
    fy_year: int | None = None
    count: int = 0
    users: list[MissingAnnualReviewUser] = []
    draft_count: int = 0
    drafts: list[DraftAnnualReviewUser] = []


class StalledGoal(BaseModel):
    """One row in the stalled-goal-approvals chase list."""
    goal_id: int
    title: str
    owner_name: str
    mentor_name: str | None = None
    days_waiting: int


class StalledGoalsSummary(BaseModel):
    """Annual goals stuck in `pending_approval` longer than the
    threshold for the selected FY.

    The mentor is the natural escalation target — when an employee
    submits, the goal sits at `pending_approval` until their mentor
    acts. After `threshold_days` we surface the row here so HR can
    nudge the mentor."""
    fy_year: int | None = None
    threshold_days: int = 7
    count: int = 0
    goals: list[StalledGoal] = []


class UnmentoredEmployee(BaseModel):
    """One row in the unmentored-Employee list."""
    user_id: int
    full_name: str
    function_name: str | None = None
    designation_name: str | None = None


class OrphanedEmployee(BaseModel):
    """One row in the orphaned-Employee list.

    Same shape as UnmentoredEmployee plus `orphaned_at` so the frontend
    can render "Orphaned X days ago" — gives HR a sense of how stale
    the lack-of-mentor situation is."""
    user_id: int
    full_name: str
    function_name: str | None = None
    designation_name: str | None = None
    orphaned_at: datetime


class MentorLoad(BaseModel):
    """Mentor + their currently-active mentee count."""
    mentor_id: int
    full_name: str
    mentee_count: int


class MentorCoverage(BaseModel):
    """Org-wide mentor pairing health snapshot.

    Three paired insights HR cares about:
      - `unmentored_employees` — active Staff who have never been
        assigned a mentor (`mentor_id IS NULL AND mentor_orphaned_at
        IS NULL`). A process gap — HR probably forgot to assign on
        user creation.
      - `orphaned_employees` — active Staff whose mentor was
        deactivated or role-changed away from Mentor and the cascade
        nulled their `mentor_id`. Distinct from truly-unmentored
        because there's likely in-flight work that froze; HR should
        prioritise reassigning. Shows `orphaned_at` so the dashboard
        can render staleness ("Orphaned 3 days ago").
      - `top_mentors` — top 5 mentors by active mentee count. Useful
        for spotting overload and picking who to assign new Staff to.
        Sorted desc by count, ties broken alphabetically.

    Not FY-scoped — this is a "right now" snapshot, like Headcount.
    See docs/policies/mentor-transition-policy.md for the policy
    behind the orphaned bucket.
    """
    unmentored_employees: list[UnmentoredEmployee] = []
    orphaned_employees: list[OrphanedEmployee] = []
    top_mentors: list[MentorLoad] = []


class OrphanedProject(BaseModel):
    """One row in the orphaned-projects list.

    Surfaces on the HR dashboard's ProjectCoverage card when a
    Project's PM is deactivated or role-changed away from PM and the
    cascade nulled `pm_id`. Mirrors `OrphanedEmployee` — same shape,
    same "act on me" semantics (HR should reassign promptly because
    in-flight ProjectReview rows are stranded until a new PM is set).

    `orphaned_at` is set by the cascade (admin_routes._orphan_pm_projects)
    and cleared when HR assigns a new PM via the project edit form.
    Backed by `projects.pm_orphaned_at`.
    """
    project_id: int
    project_code: str
    name: str
    secondary_evaluator_name: str | None = None
    orphaned_at: datetime


class ProjectCoverage(BaseModel):
    """Org-wide project pairing health snapshot — the PM-side analog
    of `MentorCoverage`.

    Surfaces orphaned projects (PM left, project hasn't been
    re-assigned yet). Not FY-scoped: this is a "right now" view of
    operational state, like MentorCoverage. Soft-deleted + completed
    projects are excluded from the orphan list — a completed project
    that finished with the original PM doesn't need rescuing even if
    that PM was later deactivated.

    See docs/policies/mentor-transition-policy.md for the original
    Option-C policy context; this is the same pattern applied to the
    PM-and-project axis.
    """
    orphaned_projects: list[OrphanedProject] = []


class HrDashboardSummary(BaseModel):
    """Aggregated HR dashboard payload — one GET, every widget fed.

    Subsequent dashboard widgets add sibling fields (calibration_progress,
    project_review_completion, etc.) without breaking existing clients."""
    headcount: HeadcountSummary = HeadcountSummary()
    annual_review_funnel: AnnualReviewFunnel = AnnualReviewFunnel()
    goal_approval_funnel: GoalApprovalFunnel = GoalApprovalFunnel()
    project_review_completion: ProjectReviewCompletion = ProjectReviewCompletion()
    missing_annual_reviews: MissingAnnualReviewsSummary = MissingAnnualReviewsSummary()
    stalled_goals: StalledGoalsSummary = StalledGoalsSummary()
    mentor_coverage: MentorCoverage = MentorCoverage()
    project_coverage: ProjectCoverage = ProjectCoverage()
    # Distinct 4-digit FY start years that have any annual review or
    # annual goal row in the caller's org, plus the active FY (so the
    # picker always offers the current cycle even when no data exists
    # for it yet). Sorted newest-first for direct use in the dropdown.
    available_fys: list[int] = []