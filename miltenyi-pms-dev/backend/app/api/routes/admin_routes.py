"""
Admin Routes — The HR Administrator's Control Panel.

Endpoints:
    GET    /api/v1/admin/users              → List all org users
    POST   /api/v1/admin/users              → Create a new user
    PATCH  /api/v1/admin/users/{user_id}    → Update user details
    DELETE /api/v1/admin/users/{user_id}    → Soft-delete (deactivate) a user
    GET    /api/v1/admin/functions           → List functions (for dropdowns)
    GET    /api/v1/admin/designations        → List designations (for dropdowns)
    GET    /api/v1/admin/settings            → Get simplified active cycle info
    PATCH  /api/v1/admin/settings            → Update active cycle

Security Layers Applied (ALL endpoints):
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: Every query filters by current_user.org_id
    Layer 3 — Role Authorization: Each endpoint requires HR_MyOrg or HR_Miltenyi
    Layer 4 — Target Protection: HR_Miltenyi cannot create/edit/deactivate
                                 Mentor or HR_MyOrg users (security boundary)
"""

import re
import secrets
import string
from typing import List, Literal, Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import aliased, joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.core.cache import (
    functions_cache,
    designations_cache,
    invalidate_settings,
)
from app.core.config import settings
from app.core.security import get_password_hash
from app.models.user_models import User, Role, ADMIN_ROLES, PROTECTED_USER_ROLES
from app.models.reference_models import Function, Designation
from app.models.project_models import (
    Project,
    ProjectAssignment,
    PROJECT_STATUS_ACTIVE,
)
from app.models.project_review_models import (
    ProjectReview,
    ProjectReviewEvaluator,
    ProjectReviewStatus,
    EvaluatorStatus,
)
from app.models.system_settings_models import SystemSettings, CycleType
from app.core.cycle_utils import (
    YEAR_OVERRIDE_FLAGS,
    ensure_year_override_row,
    extract_fy_label,
    get_current_cycle_info,
    resolve_today,
)
from app.models.system_settings_year_override_models import (
    SystemSettingsYearOverride,
)
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.goal_models import Goal, GoalType, ApprovalStatus
from app.models.mentor_reassignment_log_models import MentorReassignmentLog
from sqlalchemy import func as sql_func
from app.services.send_email import (
    is_smtp_configured,
    send_welcome_user_email,
)
from app.services.notification_service import notify, notify_many
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from app.schemas.admin_schemas import (
    FunctionBrief,
    DesignationBrief,
    UserResponse,
    UserCreate,
    UserUpdate,
    AdminSettingsResponse,
    AdminSettingsUpdate,
    YearOption,
    YearOptionsResponse,
    YearSettingsResponse,
    YearSettingsUpdate,
    YearPreflightEntry,
    YearPreflightResponse,
)
from app.schemas.pagination import Paginated


_TEMP_PASSWORD_ALPHABET = string.ascii_letters + string.digits


def _generate_temp_password(length: int = 12) -> str:
    """Crypto-random temp password using `secrets.choice`. Letters+digits only
    to avoid ambiguous shell-escape characters when the admin relays it."""
    return "".join(secrets.choice(_TEMP_PASSWORD_ALPHABET) for _ in range(length))

router = APIRouter()


# ── Reusable Role Guards ─────────────────────────────────────────────

def _require_hr_any(current_user: User) -> None:
    """Raise 403 unless the caller is HR_MyOrg or HR_Miltenyi.

    Both HR roles can hit the read endpoints + most write endpoints; the
    target-protection check below adds the extra constraint on which rows
    HR_Miltenyi may mutate.
    """
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only HR users can access this resource.",
        )


def _require_hr_myorg(current_user: User) -> None:
    """Raise 403 unless the caller is HR_MyOrg (the full super-admin)."""
    if current_user.role != Role.HR_MYORG.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the Healthark HR can access this resource.",
        )


def _validate_mentor_role(
    db: DbSession, org_id: int, mentor_id: int | None
) -> None:
    """Confirm the user being assigned as mentor exists, is in this org,
    is not soft-deleted, and has role=Mentor.

    Called from create_user + update_user before persisting any
    mentor_id change. The frontend filters the picker to Mentor-role
    users only, but this server-side gate protects against direct API
    callers (curl / Postman / future admin tooling) that could
    otherwise assign a PM / Employee / HR user as somebody's mentor
    and produce nonsensical mentor pairings.

    Pass `mentor_id=None` to short-circuit — unassigning is always
    valid.
    """
    if mentor_id is None:
        return
    mentor = db.query(User).filter(
        User.id == mentor_id,
        User.org_id == org_id,
        User.is_deleted == False,  # noqa: E712
    ).first()
    if mentor is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assigned mentor not found in this organization.",
        )
    if mentor.role != Role.MENTOR.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Assigned mentor must have role=Mentor "
                f"(user '{mentor.full_name}' has role={mentor.role})."
            ),
        )


# ── Mentor-transition cascade (docs/policies/mentor-transition-policy.md) ──
#
# Statuses where the assigned mentor still owes an action. Drives the
# cascade in `_cascade_mentor_reassignment` and `_orphan_mentees`: rows
# in these statuses have their stamped mentor reassigned to the new
# mentor (or NULL on orphan), so the new mentor inherits the work.
# Rows OUTSIDE these statuses (post-mentor-review, completed,
# fully-cycled-through) stay stamped with the original mentor so the
# audit story "who actually did the work" is preserved.

_GOAL_IN_FLIGHT_STATUSES = frozenset({
    # Pre-approval lifecycle — mentor owes the approval decision.
    ApprovalStatus.DRAFT.value,
    ApprovalStatus.PENDING_APPROVAL.value,
    ApprovalStatus.CHANGES_REQUESTED.value,
    # Mid-cycle review — employee has self-reviewed for the half/quarter;
    # mentor still owes the mentor-review submission for THIS cycle.
    # Each cycle is independent: moving to a new mentor means the new
    # mentor does THIS cycle's review. Once the mentor reviews
    # (advancing the status to *_mentor_reviewed), that cycle is closed
    # — historical attribution preserved.
    ApprovalStatus.H1_SELF_REVIEWED.value,
    ApprovalStatus.H2_SELF_REVIEWED.value,
    ApprovalStatus.Q1_SELF_REVIEWED.value,
    ApprovalStatus.Q2_SELF_REVIEWED.value,
    ApprovalStatus.Q3_SELF_REVIEWED.value,
    ApprovalStatus.Q4_SELF_REVIEWED.value,
})

_REVIEW_IN_FLIGHT_STATUSES = frozenset({
    # Self-review drafted but not yet routed to mentor — mentor still
    # owes the evaluation once it lands in their queue.
    ReviewStatus.DRAFT.value,
    # Mentor's turn to evaluate.
    ReviewStatus.PENDING_MENTOR.value,
    # NOTE: pending_management + completed are NOT in-flight — the
    # mentor has already submitted their evaluation; reassignment
    # shouldn't rewrite history.
})


def _log_mentor_move(
    db: DbSession,
    *,
    org_id: int,
    admin_user_id: int,
    employee_user_id: int,
    entity_type: str,
    entity_id: int | None,
    old_mentor_id: int | None,
    new_mentor_id: int | None,
    reason: str,
) -> None:
    """Append one row to mentor_reassignment_logs.

    Caller is responsible for `db.commit()` — this just adds the row.
    Keep this in a single helper so every cascade path uses the same
    schema (no per-call divergence on column names / shape).
    """
    db.add(MentorReassignmentLog(
        org_id=org_id,
        admin_user_id=admin_user_id,
        employee_user_id=employee_user_id,
        entity_type=entity_type,
        entity_id=entity_id,
        old_mentor_id=old_mentor_id,
        new_mentor_id=new_mentor_id,
        reason=reason,
    ))


def _cascade_mentor_reassignment(
    db: DbSession,
    *,
    admin: User,
    mentee: User,
    old_mentor_id: int | None,
    new_mentor_id: int | None,
    reason: str,
) -> None:
    """Move all in-flight stamped mentor refs for `mentee` from the old
    mentor to the new mentor (or NULL on orphan / explicit unassign).

    Touches three things:
      1. Goal.manager_id for rows in `_GOAL_IN_FLIGHT_STATUSES`.
      2. AnnualReview.mentor_id (and clears the mentor-draft fields)
         for rows in `_REVIEW_IN_FLIGHT_STATUSES`.
      3. ALSO claims any NULL-stamped in-flight rows when assigning a
         new mentor — this handles the re-mentoring-an-orphan case
         where the previous cascade had set the stamped mentor to
         NULL on deactivation.

    Logs one row to mentor_reassignment_logs per moved entity. Caller
    owns the surrounding commit.

    Does NOT touch User.mentor_id itself — that's the caller's
    responsibility (the cascade only handles downstream stamped
    references on related rows).
    """
    # ── 1. Move rows currently stamped with the old mentor ────────────
    if old_mentor_id is not None:
        moved_goals = (
            db.query(Goal.id)
            .filter(
                Goal.user_id == mentee.id,
                Goal.manager_id == old_mentor_id,
                Goal.approval_status.in_(_GOAL_IN_FLIGHT_STATUSES),
            )
            .all()
        )
        if moved_goals:
            goal_ids = [gid for (gid,) in moved_goals]
            db.query(Goal).filter(Goal.id.in_(goal_ids)).update(
                {"manager_id": new_mentor_id},
                synchronize_session=False,
            )
            for gid in goal_ids:
                _log_mentor_move(
                    db,
                    org_id=mentee.org_id,
                    admin_user_id=admin.id,
                    employee_user_id=mentee.id,
                    entity_type="goal",
                    entity_id=gid,
                    old_mentor_id=old_mentor_id,
                    new_mentor_id=new_mentor_id,
                    reason=reason,
                )

        moved_reviews = (
            db.query(AnnualReview.id)
            .filter(
                AnnualReview.user_id == mentee.id,
                AnnualReview.mentor_id == old_mentor_id,
                AnnualReview.status.in_(_REVIEW_IN_FLIGHT_STATUSES),
            )
            .all()
        )
        if moved_reviews:
            review_ids = [rid for (rid,) in moved_reviews]
            # Clear mentor-side drafts when the row moves — the new
            # mentor types their own evaluation rather than
            # inheriting half-typed words from the previous mentor
            # (Scenario 3b in the policy doc). The self-side drafts
            # belong to the employee and stay untouched.
            db.query(AnnualReview).filter(AnnualReview.id.in_(review_ids)).update(
                {
                    "mentor_id": new_mentor_id,
                    "mentor_overall_review_draft": None,
                    "mentor_performance_rating_draft": None,
                },
                synchronize_session=False,
            )
            for rid in review_ids:
                _log_mentor_move(
                    db,
                    org_id=mentee.org_id,
                    admin_user_id=admin.id,
                    employee_user_id=mentee.id,
                    entity_type="annual_review",
                    entity_id=rid,
                    old_mentor_id=old_mentor_id,
                    new_mentor_id=new_mentor_id,
                    reason=reason,
                )

    # ── 2. Claim NULL-stamped in-flight rows when assigning a NEW mentor
    # to a previously-orphaned mentee. After a deactivation cascade the
    # mentee's in-flight goals/reviews carry manager_id=NULL /
    # mentor_id=NULL. When HR finally assigns them a new mentor, those
    # rows need to be claimed too (the loop above wouldn't catch them
    # because old_mentor_id is None — the orphan state).
    if new_mentor_id is not None:
        claimed_goals = (
            db.query(Goal.id)
            .filter(
                Goal.user_id == mentee.id,
                Goal.manager_id.is_(None),
                Goal.approval_status.in_(_GOAL_IN_FLIGHT_STATUSES),
            )
            .all()
        )
        if claimed_goals:
            goal_ids = [gid for (gid,) in claimed_goals]
            db.query(Goal).filter(Goal.id.in_(goal_ids)).update(
                {"manager_id": new_mentor_id},
                synchronize_session=False,
            )
            for gid in goal_ids:
                _log_mentor_move(
                    db,
                    org_id=mentee.org_id,
                    admin_user_id=admin.id,
                    employee_user_id=mentee.id,
                    entity_type="goal",
                    entity_id=gid,
                    old_mentor_id=None,
                    new_mentor_id=new_mentor_id,
                    reason=reason,
                )

        claimed_reviews = (
            db.query(AnnualReview.id)
            .filter(
                AnnualReview.user_id == mentee.id,
                AnnualReview.mentor_id.is_(None),
                AnnualReview.status.in_(_REVIEW_IN_FLIGHT_STATUSES),
            )
            .all()
        )
        if claimed_reviews:
            review_ids = [rid for (rid,) in claimed_reviews]
            db.query(AnnualReview).filter(AnnualReview.id.in_(review_ids)).update(
                {"mentor_id": new_mentor_id},
                synchronize_session=False,
            )
            for rid in review_ids:
                _log_mentor_move(
                    db,
                    org_id=mentee.org_id,
                    admin_user_id=admin.id,
                    employee_user_id=mentee.id,
                    entity_type="annual_review",
                    entity_id=rid,
                    old_mentor_id=None,
                    new_mentor_id=new_mentor_id,
                    reason=reason,
                )


