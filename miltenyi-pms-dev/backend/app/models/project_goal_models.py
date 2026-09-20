"""
Project Goals — Miltenyi "Indicative Goal Themes" framework and the per-employee
goal set evaluated against it.

Why a new module (see docs/meetings/2026-09-02-miltenyi-goals-gap-review.md,
option C): the existing project_reviews are keyed per employee × project ×
cycle and written by a Miltenyi PM login; annual goals carry a mentor approval
loop and a hard H1/H2 cadence. The approved design is one goal set per
employee per period, no comment loop at goal setting, and a review entered by
the employee's Mentor on behalf of an offline Miltenyi reviewer. Additive
tables keep both older modules intact.

Shape:
    GoalFramework          one row of the Miltenyi document: (function, level, period)
      └ GoalFrameworkKpi   ordered KPI + weightage (weights total 100 per row)
    ProjectGoalSet         one per employee per period; status machine below
      ├ ProjectGoalItem    one per KPI: snapshot of KPI text/weight + the goal text
      └ ProjectGoalReview  one per cycle label (CY 2026 has exactly one)
          └ ProjectGoalReviewItem  per item: self text, Miltenyi comment, Healthark note
    ProjectGoalChangeLog   append-only audit of submit / approve / unlock / edit
    ProjectGoalPeriodSettings  per-period switches (entry open, self-review open,
                               weightages visible, ratings visible)

Set status: draft → submitted → approved → self_reviewed → reviewed.
"""

import enum
import re
from datetime import date

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


# ── Framework ────────────────────────────────────────────────────────

class GoalFramework(Base):
    """One role/level row of the Miltenyi goal-themes document.

    The document's first column is headed "Function" and holds the role
    title (Statistical Programmer, Biostatistician, ...); `title` stores
    that, `function_id` points at the department, `level` is the GCC
    career band 1..4 that `designations.career_level` resolves to.
    """
    __tablename__ = "goal_frameworks"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    function_id = Column(Integer, ForeignKey("functions.id"), nullable=False)
    level = Column(Integer, nullable=False)                 # 1..4
    period_label = Column(String, nullable=False)           # e.g. "CY 2026"

    title = Column(String, nullable=False)                  # role title, as printed
    business_outcomes = Column(Text, nullable=False)        # Illustrative Business & Strategic Outcomes
    functional_goals = Column(Text, nullable=False)         # Illustrative Functional / Operational Excellence Goals

    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("org_id", "function_id", "level", "period_label", name="uix_goal_framework_row"),
    )

    function = relationship("Function")
    kpis = relationship(
        "GoalFrameworkKpi",
        back_populates="framework",
        cascade="all, delete-orphan",
        order_by="GoalFrameworkKpi.seq",
        lazy="joined",
    )


