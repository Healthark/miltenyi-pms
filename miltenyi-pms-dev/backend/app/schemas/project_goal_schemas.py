"""Pydantic schemas for the Project Goals module: yearly goals, quarterly
reviews (staff table, mentor review, Admin framework editor and quarter
roll-out). See app/models/project_goal_models.py for the data model and
docs/plans/2026-09-10-quarterly-project-goals-plan.md for the behaviour."""

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

GOAL_TEXT_MAX = 3000
COMMENT_MAX = 3000
NOTE_MAX = 1000

GoalsStatus = Literal["not_started", "draft", "submitted", "approved"]
StepStatus = Literal["not_started", "draft", "submitted"]


# ── Framework ────────────────────────────────────────────────────────

class FrameworkKpiOut(BaseModel):
    id: int
    seq: int
    text: str
    # None when the viewer is a staff member and weightages are hidden for the period.
    weightage: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class FrameworkRowOut(BaseModel):
    id: int
    function_id: int
    function_name: str
    level: int
    period_label: str
    title: str
    business_outcomes: str
    functional_goals: str
    kpis: list[FrameworkKpiOut]


class FrameworkKpiIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    weightage: int = Field(..., ge=0, le=100)


def _validate_kpis(kpis: list[FrameworkKpiIn]) -> list[FrameworkKpiIn]:
    if not kpis:
        raise ValueError("A framework row needs at least one KPI.")
    if len(kpis) > 12:
        raise ValueError("A framework row can hold at most 12 KPIs.")
    total = sum(k.weightage for k in kpis)
    if total != 100:
        raise ValueError(f"KPI weightages must total 100 (got {total}).")
    return kpis


class FrameworkRowCreate(BaseModel):
    function_id: int
    level: int = Field(..., ge=1, le=12)
    period_label: Optional[str] = None          # defaults to the active period
    title: str = Field(..., min_length=1, max_length=200)
    business_outcomes: str = Field(..., min_length=1, max_length=4000)
    functional_goals: str = Field(..., min_length=1, max_length=4000)
    kpis: list[FrameworkKpiIn]

    @field_validator("kpis")
    @classmethod
    def _kpis_total_100(cls, v: list[FrameworkKpiIn]) -> list[FrameworkKpiIn]:
        return _validate_kpis(v)


class FrameworkRowUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    business_outcomes: str = Field(..., min_length=1, max_length=4000)
    functional_goals: str = Field(..., min_length=1, max_length=4000)
    kpis: list[FrameworkKpiIn]

    @field_validator("kpis")
    @classmethod
    def _kpis_total_100(cls, v: list[FrameworkKpiIn]) -> list[FrameworkKpiIn]:
        return _validate_kpis(v)


class DesignationBriefOut(BaseModel):
    id: int
    name: str
    career_level: Optional[int] = None
    career_level_label: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class FrameworkFunctionOut(BaseModel):
    function_id: int
    function_name: str
    designations: list[DesignationBriefOut]
    rows: list[FrameworkRowOut]            # one per defined level (1..12)


class FrameworkMatrixOut(BaseModel):
    period_label: str
    functions: list[FrameworkFunctionOut]


class DesignationLevelUpdate(BaseModel):
    """Framework tab: change a designation's level (1..12) and/or rename it."""
    career_level: Optional[int] = Field(default=None, ge=1, le=12)
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)


# ── Period, quarters, roll-out ───────────────────────────────────────

class QuarterOut(BaseModel):
    seq: int
    cycle_label: str                        # "Q3 CY 26-27"
    ratings_visible: bool
    backfill_open: bool = True              # earlier quarter still writable (the current one is always open)
    is_current: bool
    opened_at: Optional[datetime] = None


class PeriodSettingsOut(BaseModel):
    period_label: str                       # "CY 26-27"
    is_active: bool                         # the review year (the quarter roll-out runs here)
    entry_open: bool
    weightages_visible: bool
    backfill_open: bool = True              # past year: started quarters stay writable while on
    extra_goal_enabled: bool = False        # the "Additional goals" row at the end of every sheet
    extra_goal_weightage: int = 10
    current_quarter_seq: Optional[int] = None
    current_quarter_label: Optional[str] = None
    quarters: list[QuarterOut] = []         # started quarters only (seq <= current)


class PeriodSettingsUpdate(BaseModel):
    is_active: Optional[bool] = None
    entry_open: Optional[bool] = None
    weightages_visible: Optional[bool] = None
    backfill_open: Optional[bool] = None
    extra_goal_enabled: Optional[bool] = None
    extra_goal_weightage: Optional[int] = Field(default=None, ge=0, le=100)