def _orphan_mentees(
    db: DbSession,
    *,
    admin: User,
    departing_mentor: User,
    reason: str,
) -> int:
    """Sweep every active mentee of `departing_mentor` and mark them
    orphaned. Used when the mentor is deactivated OR their role is
    changed away from Mentor.

    For each mentee:
      - Set mentor_id = NULL
      - Stamp mentor_orphaned_at = NOW()
      - Cascade their in-flight goal/review rows to NULL stamped
        mentor (work freezes until HR reassigns).
      - Log a 'user' entity move alongside the per-row cascade logs.

    After the per-mentee work, fire ONE notification per HR_MyOrg user
    in the org with the affected count so HR knows to reassign these
    orphans. Returns the orphan count for the caller (so the route can
    surface it in the response if needed).

    Caller owns the surrounding db.commit().
    """
    mentees = (
        db.query(User)
        .filter(
            User.org_id == departing_mentor.org_id,
            User.mentor_id == departing_mentor.id,
            User.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    if not mentees:
        return 0

    now = datetime.now(timezone.utc)

    for mentee in mentees:
        # Per-mentee cascade: in-flight goals + reviews lose their
        # stamped mentor (set to NULL).
        _cascade_mentor_reassignment(
            db,
            admin=admin,
            mentee=mentee,
            old_mentor_id=departing_mentor.id,
            new_mentor_id=None,
            reason=reason,
        )
        # Flip the mentee's own pointer + stamp the orphan timestamp.
        mentee.mentor_id = None
        mentee.mentor_orphaned_at = now
        # Log the user-level move alongside the per-row entries.
        _log_mentor_move(
            db,
            org_id=mentee.org_id,
            admin_user_id=admin.id,
            employee_user_id=mentee.id,
            entity_type="user",
            entity_id=mentee.id,
            old_mentor_id=departing_mentor.id,
            new_mentor_id=None,
            reason=reason,
        )

    # Shared phrasing for the mentor's exit reason — used by both the
    # mentee notification (below) and the HR fan-out further down so
    # the two surfaces describe the event the same way.
    reason_phrase = (
        "deactivated" if reason == "deactivation" else "no longer a Mentor"
    )

    # Notify the mentees themselves so they aren't left wondering why
    # their mentor disappeared from the dashboard / why their reviews
    # froze. Same message body for every recipient — they all lost the
    # same mentor — so notify_many is the right primitive. In-app only
    # to match the HR fan-out style (no send_email).
    #
    # `sender_id=admin.id` keeps the audit trail honest ("HR did this")
    # rather than attributing the notification to the system or to the
    # departing mentor.
    mentee_ids = [m.id for m in mentees]
    notify_many(
        db,
        org_id=departing_mentor.org_id,
        recipient_ids=mentee_ids,
        sender_id=admin.id,
        module="admin",
        entity_type=f"mentor_{reason}",
        entity_id=departing_mentor.id,
        message=(
            f"Your mentor {departing_mentor.full_name} is {reason_phrase}. "
            f"HR will reassign you to a new mentor soon."
        ),
        entity_url="/dashboard",
    )

    # Notify all HR_MyOrg users so the dashboard's orphan bucket gets
    # human attention. One notification per HR user, in-app.
    hr_user_ids = [
        uid for (uid,) in db.query(User.id)
        .filter(
            User.org_id == departing_mentor.org_id,
            User.role == Role.HR_MYORG.value,
            User.is_deleted == False,  # noqa: E712
        )
        .all()
    ]
    if hr_user_ids:
        count = len(mentees)
        mentee_word = "mentee" if count == 1 else "mentees"
        notify_many(
            db,
            org_id=departing_mentor.org_id,
            recipient_ids=hr_user_ids,
            sender_id=admin.id,
            module="admin",
            entity_type=f"mentor_{reason}",
            entity_id=departing_mentor.id,
            message=(
                f"Mentor {departing_mentor.full_name} is {reason_phrase}. "
                f"{count} {mentee_word} now need a new mentor."
            ),
            entity_url="/dashboard",
        )

    return len(mentees)


# ── PM Transition Cascade ─────────────────────────────────────────────
#
# Applies the same Option-C semantics as the mentor cascade to the
# PM-and-project axis. When HR deactivates a PM (or role-changes them
# away from PM) every project they ran needs:
#
#   1. `Project.pm_id` set to NULL — that's the live pointer.
#   2. `Project.pm_orphaned_at` stamped — drives the dashboard alert.
#   3. In-flight `ProjectReview.reviewer_id` rows nulled — so the
#      stranded drafts don't sit in a dead-user's queue. Closed
#      (`reviewed`) rows keep their stamped reviewer for audit history,
#      same as closed annual-reviews keep their stamped mentor.
#
# When HR assigns a NEW PM to an orphaned project, the cascade runs in
# reverse: claim any NULL-reviewer in-flight rows on this project back
# to the new PM. Same shape as `_cascade_mentor_reassignment`'s "claim
# orphaned rows" branch.
#
# In-flight ProjectReview statuses are `pending` (auto-created
# placeholder before the PM starts) and `draft` (PM saved partial
# work). `reviewed` is closed — those rows preserve their stamped
# reviewer_id forever for audit.

_PROJECT_REVIEW_IN_FLIGHT_STATUSES = frozenset({
    ProjectReviewStatus.PENDING.value,
    ProjectReviewStatus.DRAFT.value,
})


def _cascade_pm_reassignment(
    db: DbSession,
    *,
    project: Project,
    old_pm_id: int | None,
    new_pm_id: int | None,
) -> None:
    """Move all in-flight ProjectReview reviewer refs on `project` from
    the old PM to the new PM (or NULL on orphan / explicit unassign).

    Also handles the "re-mentoring an orphan" symmetry case: when
    assigning a NEW PM, claim any in-flight rows currently sitting at
    NULL reviewer (left there by a previous deactivation cascade) so
    the new PM gets a clean queue.

    Does NOT touch `Project.pm_id` or `Project.pm_orphaned_at` itself
    — caller (deactivate / role-change / PATCH) owns those because the
    surrounding update logic is route-specific (notifications, log
    rows, commit boundaries differ).

    No audit-log table for the PM axis: the mentor axis got one
    because reassignments touched many independent rows across
    employees + entities, but each PM swap is naturally scoped to one
    project — `ProjectReview.updated_at` already records the per-row
    move, so a parallel log adds noise without insight.
    """
    if old_pm_id is not None:
        # Rows currently stamped with the old PM → move them.
        db.query(ProjectReview).filter(
            ProjectReview.project_id == project.id,
            ProjectReview.reviewer_id == old_pm_id,
            ProjectReview.status.in_(_PROJECT_REVIEW_IN_FLIGHT_STATUSES),
            ProjectReview.is_deleted == False,  # noqa: E712
        ).update(
            {"reviewer_id": new_pm_id},
            synchronize_session=False,
        )

    if new_pm_id is not None:
        # Claim any NULL-stamped in-flight rows on this project — they
        # were left there by a previous deactivation cascade and need
        # to land in the new PM's queue.
        db.query(ProjectReview).filter(
            ProjectReview.project_id == project.id,
            ProjectReview.reviewer_id.is_(None),
            ProjectReview.status.in_(_PROJECT_REVIEW_IN_FLIGHT_STATUSES),
            ProjectReview.is_deleted == False,  # noqa: E712
        ).update(
            {"reviewer_id": new_pm_id},
            synchronize_session=False,
        )


def _orphan_pm_projects(
    db: DbSession,
    *,
    admin: User,
    departing_pm: User,
    reason: str,
) -> int:
    """Sweep every active project where `pm_id == departing_pm.id` and
    mark them orphaned. Used when the PM is deactivated OR their role
    is changed away from PM.

    For each project:
      - `Project.pm_id = NULL`
      - `Project.pm_orphaned_at = NOW()`
      - In-flight `ProjectReview.reviewer_id` rows nulled via
        `_cascade_pm_reassignment(..., new_pm_id=None)`.

    Soft-deleted + completed projects are skipped — the cascade is for
    operational ("act on me") state. A completed project that happened
    to be PM'd by the departing user doesn't need reassignment; its
    reviews are already closed.

    After the per-project work, fire ONE notification per HR_MyOrg
    user with the orphan count so they can chase the reassignment.
    Returns the count for the caller's response payload (if any).

    Caller owns the surrounding db.commit().
    """
    projects = (
        db.query(Project)
        .filter(
            Project.org_id == departing_pm.org_id,
            Project.pm_id == departing_pm.id,
            Project.is_deleted == False,  # noqa: E712
            Project.status == PROJECT_STATUS_ACTIVE,
        )
        .all()
    )
    if not projects:
        return 0

    now = datetime.now(timezone.utc)

    for project in projects:
        _cascade_pm_reassignment(
            db,
            project=project,
            old_pm_id=departing_pm.id,
            new_pm_id=None,
        )
        project.pm_id = None
        project.pm_orphaned_at = now

    # Notify all HR_MyOrg users so the dashboard's new orphan bucket
    # gets human attention. One in-app + email per HR user.
    hr_user_ids = [
        uid for (uid,) in db.query(User.id)
        .filter(
            User.org_id == departing_pm.org_id,
            User.role == Role.HR_MYORG.value,
            User.is_deleted == False,  # noqa: E712
        )
        .all()
    ]
    if hr_user_ids:
        count = len(projects)
        project_word = "project" if count == 1 else "projects"
        reason_phrase = (
            "deactivated" if reason == "deactivation" else "no longer a PM"
        )
        notify_many(
            db,
            org_id=departing_pm.org_id,
            recipient_ids=hr_user_ids,
            sender_id=admin.id,
            module="admin",
            entity_type=f"pm_{reason}",
            entity_id=departing_pm.id,
            message=(
                f"PM {departing_pm.full_name} is {reason_phrase}. "
                f"{count} {project_word} now need a new PM."
            ),
            entity_url="/dashboard",
        )

    return len(projects)


def _clear_secondary_drafts(
    db: DbSession,
    *,
    departing_user: User,
) -> int:
    """Hard-delete in-flight Secondary impact-statement rows owned by
    the departing user. Submitted rows stay (audit history).

    Each ProjectReviewEvaluator row is uniquely owned by one user —
    they can't be "transferred" to a new Secondary the way a PM
    handoff transfers a ProjectReview. The cleanest semantic is: when
    the Secondary goes away, their unsubmitted drafts go with them.
    The new Secondary HR assigns will start fresh with an empty
    statement field. Returns the deleted-row count for caller's logs.
    """
    deleted = (
        db.query(ProjectReviewEvaluator)
        .filter(
            ProjectReviewEvaluator.org_id == departing_user.org_id,
            ProjectReviewEvaluator.evaluator_id == departing_user.id,
            ProjectReviewEvaluator.status == EvaluatorStatus.DRAFT.value,
        )
        .delete(synchronize_session=False)
    )
    return deleted


def _authorize_user_mutation(current_user: User, target_role: str | None) -> None:
    """Enforce the security boundary on user-mutating endpoints.

    HR_MyOrg may create/edit/deactivate any user.
    HR_Miltenyi may NOT touch a row whose role is Mentor or HR_MyOrg —
    that's the boundary the user defined: "Miltenyi HR can't edit the 3
    mentors or the HR from MyOrg as a security measure."

    Also blocks HR_Miltenyi from *promoting* a user TO a protected role
    (e.g. flipping an Employee row's role to Mentor).

    Pass `target_role=None` when the operation doesn't change the role
    (e.g. deactivate); we look up the row's existing role at the call site.
    """
    if current_user.role == Role.HR_MYORG.value:
        return  # Healthark HR has full powers
    if target_role and target_role in PROTECTED_USER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Miltenyi HR cannot create or modify Mentors or Healthark HR users."
            ),
        )


