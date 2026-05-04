"""
Mentee Schemas — Master view for mentors.

MenteeSummary is the rolled-up card for the /my-mentees grid.
MenteeDetail inherits it and adds the full nested goal, review, and
project lists used by the /my-mentees/:id detail page.

Pending-action counting (what drives the "Needs my attention" filter):
    - Annual goals in SUBMITTED approval_status                (awaiting approval)
    - Active-cycle AnnualReview in PENDING_MENTOR status       (awaiting eval)
"""

from pydantic import BaseModel, ConfigDict
from typing import Optional, List

from app.schemas.goal_schemas import TeamGoalResponse
from app.schemas.annual_review_schemas import AnnualReviewResponse
from app.schemas.project_review_schemas import ProjectReviewResponse


# =====================================================================
# STATS SUB-SCHEMAS
# =====================================================================

class MenteeGoalsStats(BaseModel):
    """Annual-goal counts + average criteria-progress for a single mentee."""
    total: int
    approved: int
    submitted: int
    draft: int
    changes_requested: int
    # Average of progress_percent across APPROVED annual goals. 0 when none.
    avg_progress_percent: int


class MenteeReviewStatus(BaseModel):
    """Active-cycle AnnualReview summary. All None when no review exists yet."""
    review_id: Optional[int] = None
    cycle_name: Optional[str] = None
    status: Optional[str] = None
    # Stage 2 output — only present once the mentor has evaluated.
    mentor_performance_rating: Optional[int] = None
    # Stage 3 output — only visible after HR publishes AND the org-wide
    # annual_review_final_rating_visible flag is on.
    final_performance_rating: Optional[int] = None


class MenteeProjectsStats(BaseModel):
    """Project assignment counters rolled up for the card."""
    active_count: int
    pending_reviews_count: int
    latest_performance_group: Optional[int] = None


class MenteeProjectAssignment(BaseModel):
    """
    One row per (mentee-project-cycle). A project the mentee is on may emit
    multiple rows — one per existing ProjectReview (across cycles) plus a
    placeholder for the active cycle when no review row exists yet.
    """
    project_id: int
    project_name: str
    project_code: str
    assignment_role: Optional[str] = None
    evaluator_type: Optional[str] = None     # The MENTEE's evaluator_type on this project.
    review_status: Optional[str] = None      # pending / reviewed / None (placeholder for active cycle)
    performance_group: Optional[str] = None  # "1".."5" per ProjectReview.performance_group
    cycle: Optional[str] = None              # Real cycle when a review exists; active_cycle on placeholder rows
    # Display name of the project's Primary evaluator (PM). Null when the
    # project has no Primary assignment.
    pm_name: Optional[str] = None
    # The CURRENT mentor's own evaluator_type on this project, NOT the mentee's.
    # Drives which action the Projects tab shows on each row:
    #   "Primary"   → mentor is the PM and can evaluate / edit
    #   "Secondary" → mentor can submit an impact statement
    #   None        → mentor has no evaluator seat here — view-only
    viewer_evaluator_role: Optional[str] = None
    # Populated only when review_status == "reviewed". Carries the full PM
    # evaluation — competency comments, impact, secondary feedback — so the
    # Projects tab can render the same detail the employee sees on the
    # Project Reviews page.
    review_detail: Optional[ProjectReviewResponse] = None


# =====================================================================
# CARD / DETAIL RESPONSES
# =====================================================================

class MenteeSummary(BaseModel):
    """Snapshot shown on the /my-mentees grid — one per mentee."""
    user_id: int
    full_name: str
    email: str
    employee_code: str
    phone: Optional[str] = None
    department_name: Optional[str] = None
    designation_name: Optional[str] = None
    role: str
    is_active: bool

    goals: MenteeGoalsStats
    review: MenteeReviewStatus
    projects: MenteeProjectsStats
    # Submitted-goal count + PENDING_MENTOR review count. Drives the
    # amber "Needs your attention" strip on the card.
    pending_actions_count: int

    model_config = ConfigDict(from_attributes=True)


class MenteeDetail(MenteeSummary):
    """Expanded view for /my-mentees/:id — adds full nested lists."""
    goals_list: List[TeamGoalResponse] = []
    reviews_list: List[AnnualReviewResponse] = []
    project_assignments: List[MenteeProjectAssignment] = []