class GoalFrameworkKpi(Base):
    __tablename__ = "goal_framework_kpis"

    id = Column(Integer, primary_key=True, index=True)
    framework_id = Column(Integer, ForeignKey("goal_frameworks.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)                   # 1-based display order
    text = Column(Text, nullable=False)
    weightage = Column(Integer, nullable=False)             # percent; a row's KPIs total 100

    __table_args__ = (
        UniqueConstraint("framework_id", "seq", name="uix_goal_framework_kpi_seq"),
    )

    framework = relationship("GoalFramework", back_populates="kpis")


# ── Goal set ─────────────────────────────────────────────────────────

class ProjectGoalSetStatus(str, enum.Enum):
    """Lifecycle of the GOALS. Goals are set once a year; the quarterly
    self-review / Miltenyi review live on ProjectGoalReview rows (one per
    quarter) and have their own draft/submitted flags."""
    DRAFT = "draft"                    # employee writing goals
    SUBMITTED = "submitted"            # goals recorded; waiting for the mentor to record the offline approval
    APPROVED = "approved"              # locked for the year; quarterly reviews run against these goals


SET_STATUS_ORDER: tuple[str, ...] = tuple(s.value for s in ProjectGoalSetStatus)


def status_at_least(status: str, floor: str) -> bool:
    """True when `status` is at or past `floor` in the set lifecycle."""
    return SET_STATUS_ORDER.index(status) >= SET_STATUS_ORDER.index(floor)


class ProjectGoalSet(Base):
    __tablename__ = "project_goal_sets"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    period_label = Column(String, nullable=False)
    # The framework row the set was created from. Items snapshot the KPI text
    # and weight, so a later framework edit does not rewrite this set; the FK
    # is kept for reporting and for the title/paragraph display.
    framework_id = Column(Integer, ForeignKey("goal_frameworks.id"), nullable=True)

    status = Column(String, nullable=False, default=ProjectGoalSetStatus.DRAFT.value)

    submitted_at = Column(DateTime(timezone=True), nullable=True)
    # "Mark approved (agreed offline)" — recorded by the mentor.
    approved_at = Column(DateTime(timezone=True), nullable=True)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_agreed_with = Column(String, nullable=True)    # the Miltenyi person who agreed the goals
    approved_agreed_on = Column(Date, nullable=True)
    approval_note = Column(Text, nullable=True)             # internal, HR/mentor only
    # Employee's read receipt on the final review.
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("org_id", "user_id", "period_label", name="uix_project_goal_set_user_period"),
    )

    owner = relationship("User", foreign_keys=[user_id])
    approved_by = relationship("User", foreign_keys=[approved_by_id])
    framework = relationship("GoalFramework")
    items = relationship(
        "ProjectGoalItem",
        back_populates="goal_set",
        cascade="all, delete-orphan",
        order_by="ProjectGoalItem.seq",
        lazy="joined",
    )
    reviews = relationship(
        "ProjectGoalReview",
        back_populates="goal_set",
        cascade="all, delete-orphan",
        order_by="ProjectGoalReview.id",
    )


class ProjectGoalItem(Base):
    """One row of the employee's table: the KPI (snapshot) and the goal."""
    __tablename__ = "project_goal_items"

    id = Column(Integer, primary_key=True, index=True)
    set_id = Column(Integer, ForeignKey("project_goal_sets.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)
    kpi_id = Column(Integer, ForeignKey("goal_framework_kpis.id", ondelete="SET NULL"), nullable=True)
    kpi_text = Column(Text, nullable=False)                 # snapshot at set creation
    weightage = Column(Integer, nullable=False)             # snapshot at set creation
    goal_text = Column(Text, nullable=True)
    # The "Additional goals" row (HR requirement, Sep 2026): free text for
    # anything else the staff member works on; weightage set by the Admin per
    # goal year; optional everywhere (no KPI behind it).
    is_extra = Column(Boolean, nullable=False, default=False, server_default="false")

    __table_args__ = (
        UniqueConstraint("set_id", "seq", name="uix_project_goal_item_seq"),
    )

    goal_set = relationship("ProjectGoalSet", back_populates="items")


# ── Review (self + Miltenyi comments entered by the mentor) ──────────

class FinalRatingBy(str, enum.Enum):
    MILTENYI = "miltenyi"
    HEALTHARK = "healthark"


class ProjectGoalReview(Base):
    """The evaluation of one goal set for one cycle. CY 2026 has exactly one
    (cycle_label == period_label); the column exists so quarterly cycles can
    be added later without a schema change."""
    __tablename__ = "project_goal_reviews"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    set_id = Column(Integer, ForeignKey("project_goal_sets.id", ondelete="CASCADE"), nullable=False)
    cycle_label = Column(String, nullable=False)                 # quarter label, e.g. "Q3 CY 2026" (see quarter_label)

    # Employee side
    self_rating = Column(Integer, nullable=True)            # 1..5, one for the whole set
    self_is_draft = Column(Boolean, nullable=False, default=True)
    self_submitted_at = Column(DateTime(timezone=True), nullable=True)

    # Mentor side, entered on behalf of the Miltenyi reviewer
    reviewer_id = Column(Integer, ForeignKey("users.id"), nullable=True)      # mentor of record when entered
    entered_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)    # who typed it (normally the same)
    miltenyi_reviewer_name = Column(String, nullable=True)
    source_received_on = Column(Date, nullable=True)
    source_url = Column(String, nullable=True)              # link to the email / file the comments came from
    final_rating = Column(Integer, nullable=True)           # 1..5, one for the whole set
    final_rating_by = Column(String, nullable=False, default=FinalRatingBy.MILTENYI.value)
    review_is_draft = Column(Boolean, nullable=False, default=True)
    review_submitted_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)      # employee read-receipt for this quarter

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("set_id", "cycle_label", name="uix_project_goal_review_cycle"),
    )

    goal_set = relationship("ProjectGoalSet", back_populates="reviews")
    reviewer = relationship("User", foreign_keys=[reviewer_id])
    entered_by = relationship("User", foreign_keys=[entered_by_id])
    items = relationship(
        "ProjectGoalReviewItem",
        back_populates="review",
        cascade="all, delete-orphan",
        order_by="ProjectGoalReviewItem.id",
        lazy="joined",
    )