# ── Identity Field Validators ─────────────────────────────────────────
#
# These three helpers run on every user create + update path and are the
# single source of truth for what a "valid" identity field looks like.
# The frontend mirrors them in `utils/text.ts` for UX feedback, but the
# backend is the hard gate — never assume the client validated.
#
# Domain map (kept in lock-step with Role docstring):
#   HR_MyOrg, Mentor                       → @healthark.ai
#   HR_Miltenyi, PM, Employee              → @miltenyi.com OR @external.miltenyi.com

_HEALTHARK_ROLES = frozenset({Role.HR_MYORG.value, Role.MENTOR.value})
_MILTENYI_ROLES = frozenset({Role.HR_MILTENYI.value, Role.PM.value, Role.EMPLOYEE.value})
_HEALTHARK_DOMAIN = "healthark.ai"
_MILTENYI_DOMAINS = ("miltenyi.com", "external.miltenyi.com")


# ── Employee Code Convention ──────────────────────────────────────────
#
# Auto-generated convention: `<ORG_PREFIX>-<ROLE_CODE>-<NNN>` where NNN
# is a 3-digit zero-padded sequence (e.g. `HRK-MNT-007`). The org side
# is derived from the role using the same mapping as the email-domain
# rules — HR_MyOrg + Mentor are Healthark-side, the others are
# Miltenyi-side. The HR role-code is shared between HR_MyOrg + HR_Miltenyi
# (the org prefix already disambiguates them).
#
# Existing seed codes don't follow this convention (HRK-001, MIL-PM-01,
# STF-001 etc.) — they're grandfathered, and the sequence computation
# only matches codes against the new prefix shape, so old codes never
# influence the next-number calculation.
_ORG_PREFIX_HEALTHARK = "HRK"
_ORG_PREFIX_MILTENYI = "MIL"

_ROLE_TO_ORG_PREFIX: dict[str, str] = {
    Role.HR_MYORG.value: _ORG_PREFIX_HEALTHARK,
    Role.MENTOR.value: _ORG_PREFIX_HEALTHARK,
    Role.HR_MILTENYI.value: _ORG_PREFIX_MILTENYI,
    Role.PM.value: _ORG_PREFIX_MILTENYI,
    Role.EMPLOYEE.value: _ORG_PREFIX_MILTENYI,
}

_ROLE_TO_ROLE_CODE: dict[str, str] = {
    Role.HR_MYORG.value: "HR",
    Role.HR_MILTENYI.value: "HR",
    Role.MENTOR.value: "MNT",
    Role.PM.value: "PM",
    Role.EMPLOYEE.value: "EMP",
}

_EMPLOYEE_CODE_SEQ_PATTERN = re.compile(r"^(\d+)$")


def _employee_code_prefix(role: str) -> str:
    """Return the `<ORG>-<ROLE>-` portion of an auto-generated code
    for `role` (trailing dash included so callers can concatenate the
    sequence directly). KeyError on unknown role — callers should
    validate `role` against the Role enum first."""
    return f"{_ROLE_TO_ORG_PREFIX[role]}-{_ROLE_TO_ROLE_CODE[role]}-"


def _compute_next_employee_code(db: DbSession, org_id: int, role: str) -> str:
    """Compute the next available employee_code for (org_id, role).

    Walks every existing user row matching the role's prefix shape
    (active + soft-deleted — codes are never recycled even after a
    user is deactivated). Parses the trailing zero-padded sequence,
    takes MAX, returns prefix + (MAX+1) zero-padded to 3 digits. If
    the next number exceeds 999 the sequence naturally grows to 4
    digits (fail-loud rather than wrap).

    Pure compute — does not insert anything. The route layer holds
    the actual create transaction. If two concurrent creates derive
    the same code, the (org_id, employee_code) unique index catches
    the collision and the caller can re-derive once.
    """
    prefix = _employee_code_prefix(role)
    rows = (
        db.query(User.employee_code)
        .filter(
            User.org_id == org_id,
            User.employee_code.like(f"{prefix}%"),
        )
        .all()
    )
    max_seq = 0
    for (code,) in rows:
        suffix = code[len(prefix):]
        m = _EMPLOYEE_CODE_SEQ_PATTERN.match(suffix)
        if m:
            seq = int(m.group(1))
            if seq > max_seq:
                max_seq = seq
    next_seq = max_seq + 1
    # 3-digit zero-pad through 999; let it grow to 4+ digits past that
    # rather than silently wrapping.
    width = max(3, len(str(next_seq)))
    return f"{prefix}{next_seq:0{width}d}"


def _validate_email_for_role(email: str, role: str) -> None:
    """Raise 400 unless the email's domain is allowed for this role.

    Domain match is case-insensitive (per RFC 5321 the domain part is
    case-insensitive even though the local part technically isn't — but
    HR-typed emails are not the place to be pedantic about case).
    """
    if "@" not in email:
        # Pydantic's EmailStr should have caught this already; defence in depth.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email must contain '@'.",
        )
    domain = email.rsplit("@", 1)[1].lower()
    if role in _HEALTHARK_ROLES:
        if domain != _HEALTHARK_DOMAIN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"{role} accounts must use a @{_HEALTHARK_DOMAIN} email address."
                ),
            )
    elif role in _MILTENYI_ROLES:
        if domain not in _MILTENYI_DOMAINS:
            allowed = " or ".join(f"@{d}" for d in _MILTENYI_DOMAINS)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{role} accounts must use {allowed} email addresses.",
            )
    # Unknown roles fall through silently — the role guard upstream will
    # have rejected anything not in the enum before we get here.


def _validate_name_chars(name: str) -> None:
    """Raise 400 if the name contains anything other than letters,
    whitespace, or a full stop.

    Uses `str.isalpha()` so non-Latin scripts (Müller, Bäcker, श्रुति)
    work — Python's str.isalpha is Unicode-aware. Digits, hyphens,
    apostrophes, and every other punctuation/symbol are rejected.
    """
    for ch in name:
        if ch.isspace() or ch == ".":
            continue
        if not ch.isalpha():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Name can only contain letters, spaces, and full stops."
                ),
            )


def _normalize_full_name(name: str) -> str:
    """Title-case each whitespace-separated word; collapse internal
    whitespace; trim ends.

    Examples:
        "zAAhid vOHra"           -> "Zaahid Vohra"
        "zAAhid fIrOz vOHra"     -> "Zaahid Firoz Vohra"
        "  jane   smith  "       -> "Jane Smith"

    A bare full stop ("Dr." / "K.") stays as-is — `.capitalize()` on a
    single non-alpha char is a no-op. Multi-segment tokens like "k.r."
    become "K.r." which is acceptable for our org's naming conventions;
    we don't try to be cleverer than that.
    """
    parts = [p for p in name.split() if p]
    return " ".join(p[:1].upper() + p[1:].lower() for p in parts)