class PeriodBriefOut(BaseModel):
    """One goal year in a year selector."""
    period_label: str
    is_active: bool
    entry_open: bool
    backfill_open: bool
    current_quarter_seq: Optional[int] = None
    current_quarter_label: Optional[str] = None
    has_set: Optional[bool] = None          # staff: do I have a goal set for this year?


class QuarterPreflightOut(BaseModel):
    seq: int
    cycle_label: str
    self_pending: int                       # approved sets without a submitted self-review
    review_pending: int                     # approved sets without a submitted Miltenyi review
    reviews_submitted: int


class PeriodPreflightOut(BaseModel):
    """Who a switch flip would affect — shown in the Save confirmation."""
    period_label: str
    staff_total: int
    staff_without_set: int
    sets_draft: int
    sets_submitted: int
    sets_approved: int
    quarters: list[QuarterPreflightOut] = []


class QuarterUpdate(BaseModel):
    ratings_visible: Optional[bool] = None
    backfill_open: Optional[bool] = None


class CycleStatusOut(BaseModel):
    """What the Admin's quarter roll-out card needs in one call."""
    period_label: str
    current_seq: Optional[int] = None
    current_label: Optional[str] = None
    next_seq: int
    next_label: str
    next_period_label: str                  # differs from period_label when the roll-out starts a new year
    crosses_year: bool
    requires_typed_confirmation: bool
    previous_label: Optional[str] = None    # powers "Roll back" (from the latest log row)
    quarters: list[QuarterOut] = []


class CycleRolloutRequest(BaseModel):
    # Required only when the roll-out starts a new year: the Admin types the
    # new period label ("CY 27-28") to confirm the year change.
    confirmation: Optional[str] = Field(default=None, max_length=40)


class CycleSetRequest(BaseModel):
    target_label: str = Field(..., min_length=3, max_length=40)   # "Q2 CY 26-27"


class CycleLogOut(BaseModel):
    id: int
    from_label: Optional[str] = None
    to_label: str
    kind: str
    actor_name: Optional[str] = None
    created_at: datetime


# ── Mapping (Admin) ──────────────────────────────────────────────────

MappingStatus = Literal["mapped", "no_framework", "no_designation", "no_function"]


class MappingRowOut(BaseModel):
    user_id: int
    full_name: str
    email: str
    function_id: Optional[int] = None
    function_name: Optional[str] = None
    designation_id: Optional[int] = None
    designation_name: Optional[str] = None
    level: Optional[int] = None
    level_label: Optional[str] = None
    mentor_id: Optional[int] = None
    mentor_name: Optional[str] = None
    miltenyi_reviewer_name: Optional[str] = None
    status: MappingStatus
    # Function / designation are locked while this year's goal set exists.
    has_active_set: bool = False
    active_set_status: Optional[str] = None
    # Function / designation are locked while this year's goal set exists.
    has_active_set: bool = False
    active_set_status: Optional[str] = None


# ── Goal set ─────────────────────────────────────────────────────────

class GoalItemOut(BaseModel):
    id: int
    seq: int
    kpi_text: str
    weightage: Optional[int] = None         # hidden for staff when the period says so
    goal_text: Optional[str] = None
    is_extra: bool = False                  # the optional "Additional goals" row


class ReviewItemOut(BaseModel):
    item_id: int
    self_text: Optional[str] = None         # staff's own draft is theirs; others see it once submitted
    primary_comment: Optional[str] = None   # hidden from staff until the review is submitted
    healthark_note: Optional[str] = None    # the mentor's "Secondary review" (optional); same visibility rule


class ReviewOut(BaseModel):
    """One quarter's review of a set."""
    id: int
    cycle_label: str
    seq: int
    writable: bool                          # quarter at or before the current one, active period
    self_status: StepStatus
    review_status: StepStatus
    self_rating: Optional[int] = None
    self_is_draft: bool
    self_submitted_at: Optional[datetime] = None
    reviewer_id: Optional[int] = None
    reviewer_name: Optional[str] = None
    entered_by_id: Optional[int] = None
    entered_by_name: Optional[str] = None
    miltenyi_reviewer_name: Optional[str] = None
    source_received_on: Optional[date] = None
    final_rating: Optional[int] = None      # None for staff until the quarter's ratings are released
    final_rating_hidden: bool = False       # True when redacted for the viewer
    final_rating_by: str
    review_is_draft: bool
    review_submitted_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    items: list[ReviewItemOut] = []