class ProjectGoalReviewItem(Base):
    __tablename__ = "project_goal_review_items"

    id = Column(Integer, primary_key=True, index=True)
    review_id = Column(Integer, ForeignKey("project_goal_reviews.id", ondelete="CASCADE"), nullable=False)
    item_id = Column(Integer, ForeignKey("project_goal_items.id", ondelete="CASCADE"), nullable=False)
    self_text = Column(Text, nullable=True)
    primary_comment = Column(Text, nullable=True)           # the Miltenyi reviewer's words, transcribed
    healthark_note = Column(Text, nullable=True)            # optional, the mentor's own remark

    __table_args__ = (
        UniqueConstraint("review_id", "item_id", name="uix_project_goal_review_item"),
    )

    review = relationship("ProjectGoalReview", back_populates="items")
    item = relationship("ProjectGoalItem")


# ── Audit + period switches ──────────────────────────────────────────

class ProjectGoalChangeLog(Base):
    """Append-only. Every submit, approve, self-submit, review submit,
    post-submission edit and unlock writes one row with the before/after
    payload as JSON text, so a transcribed Miltenyi comment can never be
    changed silently after the employee has read it."""
    __tablename__ = "project_goal_change_logs"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    set_id = Column(Integer, ForeignKey("project_goal_sets.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String, nullable=False)                 # submit | approve | self_submit | review_submit | unlock | acknowledge
    cycle_label = Column(String, nullable=True)             # the quarter an action concerns; NULL for goal-level actions
    before = Column(Text, nullable=True)                    # JSON
    after = Column(Text, nullable=True)                     # JSON
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    actor = relationship("User", foreign_keys=[actor_id])


class ProjectGoalPeriodSettings(Base):
    """One goal period = one goal year, labelled as a span ("CY 26-27": the
    year ends around April). Exactly one row per org is active; the staff
    surfaces default to that row and can look back at past years.

    The yearly switches live here (goal entry, weightages). The review
    window is NOT a switch: it is the Admin-advanced `current_quarter_seq`
    — quarters at or before it are writable, later ones are closed (the
    Healthark PMS roll-out model). Per-quarter rows are ProjectGoalQuarter."""
    __tablename__ = "project_goal_period_settings"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    period_label = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    entry_open = Column(Boolean, nullable=False, default=True)          # staff may draft/submit goals (once a year)
    weightages_visible = Column(Boolean, nullable=False, default=True)  # show % to staff
    # After the year rolls over, its started quarters stay writable while this
    # is on (Healthark PMS: a past year stays open after the system advanced).
    # The Admin closes the year from System Settings. Meaningless while active.
    backfill_open = Column(Boolean, nullable=False, default=True, server_default="true")
    # The optional "Additional goals" row at the end of every goal sheet of
    # this year, and the weightage the Admin gives it (informational).
    extra_goal_enabled = Column(Boolean, nullable=False, default=False, server_default="false")
    extra_goal_weightage = Column(Integer, nullable=False, default=10, server_default="10")
    current_quarter_seq = Column(Integer, nullable=True)                # 1..4; NULL until the first roll-out / manual set
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("org_id", "period_label", name="uix_project_goal_period"),
    )


# ── Quarters (the review cycles of a period) ─────────────────────────

QUARTER_SEQS: tuple[int, ...] = (1, 2, 3, 4)
EXTRA_GOAL_LABEL = "Additional goals"


def quarter_label(period_label: str, seq: int) -> str:
    """Stored cycle label of a quarter: ("CY 26-27", 3) -> "Q3 CY 26-27"."""
    return f"Q{seq} {period_label}"


def quarter_display(cycle_label: str) -> str:
    """UI form of a stored label: "Q3 CY 26-27" -> "Q3 · CY 26-27"."""
    seq, period = parse_quarter_label(cycle_label)
    return f"Q{seq} · {period}"


def parse_quarter_label(label: str) -> tuple[int, str]:
    """"Q3 CY 26-27" -> (3, "CY 26-27"). ValueError on anything else."""
    parts = (label or "").strip().split(" ", 1)
    if len(parts) != 2 or not parts[0].startswith("Q") or not parts[0][1:].isdigit():
        raise ValueError(f"Not a quarter label: {label!r}")
    seq = int(parts[0][1:])
    if seq not in QUARTER_SEQS:
        raise ValueError(f"Quarter out of range: {label!r}")
    return seq, parts[1]


_SPAN_RE = re.compile(r"^(?P<prefix>[A-Za-z]+) (?P<y1>\d{2})-(?P<y2>\d{2})$")
_YEAR_RE = re.compile(r"^(?P<prefix>[A-Za-z]+) (?P<year>\d{4})$")
PERIOD_PREFIX = "CY"


def period_start_year(period_label: str) -> int:
    """"CY 26-27" -> 2026 (the legacy "CY 2026" form is still read)."""
    label = (period_label or "").strip()
    m = _SPAN_RE.match(label)
    if m:
        return 2000 + int(m.group("y1"))
    m = _YEAR_RE.match(label)
    if m:
        return int(m.group("year"))
    raise ValueError(f"Not a goal-year label: {period_label!r}")


def period_year(period_label: str) -> int:
    """Alias kept for older call sites."""
    return period_start_year(period_label)


def period_label_for(start_year: int, prefix: str = PERIOD_PREFIX) -> str:
    """2026 -> "CY 26-27"."""
    return f"{prefix} {start_year % 100:02d}-{(start_year + 1) % 100:02d}"


def _prefix_of(period_label: str) -> str:
    m = _SPAN_RE.match(period_label.strip()) or _YEAR_RE.match(period_label.strip())
    return m.group("prefix") if m else PERIOD_PREFIX


def next_period_label(period_label: str) -> str:
    """"CY 26-27" -> "CY 27-28"."""
    return period_label_for(period_start_year(period_label) + 1, _prefix_of(period_label))


def previous_period_label(period_label: str) -> str:
    """"CY 26-27" -> "CY 25-26"."""
    return period_label_for(period_start_year(period_label) - 1, _prefix_of(period_label))


def default_period_label(today: date, fiscal_start_month: int = 4) -> str:
    """The goal year `today` falls in: with an April start, Sep 2026 -> "CY 26-27",
    Feb 2027 -> "CY 26-27", Apr 2027 -> "CY 27-28"."""
    start_year = today.year if today.month >= fiscal_start_month else today.year - 1
    return period_label_for(start_year)


class ProjectGoalQuarter(Base):
    """One row per quarter that has STARTED in a period (seq <= the period's
    current quarter). Created by the roll-out. Carries the two per-quarter
    switches: whether the final rating is shown to the staff member, and
    whether the quarter is still open for backfill."""
    __tablename__ = "project_goal_quarters"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    period_label = Column(String, nullable=False)
    seq = Column(Integer, nullable=False)                               # 1..4
    cycle_label = Column(String, nullable=False)                        # "Q3 CY 2026"
    ratings_visible = Column(Boolean, nullable=False, default=False)    # release this quarter's final ratings to staff
    # An earlier quarter stays writable (backfill) while this is on; the
    # current quarter of the active year is always open. A past year's quarter
    # also needs the year's backfill_open.
    backfill_open = Column(Boolean, nullable=False, default=True, server_default="true")
    opened_at = Column(DateTime(timezone=True), server_default=func.now())
    opened_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    __table_args__ = (
        UniqueConstraint("org_id", "period_label", "seq", name="uix_project_goal_quarter"),
    )


class ProjectGoalCycleLog(Base):
    """Audit trail of the Admin-advanced quarter: who moved it, from what,
    to what, and how (rollout | set | rollback). Mirrors the Healthark PMS
    cycle_rollout_log."""
    __tablename__ = "project_goal_cycle_logs"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    from_label = Column(String, nullable=True)                          # NULL before the first quarter was set
    to_label = Column(String, nullable=False)
    kind = Column(String, nullable=False)                               # rollout | set | rollback
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    actor = relationship("User", foreign_keys=[actor_id])