# =====================================================================
# USER MANAGEMENT
# =====================================================================

@router.get("/users", response_model=List[UserResponse])
def list_users(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return every user in the organization (including deactivated ones).

    Uses joinedload to eagerly fetch function + designation in ONE query,
    avoiding the N+1 problem when the table renders 50+ rows. The PM
    names for each Employee row are stitched in via a single batched query
    below — also N+1-safe.
    """
    _require_hr_any(current_user)

    users = (
        db.query(User)
        .options(
            joinedload(User.function),
            joinedload(User.designation),
        )
        .filter(User.org_id == current_user.org_id)
        .order_by(User.created_at.desc())
        .all()
    )

    # Resolve each user's active project managers in one batched query.
    # An "active" assignment is one where end_date IS NULL. Joins:
    #   ProjectAssignment → Project (to find pm_id)
    #   Project → User (to get the PM's full_name)
    # Soft-deleted PMs and projects are excluded. Distinct() here makes
    # the SQL emit DISTINCT so we don't double-count when an Employee has
    # multiple active rows under the same project.
    pm_rows = (
        db.query(ProjectAssignment.user_id, User.full_name)
        .join(Project, Project.id == ProjectAssignment.project_id)
        .join(User, User.id == Project.pm_id)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.end_date.is_(None),
            Project.is_deleted.is_(False),
            User.is_deleted == False,  # noqa: E712
        )
        .distinct()
        .all()
    )
    pm_names_by_user: dict[int, set[str]] = {}
    for user_id, pm_name in pm_rows:
        pm_names_by_user.setdefault(user_id, set()).add(pm_name)

    # Pydantic builds UserResponse instances directly from the SQLAlchemy
    # models via `from_attributes`; we need to surface the computed PM
    # list on each row before serialisation. Setting it as a plain
    # attribute on the ORM instance is the lightest path — Pydantic's
    # `model_validate` picks it up the same way as the joined columns.
    for u in users:
        names = sorted(pm_names_by_user.get(u.id, set()))
        # Attach as a transient attribute; the model doesn't have a
        # column for it. SQLAlchemy doesn't try to persist this.
        u.project_manager_names = names  # type: ignore[attr-defined]

    return users


# ── Paginated user listing ──────────────────────────────────────────────
# `_USERS_SORT_COLUMNS` and `_USERS_NO_MENTOR_SENTINEL` are module-level
# constants used by the paginated endpoint below. Kept here so the
# wire-contract is defined alongside the route that consumes it.
#
# Sort map mirrors the frontend's `UsersSortKey` for the columns the
# server can sort directly (User-attribute + joined reference-table
# columns). `mentor_name` and `project_manager_names` involve correlated
# subqueries / set aggregations — those columns stay rendered as plain
# (non-sortable) headers; same deferral the goal_routes `/all` endpoint
# uses for `latest_fy_year` / `latest_manager_name`.
_USERS_SORT_COLUMNS = {
    "full_name":        User.full_name,
    "email":            User.email,
    "role":             User.role,
    "created_at":       User.created_at,
    "function_name":    Function.name,
    "designation_name": Designation.name,
}

# Mirrors the frontend's `NO_MENTOR_SENTINEL` in UsersTab.tsx. The wire
# value is the literal display label `(No mentor)` — guaranteed not to
# collide with any real full_name (parens + leading space). When the
# `mentor_name` filter equals this sentinel, the WHERE clause flips from
# `mentor.full_name == X` to `User.mentor_id IS NULL`.
_USERS_NO_MENTOR_SENTINEL = "(No mentor)"


@router.get("/users/paginated", response_model=Paginated[UserResponse])
def list_users_paginated(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description=(
            "Maximum users to return on this page. Server-clamped to "
            "1..200 (matches the cap on every other paginated endpoint)."
        ),
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Users to skip before this page. 0 for the first page.",
    ),
    # ── Filter dimensions ───────────────────────────────────────────────
    # All optional. Match the toolbar surface in `UsersTab.tsx` 1-to-1 so
    # the user's filter selections round-trip server-side without the
    # per-page client-side narrowing the unpaginated endpoint used to do.
    search: Optional[str] = Query(
        None,
        description=(
            "Case-insensitive substring across full_name + email + "
            "employee_code. Empty string is treated as no filter."
        ),
    ),
    role: Optional[str] = Query(
        None,
        description=(
            "Exact match on Role enum value (HR_MyOrg / HR_Miltenyi / "
            "Mentor / PM / Employee). The value 'all' is treated as no "
            "filter for back-compat with the legacy client-side sentinel."
        ),
    ),
    status_: Optional[str] = Query(
        None,
        alias="status",
        description=(
            "'active' returns rows with is_deleted=False; 'inactive' "
            "returns is_deleted=True; 'all' (or omitted) returns both."
        ),
    ),
    function_name: Optional[str] = Query(
        None,
        description="Exact match on the user's Function name.",
    ),
    designation_name: Optional[str] = Query(
        None,
        description="Exact match on the user's Designation name.",
    ),
    mentor_name: Optional[str] = Query(
        None,
        description=(
            "Exact match on the resolved mentor's full_name. The "
            "special value `(No mentor)` matches rows whose mentor_id "
            "is NULL — same sentinel the frontend's mentor filter "
            "dropdown uses."
        ),
    ),
    pm_name: Optional[str] = Query(
        None,
        description=(
            "Exact match: row passes when at least one active "
            "ProjectAssignment ties the user to a Project whose PM "
            "has the supplied full_name. Active means the assignment's "
            "end_date IS NULL — same definition used by the "
            "project_manager_names column."
        ),
    ),
    sort_by: Optional[
        Literal[
            "full_name", "email", "role", "created_at",
            "function_name", "designation_name",
        ]
    ] = Query(
        None,
        description=(
            "Sort column. Direct user-attribute + reference-table "
            "columns only; mentor_name and project_manager_names sorts "
            "are deferred (would need correlated subqueries)."
        ),
    ),
    sort_dir: Literal["asc", "desc"] = Query(
        "asc",
        description="Sort direction. Default 'asc'.",
    ),
):
    """HR-only paginated user listing — companion endpoint to the
    unpaginated `GET /admin/users` above.

    The unpaginated endpoint is preserved unchanged for callers that
    need the full org roster (dropdown-option hooks: `useOrgUsers`,
    `useOrgProjectNames`-adjacent code, `ExportsTab` employee picker,
    `ProjectModal` PM / member pickers). This new endpoint serves
    `UsersTab`'s row query, which needs proper server-side pagination +
    server-side filtering + server-side sort once we move past tiny
    seed orgs.

    Two-query pattern (same as `goal_routes.list_all_goals`):
      1. Apply filters + sort to a User query.
      2. `total` = `.count()` over the filtered query.
      3. Page slice = `.offset().limit().all()` over the same query.
      4. Resolve project-manager names for the page slice only (single
         batched JOIN, scoped to the returned user_ids).

    Soft-deleted users are NOT excluded — UsersTab needs them to render
    the "Status" column's "Deactivated" badge. The `status` filter is
    the user-facing knob for that. If `status` isn't passed, deleted
    rows are returned alongside live ones (matching the unpaginated
    endpoint's behaviour).
    """
    _require_hr_any(current_user)

    # ── Base query + filters ────────────────────────────────────────────
    users_q = db.query(User).filter(User.org_id == current_user.org_id)

    # Status filter applies first — most rows fall out here cheaply.
    if status_ and status_ != "all":
        if status_ == "active":
            users_q = users_q.filter(User.is_deleted == False)  # noqa: E712
        elif status_ == "inactive":
            users_q = users_q.filter(User.is_deleted == True)  # noqa: E712
        # Any other value is silently treated as "all" — matches the
        # legacy client-side default and avoids a noisy 400 on the
        # transitional `?status=` values the URL writer used to emit.

    if role and role != "all":
        users_q = users_q.filter(User.role == role)

    if search:
        like = f"%{search.strip()}%"
        users_q = users_q.filter(
            or_(
                User.full_name.ilike(like),
                User.email.ilike(like),
                User.employee_code.ilike(like),
            )
        )

    # Conditional joins — same compose-with-sort pattern from
    # `goal_routes.list_all_goals` (doc 30 Part 3). Compute "needs join"
    # from filter ∪ sort so sort can require a join the filter doesn't.
    needs_function_join = bool(function_name) or sort_by == "function_name"
    needs_designation_join = bool(designation_name) or sort_by == "designation_name"

    if needs_function_join:
        users_q = users_q.join(Function, Function.id == User.function_id)
        if function_name:
            users_q = users_q.filter(Function.name == function_name)
    if needs_designation_join:
        users_q = users_q.join(Designation, Designation.id == User.designation_id)
        if designation_name:
            users_q = users_q.filter(Designation.name == designation_name)

    if mentor_name:
        if mentor_name == _USERS_NO_MENTOR_SENTINEL:
            users_q = users_q.filter(User.mentor_id.is_(None))
        else:
            # Aliased join so the WHERE clause can reference the mentor's
            # full_name without colliding with the outer User select.
            MentorAlias = aliased(User)
            users_q = users_q.join(
                MentorAlias, MentorAlias.id == User.mentor_id,
            ).filter(MentorAlias.full_name == mentor_name)

    if pm_name:
        # The user passes the `pm_name` filter when an active assignment
        # ties them to a project whose PM has the given name. EXISTS
        # subquery keeps the join from multiplying user rows by
        # assignment count. Active = end_date IS NULL.
        PMUserAlias = aliased(User)
        pm_exists = (
            db.query(ProjectAssignment.id)
            .join(Project, Project.id == ProjectAssignment.project_id)
            .join(PMUserAlias, PMUserAlias.id == Project.pm_id)
            .filter(
                ProjectAssignment.user_id == User.id,
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.end_date.is_(None),
                Project.is_deleted.is_(False),
                PMUserAlias.full_name == pm_name,
                PMUserAlias.is_deleted == False,  # noqa: E712
            )
            .exists()
        )
        users_q = users_q.filter(pm_exists)

    # ── Sort ────────────────────────────────────────────────────────────
    if sort_by is None:
        # Default: created_at desc — preserves the unpaginated
        # endpoint's existing implicit ordering so a side-by-side
        # comparison reads identically.
        users_q = users_q.order_by(User.created_at.desc(), User.id.asc())
    else:
        sort_column = _USERS_SORT_COLUMNS[sort_by]
        primary = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        users_q = users_q.order_by(primary, User.id.asc())

    # ── Step 2: count for `total`. Single COUNT(*) over the filtered
    # query, before offset/limit. Use `with_entities(User.id)` to keep
    # the SELECT light — the planner still pushes the same filter set.
    total_users = users_q.with_entities(User.id).count()

    # ── Step 3: page slice with eager-loads. joinedload pulls Function
    # + Designation in the same query so the response build is N+1-safe.
    page_users = (
        users_q.options(
            joinedload(User.function),
            joinedload(User.designation),
        )
        .offset(offset)
        .limit(limit)
        .all()
    )

    # ── Step 4: attach project_manager_names for the page slice only —
    # the unpaginated endpoint resolves this for the whole org; we
    # restrict to the returned user_ids so the join cost scales with
    # the page size, not the org size.
    page_user_ids = [u.id for u in page_users]
    if page_user_ids:
        pm_rows = (
            db.query(ProjectAssignment.user_id, User.full_name)
            .join(Project, Project.id == ProjectAssignment.project_id)
            .join(User, User.id == Project.pm_id)
            .filter(
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.user_id.in_(page_user_ids),
                ProjectAssignment.end_date.is_(None),
                Project.is_deleted.is_(False),
                User.is_deleted == False,  # noqa: E712
            )
            .distinct()
            .all()
        )
        pm_names_by_user: dict[int, set[str]] = {}
        for user_id, full_name in pm_rows:
            pm_names_by_user.setdefault(user_id, set()).add(full_name)
        for u in page_users:
            u.project_manager_names = sorted(  # type: ignore[attr-defined]
                pm_names_by_user.get(u.id, set())
            )
    else:
        # No users on this page — still set the transient attribute so
        # Pydantic doesn't complain about missing fields when items=[].
        for u in page_users:
            u.project_manager_names = []  # type: ignore[attr-defined]

    return Paginated[UserResponse](
        items=page_users,
        total=total_users,
        limit=limit,
        offset=offset,
        has_more=(offset + len(page_users)) < total_users,
    )


@router.get("/users/next-employee-code")
def get_next_employee_code(
    role: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """Preview the next employee_code that POST /users would assign
    for a given role. Used by the Create User modal to populate the
    (read-only) code field as the HR picks the role.

    Re-derived at create time as the source of truth — this preview
    is purely a UX affordance, NOT a reservation. If two HRs preview
    simultaneously they'll see the same suggested code; the first to
    save wins and the second gets a code +1 with a frontend toast.

    Auth mirrors the create endpoint:
      - Both HR roles can preview.
      - HR_Miltenyi can't preview a code for a protected role
        (Mentor / HR_MyOrg) since `_authorize_user_mutation` would
        block them from creating one anyway.
    """
    _require_hr_any(current_user)
    if role not in _ROLE_TO_ORG_PREFIX:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown role '{role}'.",
        )
    _authorize_user_mutation(current_user, role)
    return {"code": _compute_next_employee_code(db, current_user.org_id, role)}


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Create a new user in the organization.

    The email is checked for uniqueness within the org (not globally)
    because the composite index ix_users_org_email enforces this.

    On success, a welcome email containing the email + plaintext password
    is queued for delivery (best-effort via BackgroundTasks). Failed
    delivery does NOT roll back the creation — the user row is already
    persisted and the admin can relay the credentials manually.
    """
    _require_hr_any(current_user)
    _authorize_user_mutation(current_user, user_in.role)

    # Identity-field rules: validate before any DB lookup so a malformed
    # payload returns 400 cheaply instead of touching the duplicate-check
    # indexes. The Role enum docstring + helpers above are the single
    # source of truth for what's allowed.
    _validate_name_chars(user_in.full_name)
    normalized_full_name = _normalize_full_name(user_in.full_name)
    _validate_email_for_role(user_in.email, user_in.role)

    # Check for duplicate email within this org
    existing = db.query(User).filter(
        User.org_id == current_user.org_id,
        User.email == user_in.email,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A user with email '{user_in.email}' already exists in this organization.",
        )

    # Employee code is server-derived from the role per the convention
    # in `_compute_next_employee_code` (see also `_employee_code_prefix`).
    # Any value the client sent in `user_in.employee_code` is ignored —
    # the UserCreate schema keeps the field for backwards-compatibility
    # but we treat it as advisory only. The frontend now shows the
    # auto-generated value in a read-only input via the preview endpoint.
    derived_code = _compute_next_employee_code(
        db, current_user.org_id, user_in.role
    )

    # Defensive duplicate-check in case a concurrent create just took
    # the same number (preview is not a reservation). Both end up
    # deriving the same MAX+1; the unique index on
    # (org_id, employee_code) would catch the collision at flush time
    # anyway, but a friendlier 409 here keeps the error surface
    # predictable. The frontend's drift-toast covers the rare case
    # where this races; on a clean run the duplicate check is a no-op.
    existing_code = db.query(User).filter(
        User.org_id == current_user.org_id,
        User.employee_code == derived_code,
    ).first()
    if existing_code:
        # Race: another create won. Re-derive and try once more.
        derived_code = _compute_next_employee_code(
            db, current_user.org_id, user_in.role
        )

    # Validate mentor_id points at a real Mentor-role user in this org.
    # Cheap query but runs late so cheaper 400/409s fail first.
    _validate_mentor_role(db, current_user.org_id, user_in.mentor_id)

    new_user = User(
        org_id=current_user.org_id,  # Forced from JWT — never trusted from body
        employee_code=derived_code,
        full_name=normalized_full_name,
        email=user_in.email,
        phone=user_in.phone,
        role=user_in.role,
        function_id=user_in.function_id,
        designation_id=user_in.designation_id,
        mentor_id=user_in.mentor_id,
        password_hash=get_password_hash(user_in.password),
        # Initial `password_changed_at` value is the row's birth time.
        # Required so the user's first JWT (when they log in with the
        # admin-issued temp password) carries a non-zero `pwd_iat` claim
        # and passes the revocation check in resolve_authenticated_user.
        password_changed_at=datetime.now(timezone.utc),
        # Force a password change on first login. The admin chose the
        # initial password and emailed it to the user; ProtectedRoute
        # routes the user to /change-password until they pick their own.
        must_change_password=True,
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Send the welcome email after the row is committed so a delivery
    # failure can't prevent account creation. The plaintext password is
    # only available here (we hashed it before storage); after this
    # function returns, no other code path can reconstruct it.
    if is_smtp_configured():
        login_url = f"{settings.APP_BASE_URL.rstrip('/')}/login"
        background_tasks.add_task(
            send_welcome_user_email,
            to_email=new_user.email,
            full_name=new_user.full_name,
            password=user_in.password,
            login_url=login_url,
            org_id=new_user.org_id,
        )

    # Seed an in-app notification so the bell isn't empty on first login.
    # Email is intentionally NOT sent here — the welcome email above
    # already covers that channel and duplicate inbox pings are noise.
    notify(
        db,
        org_id=new_user.org_id,
        recipient_id=new_user.id,
        sender_id=current_user.id,
        module="admin",
        entity_type="user",
        entity_id=new_user.id,
        message="Welcome to PMS — your account is ready.",
        entity_url="/dashboard",
    )
    db.commit()

    # Eagerly load relationships for the response
    return _load_user_with_relations(db, new_user.id)


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_in: UserUpdate,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Update a user's details (name, role, function, mentor, etc.).

    Email is intentionally NOT updatable — the frontend makes the field
    read-only during edit mode to prevent orphaned JWT tokens.
    """
    _require_hr_any(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    # Security boundary: HR_Miltenyi can't edit a Mentor or HR_MyOrg row
    # (block based on the existing role) and can't promote anyone TO a
    # protected role (block based on the incoming role, if changing).
    _authorize_user_mutation(current_user, user.role)
    if user_in.role and user_in.role != user.role:
        _authorize_user_mutation(current_user, user_in.role)

    # HR_Miltenyi can only edit Function and Designation on existing
    # rows. Identity fields (employee_code, full_name), system role,
    # phone, and mentor assignment all belong to Healthark HR. We
    # compare incoming values to stored ones so a no-op payload (same
    # value resubmitted) still passes — only real changes raise 403.
    # The new-user creation path is untouched: HR_Miltenyi may still
    # provision an Employee/PM/HR_Miltenyi row with full field control.
    update_data = user_in.model_dump(exclude_unset=True)
    if current_user.role == Role.HR_MILTENYI.value:
        HR_MILTENYI_EDITABLE_FIELDS = {"function_id", "designation_id"}
        for field, incoming in update_data.items():
            if field in HR_MILTENYI_EDITABLE_FIELDS:
                continue
            if incoming != getattr(user, field):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Miltenyi HR can only change Function and "
                        "Designation. Ask Healthark HR to update "
                        "other fields."
                    ),
                )

    if "employee_code" in update_data and update_data["employee_code"] != user.employee_code:
        existing_code = db.query(User).filter(
            User.org_id == current_user.org_id,
            User.employee_code == update_data["employee_code"],
            User.id != user_id,
        ).first()

        if existing_code:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Employee code '{update_data['employee_code']}' is already in use.",
            )

    # Identity-field rules on update:
    #   - If full_name is in the payload, validate chars and normalize
    #     casing in place so the persisted row + the response both reflect
    #     the canonical form.
    #   - Email isn't editable (see docstring), but role IS — when role
    #     changes we re-validate the *existing* email against the new role
    #     so HR can't sidestep the domain rule by flipping the role of an
    #     already-created account (e.g. promote an @miltenyi.com Employee
    #     to Mentor, which requires @healthark.ai).
    if "full_name" in update_data and update_data["full_name"] is not None:
        _validate_name_chars(update_data["full_name"])
        update_data["full_name"] = _normalize_full_name(update_data["full_name"])
    if "role" in update_data and update_data["role"] and update_data["role"] != user.role:
        _validate_email_for_role(user.email, update_data["role"])

    # Snapshot the old mentor_id BEFORE applying the update so we can
    # detect a true mentor reassignment after commit. A PATCH that
    # resubmits the same mentor_id is a no-op and shouldn't notify.
    old_mentor_id = user.mentor_id

    # If the PATCH is changing mentor_id to something non-null, validate
    # the target has role=Mentor. Skip the check when mentor_id is
    # being cleared or wasn't in the payload at all (already a no-op).
    if "mentor_id" in update_data and update_data["mentor_id"] is not None:
        _validate_mentor_role(db, current_user.org_id, update_data["mentor_id"])

    # Role-change-away-from-Mentor cascade: if this PATCH is taking a
    # Mentor and giving them a different role, every active mentee of
    # theirs needs to be orphaned (mentor_id nulled, in-flight rows
    # un-stamped, HR notified). Same semantics as deactivation — see
    # docs/policies/mentor-transition-policy.md (Part D). Run BEFORE
    # the setattr loop so the cascade queries see the user's old role
    # = Mentor; after the role flips applies, the mentee lookup would
    # still work (mentor_id is a plain FK) but the conceptual frame is
    # "their previous Mentor lost the ability."
    is_role_demotion = (
        "role" in update_data
        and update_data["role"]
        and update_data["role"] != user.role
        and user.role == Role.MENTOR.value
    )
    if is_role_demotion:
        _orphan_mentees(
            db,
            admin=current_user,
            departing_mentor=user,
            reason="role_change",
        )

    # Role-change-away-from-PM cascade: parallel to the Mentor branch
    # above. Without this, a user demoted from PM to Employee keeps
    # appearing as the PM on every project they ran (Project.pm_id
    # still points at them) but their PM-role permissions are gone, so
    # in-flight ProjectReviews freeze and HR has no signal that the
    # projects need a new PM. Run BEFORE the setattr loop so the
    # cascade sees `user.role` as PM.
    is_pm_role_demotion = (
        "role" in update_data
        and update_data["role"]
        and update_data["role"] != user.role
        and user.role == Role.PM.value
    )
    if is_pm_role_demotion:
        _orphan_pm_projects(
            db,
            admin=current_user,
            departing_pm=user,
            reason="role_change",
        )

    for field, value in update_data.items():
        setattr(user, field, value)

    # Mentor reassignment cascade: move in-flight stamped refs on Goal
    # + AnnualReview rows from the old mentor to the new mentor (or
    # NULL on unassign). See policy doc Part B + E for the full rule.
    # Skip when mentor_id wasn't in the payload or was a no-op resave.
    if "mentor_id" in update_data and user.mentor_id != old_mentor_id:
        _cascade_mentor_reassignment(
            db,
            admin=current_user,
            mentee=user,
            old_mentor_id=old_mentor_id,
            new_mentor_id=user.mentor_id,
            reason="reassignment",
        )
        # Re-mentoring an orphan clears the orphan stamp. Only clear
        # when the new mentor is a real user — NULL→NULL or X→NULL
        # shouldn't change the orphan state (NULL→NULL is a no-op
        # anyway; X→NULL is HR explicitly unassigning, which is NOT
        # an "orphan resolved" event).
        if user.mentor_id is not None:
            user.mentor_orphaned_at = None
        # The user-level move is logged separately from the per-row
        # cascade entries above so per-mentee history queries can
        # filter on entity_type="user" to find pointer changes.
        _log_mentor_move(
            db,
            org_id=user.org_id,
            admin_user_id=current_user.id,
            employee_user_id=user.id,
            entity_type="user",
            entity_id=user.id,
            old_mentor_id=old_mentor_id,
            new_mentor_id=user.mentor_id,
            reason="reassignment",
        )

    db.commit()

    # Mentor reassignment notifications. We notify on any of:
    #   - mentor assigned for the first time   (None → X)
    #   - mentor reassigned                    (X → Y)
    #   - mentor unassigned                    (X → None)
    # Three audiences:
    #   - the OLD mentor learns the mentee is off their roster
    #     (only when there WAS an old mentor — None → X has no old
    #     mentor to notify),
    #   - the NEW mentor learns a mentee was assigned to them
    #     (only when there IS a new mentor — X → None has nobody to
    #     tell),
    #   - the mentee is told who their mentor is now (or that they
    #     have none).
    #
    # Deactivation / role-change orphaning paths go through
    # `_orphan_mentees` instead and don't reach this block — they handle
    # their own fan-out (mentees + HR). The departing mentor isn't
    # notified there because they can't log in (deactivation) or the
    # framing is "your role is gone" rather than per-mentee.
    new_mentor_id = user.mentor_id
    if "mentor_id" in update_data and new_mentor_id != old_mentor_id:
        if old_mentor_id is not None:
            old_mentor = db.query(User).filter(
                User.id == old_mentor_id
            ).first()
            if old_mentor and not old_mentor.is_deleted:
                notify(
                    db,
                    org_id=current_user.org_id,
                    recipient_id=old_mentor.id,
                    sender_id=current_user.id,
                    module="admin",
                    entity_type="user",
                    entity_id=user.id,
                    message=f"{user.full_name} is no longer your mentee.",
                    entity_url="/mentees",
                    background_tasks=background_tasks,
                    send_email=True,
                    email_subject="Mentee removed from your roster",
                )

        if new_mentor_id is not None:
            new_mentor = db.query(User).filter(User.id == new_mentor_id).first()
            if new_mentor:
                notify(
                    db,
                    org_id=current_user.org_id,
                    recipient_id=new_mentor.id,
                    sender_id=current_user.id,
                    module="admin",
                    entity_type="user",
                    entity_id=user.id,
                    message=f"{user.full_name} was assigned to you as a mentee.",
                    entity_url="/mentees",
                    background_tasks=background_tasks,
                    send_email=True,
                    email_subject="New mentee assigned to you",
                )
            mentee_msg = (
                f"Your mentor was updated to {new_mentor.full_name}."
                if new_mentor else "Your mentor was updated."
            )
        else:
            mentee_msg = "Your mentor was unassigned. Contact HR if this is unexpected."

        notify(
            db,
            org_id=current_user.org_id,
            recipient_id=user.id,
            sender_id=current_user.id,
            module="admin",
            entity_type="user",
            entity_id=user.id,
            message=mentee_msg,
            entity_url="/profile",
            background_tasks=background_tasks,
            send_email=True,
            email_subject="Your mentor was updated",
        )
        db.commit()

    # Return with eagerly loaded relationships
    return _load_user_with_relations(db, user.id)


@router.post("/users/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user(
    user_id: int,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Reverse a soft-delete (set is_deleted = False).

    The user's historical password, mentor assignment, reviews, and goals
    are preserved — reactivation just flips the access flag. They can log
    in with their old password immediately. If admin wants a clean slate,
    they should follow up with a password reset.
    """
    _require_hr_any(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    _authorize_user_mutation(current_user, user.role)

    if not user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This user is already active.",
        )

    user.is_deleted = False
    # Clear the deactivation timestamp so any future FY-scoped export
    # treats this user as continuously active from `created_at` to now.
    user.deleted_at = None
    db.commit()

    notify(
        db,
        org_id=current_user.org_id,
        recipient_id=user.id,
        sender_id=current_user.id,
        module="admin",
        entity_type="user",
        entity_id=user.id,
        message="Your account has been reactivated. You can sign in again.",
        entity_url="/dashboard",
        background_tasks=background_tasks,
        send_email=True,
        email_subject="Your account has been reactivated",
    )
    db.commit()

    return _load_user_with_relations(db, user.id)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Soft-delete a user (set is_deleted = True).

    Hard deletes are NEVER used — this preserves audit trails and
    historical review/goal data. The user's JWT will still work until
    it expires, but the CurrentUser dependency checks is_deleted on
    every request, so they are blocked immediately.
    """
    _require_hr_any(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    _authorize_user_mutation(current_user, user.role)

    # Guard: Admin should not deactivate themselves
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account.",
        )

    user.is_deleted = True
    # Stamp the deactivation time so FY-scoped exports can decide
    # whether this user was around during the selected FY. The export
    # rule includes them in any FY that ends on/after `deleted_at`.
    user.deleted_at = datetime.now(timezone.utc)

    # ── Cascade live pointers that referenced this user ─────────────
    # Three axes, three cascades — all of them use the Option-C
    # semantics: in-flight work moves to NULL (so HR can reassign),
    # closed work preserves stamped attribution.
    #
    #   1. PM    → projects orphaned + in-flight ProjectReview.reviewer_id
    #              nulled; HR_MyOrg notified.
    #   2. Mentor→ mentees orphaned + in-flight goal/review stamped
    #              mentor nulled; HR_MyOrg notified.
    #   3. Secondary → in-flight ProjectReviewEvaluator drafts deleted
    #              (each row is uniquely owned; can't be transferred).
    #
    # The PM and Mentor branches gate on `user.role` because role
    # invariants on the FK fields are airtight (only role=PM can be a
    # Project.pm_id; only role=Mentor can be a User.mentor_id). The
    # secondary branch + Project.secondary_evaluator_id null run
    # unconditionally because the secondary can be any role except
    # PM/Mentor — gating would miss cases.

    if user.role == Role.PM.value:
        _orphan_pm_projects(
            db,
            admin=current_user,
            departing_pm=user,
            reason="deactivation",
        )
    elif user.role == Role.MENTOR.value:
        _orphan_mentees(
            db,
            admin=current_user,
            departing_mentor=user,
            reason="deactivation",
        )

    # Secondary evaluator cleanup runs for everyone — the secondary can
    # be any non-PM, non-Mentor user. Null the Project pointer + delete
    # in-flight draft impact statements they owned. Submitted impact
    # statements (status=SUBMITTED) are preserved as audit history.
    db.query(Project).filter(
        Project.org_id == current_user.org_id,
        Project.secondary_evaluator_id == user.id,
    ).update({"secondary_evaluator_id": None})
    _clear_secondary_drafts(db, departing_user=user)

    db.commit()

    return None  # 204 No Content — no body


# =====================================================================
# REFERENCE DATA (for dropdown menus)
# =====================================================================

@router.get("/functions", response_model=List[FunctionBrief])
def list_functions(
    db: DbSession,
    current_user: CurrentUser,
):
    """Return all active functions for the org (powers the <select> dropdown)."""
    _require_hr_any(current_user)

    def _query() -> List[FunctionBrief]:
        rows = (
            db.query(Function)
            .filter(
                Function.org_id == current_user.org_id,
                Function.is_active == True,  # noqa: E712
            )
            .order_by(Function.name)
            .all()
        )
        # Serialize to plain Pydantic models so the cache holds stable values
        # rather than ORM objects bound to a (now-closed) Session.
        return [FunctionBrief.model_validate(r, from_attributes=True) for r in rows]

    return functions_cache.get_or_compute(current_user.org_id, _query)


@router.get("/designations", response_model=List[DesignationBrief])
def list_designations(
    db: DbSession,
    current_user: CurrentUser,
):
    """Return all active designations for the org, sorted by hierarchy level."""
    _require_hr_any(current_user)

    def _query() -> List[DesignationBrief]:
        rows = (
            db.query(Designation)
            .filter(
                Designation.org_id == current_user.org_id,
                Designation.is_active == True,  # noqa: E712
            )
            .order_by(Designation.level)
            .all()
        )
        return [DesignationBrief.model_validate(r, from_attributes=True) for r in rows]

    return designations_cache.get_or_compute(current_user.org_id, _query)


# =====================================================================
# ADMIN SETTINGS (Simplified Active Cycle View)
# =====================================================================

@router.get("/settings", response_model=AdminSettingsResponse)
def get_admin_settings(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return the active cycle for the Admin Panel's SystemSettingsTab.

    This is a simplified view of the same SystemSettings table used by
    the /api/v1/settings/ endpoints. The frontend field name 'active_cycle'
    maps to the database column 'active_cycle_name'.
    """
    _require_hr_any(current_user)

    def _query() -> AdminSettingsResponse:
        row = db.query(SystemSettings).filter(
            SystemSettings.org_id == current_user.org_id,
        ).first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="System settings have not been configured.",
            )

        # active_cycle is computed on-the-fly so it never goes stale
        # between settings saves; resolve_today honours simulated_today.
        live_active_cycle = get_current_cycle_info(
            resolve_today(row),
            CycleType(row.cycle_type),
            row.fiscal_start_month,
        )
        live_fy = extract_fy_label(live_active_cycle)
        # Keep the cached cycle label in sync. The four access toggles
        # are no longer reset on rollover — they live on the per-FY
        # override table and HR configures each year independently.
        if row.active_cycle_name != live_active_cycle:
            row.active_cycle_name = live_active_cycle
            db.commit()
            invalidate_settings(current_user.org_id)
        # Lazy-create the current-FY override row, then read flags off
        # it so legacy consumers continue to see consistent values.
        override = ensure_year_override_row(
            db, current_user.org_id, live_fy, seed_from_settings=row,
        )
        return AdminSettingsResponse(
            id=row.id,
            org_id=row.org_id,
            active_cycle=live_active_cycle,
            cycle_type=row.cycle_type,
            fiscal_start_month=row.fiscal_start_month,
            timezone=row.timezone or "UTC",
            goals_edit_enabled=row.goals_edit_enabled,
            annual_goals_edit_enabled=override.annual_goals_edit_enabled,
            project_ratings_visible=override.project_ratings_visible,
            annual_reviews_enabled=override.annual_reviews_enabled,
            annual_review_final_rating_visible=override.annual_review_final_rating_visible,
            simulated_today=row.simulated_today,
            simulation_allowed=settings.ALLOW_DATE_SIMULATION,
            updated_at=row.updated_at,
        )

    # Bypass the admin_settings_cache because the live active_cycle
    # depends on today's date and a cached value would go stale.
    return _query()


@router.patch("/settings", response_model=AdminSettingsResponse)
def update_admin_settings(
    settings_in: AdminSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update cycle configuration and goal access controls from the Admin Panel.

    Cycle cadence and fiscal month are editable; active_cycle_name is
    recomputed automatically from those two values + today's date.
    """
    _require_hr_any(current_user)

    # Snapshot the env flag before the local `settings` variable shadows
    # the imported config-settings module.
    simulation_allowed = settings.ALLOW_DATE_SIMULATION

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()

    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    # simulated_today is gated behind ALLOW_DATE_SIMULATION env flag so
    # production deployments are safe from accidental cycle-time shifts.
    # Validate the gate before mutating anything.
    wants_simulation_write = (
        settings_in.simulated_today is not None
        or bool(settings_in.clear_simulated_today)
    )
    if wants_simulation_write and not simulation_allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Date simulation is disabled for this deployment. "
                "Set ALLOW_DATE_SIMULATION=true on the backend to enable."
            ),
        )

    # Apply cadence / fiscal / timezone / simulated_today changes —
    # these stay org-wide. The four access-control toggles below now
    # route to the per-FY override table.
    if settings_in.cycle_type is not None:
        settings_row.cycle_type = settings_in.cycle_type
    if settings_in.fiscal_start_month is not None:
        settings_row.fiscal_start_month = settings_in.fiscal_start_month
    if settings_in.timezone is not None:
        # Validate the IANA string here so the admin gets a 400 (rather
        # than the next cycle-determination call silently falling back
        # to UTC). cycle_utils' read-side fallback still catches DB-
        # legacy bad values gracefully.
        try:
            ZoneInfo(settings_in.timezone)
        except (ZoneInfoNotFoundError, Exception):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Unknown timezone '{settings_in.timezone}'. Use an "
                    "IANA name like 'Asia/Kolkata', 'Europe/Berlin', or 'UTC'."
                ),
            )
        settings_row.timezone = settings_in.timezone
    if settings_in.clear_simulated_today:
        settings_row.simulated_today = None
    elif settings_in.simulated_today is not None:
        settings_row.simulated_today = settings_in.simulated_today

    # Recompute the active cycle. We just update the cached label —
    # no auto-reset of flags (per-FY overrides are configured explicitly).
    fresh_cycle = get_current_cycle_info(
        resolve_today(settings_row),
        CycleType(settings_row.cycle_type),
        settings_row.fiscal_start_month,
    )
    settings_row.active_cycle_name = fresh_cycle
    fresh_fy = extract_fy_label(fresh_cycle)

    if settings_in.goals_edit_enabled is not None:
        settings_row.goals_edit_enabled = settings_in.goals_edit_enabled

    settings_row.updated_by_id = current_user.id

    # Route the four access toggles to the current-FY override row when
    # the legacy PATCH carries them. This keeps the existing Admin
    # Panel flow working until the UI fully migrates to the year-scoped
    # endpoints.
    override = ensure_year_override_row(
        db,
        current_user.org_id,
        fresh_fy,
        seed_from_settings=settings_row,
        updated_by_id=current_user.id,
    )
    legacy_year_writes = {
        "annual_goals_edit_enabled": settings_in.annual_goals_edit_enabled,
        "project_ratings_visible": settings_in.project_ratings_visible,
        "annual_reviews_enabled": settings_in.annual_reviews_enabled,
        "annual_review_final_rating_visible": settings_in.annual_review_final_rating_visible,
    }
    touched_year_row = False
    for flag, value in legacy_year_writes.items():
        if value is not None:
            setattr(override, flag, bool(value))
            touched_year_row = True
    if touched_year_row:
        override.updated_by_id = current_user.id

    db.commit()
    db.refresh(settings_row)
    db.refresh(override)
    invalidate_settings(current_user.org_id)

    return AdminSettingsResponse(
        id=settings_row.id,
        org_id=settings_row.org_id,
        active_cycle=settings_row.active_cycle_name,
        cycle_type=settings_row.cycle_type,
        fiscal_start_month=settings_row.fiscal_start_month,
        timezone=settings_row.timezone or "UTC",
        goals_edit_enabled=settings_row.goals_edit_enabled,
        annual_goals_edit_enabled=override.annual_goals_edit_enabled,
        project_ratings_visible=override.project_ratings_visible,
        annual_reviews_enabled=override.annual_reviews_enabled,
        annual_review_final_rating_visible=override.annual_review_final_rating_visible,
        simulated_today=settings_row.simulated_today,
        simulation_allowed=simulation_allowed,
        updated_at=settings_row.updated_at,
    )


@router.get("/settings/preflight")
def settings_preflight(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return per-setting "in-flight" counts so the frontend can show an
    advisory confirmation before HR flips a toggle off mid-cycle. The
    response shape is:

        {
            "<setting_key>": {"in_flight_count": int, "warning": str | None},
            ...
        }

    Visibility-only flags always return count 0 — they don't lock anyone
    out, so there's nothing to warn about. The two action gates
    (`annual_goals_edit_enabled`, `annual_reviews_enabled`) compute real
    counts so the UI can name exactly who would be stranded.
    """
    _require_hr_any(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        # No settings = no in-flight work to worry about.
        return {
            "annual_goals_edit_enabled":          {"in_flight_count": 0, "warning": None},
            "annual_reviews_enabled":             {"in_flight_count": 0, "warning": None},
            "project_ratings_visible":            {"in_flight_count": 0, "warning": None},
            "annual_review_final_rating_visible": {"in_flight_count": 0, "warning": None},
        }

    active_cycle = get_current_cycle_info(
        resolve_today(settings_row),
        CycleType(settings_row.cycle_type),
        settings_row.fiscal_start_month,
    )
    active_fy = extract_fy_label(active_cycle)

    # ── annual_goals_edit_enabled ───────────────────────────────────
    # Count active Employees in this org with zero annual Goal rows for the
    # active FY. They're the users who would be locked out by flipping
    # this off mid-cycle.
    staff_ids_subq = (
        db.query(User.id)
        .filter(
            User.org_id == current_user.org_id,
            User.role == Role.EMPLOYEE.value,
            User.is_deleted == False,  # noqa: E712
        )
        .subquery()
    )
    goal_user_ids_subq = (
        db.query(Goal.user_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.cycle_name == active_fy,
        )
        .distinct()
        .subquery()
    )
    staff_without_goals = (
        db.query(sql_func.count(staff_ids_subq.c.id))
        .filter(staff_ids_subq.c.id.notin_(db.query(goal_user_ids_subq.c.user_id)))
        .scalar()
        or 0
    )

    # ── annual_reviews_enabled ──────────────────────────────────────
    # Two buckets, summed:
    #   1. Reviews already started but not yet past the mentor stage
    #      (draft / pending_mentor) — they can't progress while paused.
    #   2. Active Employees with no AnnualReview row for the active FY at
    #      all — they can't even create one while paused.
    in_flight_reviews = (
        db.query(sql_func.count(AnnualReview.id))
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == active_fy,
            AnnualReview.status.in_([
                ReviewStatus.DRAFT.value,
                ReviewStatus.PENDING_MENTOR.value,
            ]),
        )
        .scalar()
        or 0
    )
    review_user_ids_subq = (
        db.query(AnnualReview.user_id)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == active_fy,
        )
        .distinct()
        .subquery()
    )
    staff_without_reviews = (
        db.query(sql_func.count(staff_ids_subq.c.id))
        .filter(staff_ids_subq.c.id.notin_(db.query(review_user_ids_subq.c.user_id)))
        .scalar()
        or 0
    )
    review_in_flight = in_flight_reviews + staff_without_reviews

    def _msg(count: int, kind: str) -> str | None:
        if count <= 0:
            return None
        noun = "employee" if count == 1 else "employees"
        verb = "hasn't" if count == 1 else "haven't"
        if kind == "goals":
            return (
                f"{count} {noun} {verb} created annual goals for {active_fy} yet. "
                f"Disabling will block them from doing so until you re-enable."
            )
        return (
            f"{count} {noun} {verb} completed self-review/mentor evaluation for {active_fy}. "
            f"Disabling will block new submissions until you re-enable."
        )

    return {
        "annual_goals_edit_enabled": {
            "in_flight_count": staff_without_goals,
            "warning": _msg(staff_without_goals, "goals"),
        },
        "annual_reviews_enabled": {
            "in_flight_count": review_in_flight,
            "warning": _msg(review_in_flight, "reviews"),
        },
        # Visibility-only — flipping off doesn't lock anyone out, so no
        # preflight warning is needed.
        "project_ratings_visible":            {"in_flight_count": 0, "warning": None},
        "annual_review_final_rating_visible": {"in_flight_count": 0, "warning": None},
    }


# =====================================================================
# PER-FISCAL-YEAR ACCESS CONFIGURATION
# =====================================================================
#
# These endpoints back the Year dropdown in the Admin Panel's System
# Settings tab. The four toggles (annual_reviews_enabled,
# annual_review_final_rating_visible, annual_goals_edit_enabled,
# project_ratings_visible) are configured per FY rather than as
# org-wide singletons — so HR can re-open FY26-27 review submissions
# while FY27-28 is the system-computed active cycle.

def _current_fy_label(settings_row: SystemSettings) -> str:
    """Compute the active FY label from a settings row (honours
    simulated_today)."""
    active_cycle = get_current_cycle_info(
        resolve_today(settings_row),
        CycleType(settings_row.cycle_type),
        settings_row.fiscal_start_month,
    )
    return extract_fy_label(active_cycle)


def _build_year_settings_response(
    row: SystemSettingsYearOverride,
    current_fy: str,
) -> YearSettingsResponse:
    return YearSettingsResponse(
        fy_label=row.fy_label,
        annual_reviews_enabled=row.annual_reviews_enabled,
        annual_review_final_rating_visible=row.annual_review_final_rating_visible,
        annual_goals_edit_enabled=row.annual_goals_edit_enabled,
        project_ratings_visible=row.project_ratings_visible,
        is_current=(row.fy_label == current_fy),
        updated_at=row.updated_at,
    )


@router.get("/settings/years", response_model=YearOptionsResponse)
def list_settings_years(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return selectable years for the System Settings dropdown.

    Sources, unioned and de-duplicated:
        - the current FY plus the two prior and two upcoming FYs
        - every FY that appears on this org's annual reviews
        - every FY that appears on this org's annual goals
        - every FY that already has an override row

    `has_override` lets the UI distinguish "configured" vs "untouched"
    years; the toggles will reflect default-deny values on years that
    haven't been saved yet.
    """
    _require_hr_any(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    current_fy = _current_fy_label(settings_row)

    # Current FY ± 2 — gives HR a small forward / backward window without
    # cluttering the dropdown with decades. The UNION with FY labels
    # found on real data covers any straggler years outside that window.
    base_year = int(current_fy[2:4]) + 2000 if current_fy[2:4].isdigit() else None
    range_labels: set[str] = set()
    if base_year is not None:
        for delta in range(-2, 3):
            yr = base_year + delta
            range_labels.add(f"FY{yr % 100:02d}-{(yr + 1) % 100:02d}")

    review_labels = {
        row[0] for row in db.query(AnnualReview.cycle_name)
        .filter(AnnualReview.org_id == current_user.org_id)
        .distinct()
        .all()
        if row[0]
    }
    goal_labels = {
        row[0] for row in db.query(Goal.cycle_name)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
        )
        .distinct()
        .all()
        if row[0]
    }
    override_labels = {
        row[0] for row in db.query(SystemSettingsYearOverride.fy_label)
        .filter(SystemSettingsYearOverride.org_id == current_user.org_id)
        .all()
    }
    overrides_by_label = override_labels

    # AnnualReview.cycle_name and Goal.cycle_name are stored as bare FY
    # tokens (e.g. "FY26-27"), so we accept them verbatim. Defensive
    # extract_fy_label keeps any legacy "H1 FY26-27" rows in the same
    # canonical shape.
    all_labels: set[str] = set()
    all_labels.update(range_labels)
    for label in (*review_labels, *goal_labels):
        canonical = extract_fy_label(label)
        if canonical.upper().startswith("FY"):
            all_labels.add(canonical)
    all_labels.update(override_labels)

    # Sort descending so the most recent FY (typically the current one)
    # is at the top of the dropdown.
    def _sort_key(fy: str) -> int:
        # "FY26-27" → 2026; fallback 0 for malformed entries.
        head = fy[2:4]
        return 2000 + int(head) if head.isdigit() else 0

    years = sorted(all_labels, key=_sort_key, reverse=True)
    options = [
        YearOption(
            fy_label=fy,
            is_current=(fy == current_fy),
            has_override=(fy in overrides_by_label),
        )
        for fy in years
    ]
    return YearOptionsResponse(years=options)


@router.get("/settings/year/{fy_label}", response_model=YearSettingsResponse)
def get_year_settings(
    fy_label: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """Return the per-FY override row, lazy-creating from the latest
    existing override (or legacy SystemSettings flags) if missing."""
    _require_hr_any(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    canonical = extract_fy_label(fy_label)
    if not canonical.upper().startswith("FY"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{fy_label}' is not a valid fiscal-year label.",
        )

    row = ensure_year_override_row(
        db,
        current_user.org_id,
        canonical,
        seed_from_settings=settings_row,
    )
    return _build_year_settings_response(row, _current_fy_label(settings_row))


@router.patch("/settings/year/{fy_label}", response_model=YearSettingsResponse)
def update_year_settings(
    fy_label: str,
    payload: YearSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Update the four access toggles for a specific FY."""
    _require_hr_any(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    canonical = extract_fy_label(fy_label)
    if not canonical.upper().startswith("FY"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{fy_label}' is not a valid fiscal-year label.",
        )

    row = ensure_year_override_row(
        db,
        current_user.org_id,
        canonical,
        seed_from_settings=settings_row,
        updated_by_id=current_user.id,
    )
    for flag in YEAR_OVERRIDE_FLAGS:
        setattr(row, flag, bool(getattr(payload, flag)))
    row.updated_by_id = current_user.id
    db.commit()
    db.refresh(row)
    invalidate_settings(current_user.org_id)

    return _build_year_settings_response(row, _current_fy_label(settings_row))


@router.get(
    "/settings/year/{fy_label}/preflight",
    response_model=YearPreflightResponse,
)
def year_settings_preflight(
    fy_label: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Year-scoped variant of `/settings/preflight`. Counts users who would
    be stranded if the toggle flipped off, filtered to the requested FY.

    Visibility-only flags (project_ratings_visible,
    annual_review_final_rating_visible) always return 0 — flipping them
    off doesn't lock anyone out, it just hides numbers.
    """
    _require_hr_any(current_user)

    canonical = extract_fy_label(fy_label)
    if not canonical.upper().startswith("FY"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{fy_label}' is not a valid fiscal-year label.",
        )

    staff_ids_subq = (
        db.query(User.id)
        .filter(
            User.org_id == current_user.org_id,
            User.role == Role.EMPLOYEE.value,
            User.is_deleted == False,  # noqa: E712
        )
        .subquery()
    )

    # ── annual_goals_edit_enabled ───────────────────────────────────
    goal_user_ids_subq = (
        db.query(Goal.user_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.cycle_name == canonical,
        )
        .distinct()
        .subquery()
    )
    staff_without_goals = (
        db.query(sql_func.count(staff_ids_subq.c.id))
        .filter(staff_ids_subq.c.id.notin_(db.query(goal_user_ids_subq.c.user_id)))
        .scalar()
        or 0
    )

    # ── annual_reviews_enabled ──────────────────────────────────────
    in_flight_reviews = (
        db.query(sql_func.count(AnnualReview.id))
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == canonical,
            AnnualReview.status.in_([
                ReviewStatus.DRAFT.value,
                ReviewStatus.PENDING_MENTOR.value,
            ]),
        )
        .scalar()
        or 0
    )
    review_user_ids_subq = (
        db.query(AnnualReview.user_id)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == canonical,
        )
        .distinct()
        .subquery()
    )
    staff_without_reviews = (
        db.query(sql_func.count(staff_ids_subq.c.id))
        .filter(staff_ids_subq.c.id.notin_(db.query(review_user_ids_subq.c.user_id)))
        .scalar()
        or 0
    )
    review_in_flight = in_flight_reviews + staff_without_reviews

    def _msg(count: int, kind: str) -> str | None:
        if count <= 0:
            return None
        noun = "employee" if count == 1 else "employees"
        verb = "hasn't" if count == 1 else "haven't"
        if kind == "goals":
            return (
                f"{count} {noun} {verb} created annual goals for {canonical} yet. "
                f"Disabling will block them from doing so until you re-enable."
            )
        return (
            f"{count} {noun} {verb} completed self-review/mentor evaluation for {canonical}. "
            f"Disabling will block new submissions until you re-enable."
        )

    return YearPreflightResponse(
        fy_label=canonical,
        annual_goals_edit_enabled=YearPreflightEntry(
            in_flight_count=staff_without_goals,
            warning=_msg(staff_without_goals, "goals"),
        ),
        annual_reviews_enabled=YearPreflightEntry(
            in_flight_count=review_in_flight,
            warning=_msg(review_in_flight, "reviews"),
        ),
        project_ratings_visible=YearPreflightEntry(in_flight_count=0, warning=None),
        annual_review_final_rating_visible=YearPreflightEntry(in_flight_count=0, warning=None),
    )


# =====================================================================
# INTERNAL HELPERS
# =====================================================================

def _load_user_with_relations(db: DbSession, user_id: int) -> User:
    """
    Re-query a user with eagerly loaded relationships.

    Called after create/update to ensure the response includes nested
    function and designation objects, not just their IDs.

    `project_manager_names` is set to an empty list here. The mutation
    responses don't strictly need the field populated — the frontend
    invalidates `admin.users()` after success and refetches `list_users`,
    which computes the real PM names via a single batched query. The
    empty-list default keeps Pydantic happy without an extra round-trip.
    """
    user = (
        db.query(User)
        .options(
            joinedload(User.function),
            joinedload(User.designation),
        )
        .filter(User.id == user_id)
        .first()
    )
    if user is not None:
        user.project_manager_names = []  # type: ignore[attr-defined]
    return user