class GoalSetOut(BaseModel):
    id: int
    user_id: int
    owner_name: str
    owner_email: str
    period_label: str
    status: str                             # draft | submitted | approved
    framework: Optional[FrameworkRowOut] = None
    items: list[GoalItemOut]
    reviews: list[ReviewOut] = []           # one per quarter that has a row, ordered by seq
    period: PeriodSettingsOut
    submitted_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    approved_by_name: Optional[str] = None
    approved_agreed_with: Optional[str] = None
    approved_agreed_on: Optional[date] = None
    approval_note: Optional[str] = None     # mentor / Admin only
    mentor_id: Optional[int] = None
    mentor_name: Optional[str] = None
    miltenyi_reviewer_name: Optional[str] = None


class MyProjectGoalsOut(BaseModel):
    """Everything the staff member's page needs in one call, for one goal year."""
    period: Optional[PeriodSettingsOut] = None
    periods: list[PeriodBriefOut] = []      # every goal year, newest first (the year selector)
    framework: Optional[FrameworkRowOut] = None
    framework_missing_reason: Optional[str] = None
    goal_set: Optional[GoalSetOut] = None
    mentor_name: Optional[str] = None
    miltenyi_reviewer_name: Optional[str] = None


class GoalItemTextIn(BaseModel):
    item_id: int
    goal_text: str = Field(default="", max_length=GOAL_TEXT_MAX)


class GoalItemsUpdate(BaseModel):
    items: list[GoalItemTextIn]


class CycleRef(BaseModel):
    cycle_label: str = Field(..., min_length=3, max_length=40)


class SelfReviewItemIn(BaseModel):
    item_id: int
    self_text: str = Field(default="", max_length=COMMENT_MAX)


class SelfReviewUpdate(CycleRef):
    items: list[SelfReviewItemIn]
    self_rating: Optional[int] = Field(default=None, ge=1, le=5)


class ApproveRequest(BaseModel):
    agreed_with: str = Field(..., min_length=1, max_length=200)
    agreed_on: date
    note: Optional[str] = Field(default=None, max_length=NOTE_MAX)


class ReviewItemIn(BaseModel):
    item_id: int
    primary_comment: str = Field(default="", max_length=COMMENT_MAX)
    healthark_note: str = Field(default="", max_length=NOTE_MAX)


class ReviewUpdate(CycleRef):
    items: list[ReviewItemIn]
    miltenyi_reviewer_name: Optional[str] = Field(default=None, max_length=200)
    source_received_on: Optional[date] = None
    final_rating: Optional[int] = Field(default=None, ge=1, le=5)
    final_rating_by: Literal["miltenyi", "healthark"] = "miltenyi"


class UnlockRequest(BaseModel):
    target: Literal["goals", "review"]
    cycle_label: Optional[str] = Field(default=None, max_length=40)   # required for target=review
    reason: str = Field(..., min_length=3, max_length=NOTE_MAX)

    @model_validator(mode="after")
    def _strip(self) -> "UnlockRequest":
        self.reason = self.reason.strip()
        if len(self.reason) < 3:
            raise ValueError("A reason is required to unlock.")
        if self.target == "review" and not self.cycle_label:
            raise ValueError("Say which quarter's review to unlock.")
        return self


class TeamRowOut(BaseModel):
    """One line of the mentor / Admin queue, for the selected quarter."""
    set_id: Optional[int] = None
    user_id: int
    full_name: str
    email: str
    function_name: Optional[str] = None
    designation_name: Optional[str] = None
    level: Optional[int] = None
    framework_title: Optional[str] = None
    has_framework: bool
    goals_status: GoalsStatus
    cycle_label: Optional[str] = None        # the quarter the review columns describe
    self_status: StepStatus = "not_started"
    review_status: StepStatus = "not_started"
    self_rating: Optional[int] = None
    final_rating: Optional[int] = None
    self_submitted_at: Optional[datetime] = None
    review_submitted_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    mentor_id: Optional[int] = None
    mentor_name: Optional[str] = None
    miltenyi_reviewer_name: Optional[str] = None


class ChangeLogOut(BaseModel):
    id: int
    action: str
    cycle_label: Optional[str] = None
    actor_id: Optional[int] = None
    actor_name: Optional[str] = None
    reason: Optional[str] = None
    before: Optional[str] = None
    after: Optional[str] = None
    created_at: datetime
