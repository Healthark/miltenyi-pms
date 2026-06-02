# Mentor reassignment + deactivation cascade (Option C, full surface)

## Context

User raised the bug: after HR reassigns Bob from Anjali → Priya, Bob's dashboard correctly shows Priya, but his My Goals rows still show "Mentor: Anjali."

A full audit found this is the visible symptom of a deeper inconsistency. The system stamps the mentor's identity onto goal + annual-review rows at creation time, but the live `User.mentor_id` is a separate column. Today's behavior is internally contradictory:

| Surface | Reads from | Effect after reassignment |
|---|---|---|
| Goal display ("Mentor: X" in My Goals) | STAMPED `Goal.manager_id` | Shows old mentor on every existing row |
| Goal approval auth gate | LIVE `User.mentor_id` | New mentor can approve old goals (silent live-takeover) |
| Annual review submit gate | STAMPED `AnnualReview.mentor_id` | Old mentor still owns the submission gate; new mentor gets 403 |
| Team Reviews / Team Goals tabs | LIVE `User.mentor_id` | New mentor sees mentee, old mentor doesn't — but can't act on annual review without the cascade |
| HR "All Mentor Pairings" | Filters to non-deleted mentors | Orphaned mentees (whose mentor was deactivated) disappear from HR's view entirely |

Three real bugs surface from this:
- **Display mismatch** on goal rows (user's original complaint).
- **Annual-review lockout**: only the old mentor can submit; new mentor blocked.
- **Orphan invisibility on deactivation**: when HR deactivates a Mentor, mentees' `User.mentor_id` is never null'd, dangling pointers + in-flight work freezes + the mentee vanishes from HR's pairings view (not in unmentored bucket either — `mentor_id` is non-null pointing at a tombstone).

This plan ships ONE PR that fixes all of the above end-to-end with consistent semantics.

### Locked-in design decisions

- **Cascade scope**: "in-flight" rows move to the new mentor; "closed" rows stay stamped to who actually did the work (history preserved for audit).
- **In-flight Goal statuses**: `draft`, `pending_approval`, `changes_requested`, plus the 8 `*_self_reviewed` states (employee has self-reviewed; mentor still owes the half-cycle mentor review). 11 statuses total.
- **In-flight AnnualReview statuses**: `draft`, `pending_mentor`.
- **Reassignment mid-evaluation (Scenario 3)**: clear `mentor_overall_review_draft` + `mentor_performance_rating_draft` when row moves. New mentor types their own evaluation.
- **Unassign to NULL (Scenario 6)**: null the stamped columns. In-flight work freezes until HR re-assigns.
- **Deactivation cascade**: when HR deactivates a Mentor, run the orphan cascade (null mentees' `mentor_id`, stamp `mentor_orphaned_at`, cascade their in-flight rows to NULL). Surface as a new "Orphaned by Deactivation" bucket on the HR dashboard's MentorCoverageCard. Send one notification to all HR_MyOrg users with the affected count.
- **Role-change cascade**: same as deactivation. When `update_user` changes a Mentor's role to something else, treat their mentees as orphaned.
- **Audit log**: new `mentor_reassignment_log` table; one row per moved entity (user, goal, review) with from/to mentor + reason.
- **One-shot backfill**: Alembic data migration that fixes existing dangling pointers + brings in-flight stamped/live into sync.

## Approach

### Part A — Schema additions

**File:** `backend/app/models/user_models.py`
- Add `mentor_orphaned_at = Column(DateTime(timezone=True), nullable=True)` next to `mentor_id`.
- Semantic: set when a mentee's mentor is deactivated or role-changed away from Mentor. Cleared when HR re-assigns the mentee to a new live Mentor. Drives the "Orphaned by Deactivation" bucket on the HR dashboard.

**File:** `backend/app/models/mentor_reassignment_log_models.py` (new)
- Mirror `export_audit_log_models.py` pattern (append-only, minimal schema).
- Columns:
  - `id` (PK)
  - `org_id` (FK organizations.id, nullable=False)
  - `admin_user_id` (FK users.id, nullable=False — who triggered)
  - `employee_user_id` (FK users.id, nullable=False — whose mentor changed)
  - `entity_type` (String(32), one of `"user"`, `"goal"`, `"annual_review"`)
  - `entity_id` (Integer, nullable — null for the `user` row itself, set for moved goals/reviews)
  - `old_mentor_id` (FK users.id, nullable — null when previously unassigned)
  - `new_mentor_id` (FK users.id, nullable — null when orphaned/unassigned)
  - `reason` (String(32), one of `"reassignment"`, `"deactivation"`, `"role_change"`, `"backfill"`)
  - `created_at` (DateTime tz, server_default=now())
- Indexes:
  - `(employee_user_id, created_at)` — per-mentee history
  - `(old_mentor_id, created_at)` — what did a mentor lose
  - `(new_mentor_id, created_at)` — what did a mentor gain

**Alembic migration** (new file): adds `mentor_orphaned_at` to `users` + creates `mentor_reassignment_log` table. No backfill in the migration upgrade itself — backfill runs as a separate script (Part H).

### Part B — Reassignment cascade (`update_user`)

**File:** `backend/app/api/routes/admin_routes.py` — `update_user` function (around line 783-887).

After the existing mentor-change detection (already snapshots `old_mentor_id` and detects diff), add a single helper call:

```python
if "mentor_id" in update_data and new_mentor_id != old_mentor_id:
    _cascade_mentor_reassignment(
        db=db,
        admin=current_user,
        mentee=user,
        old_mentor_id=old_mentor_id,
        new_mentor_id=new_mentor_id,
        reason="reassignment",
    )
```

The helper (new function in same file, near other validators):
1. **Active goal cascade**: `UPDATE goals SET manager_id = :new_mentor_id WHERE user_id = :mentee_id AND manager_id = :old_mentor_id AND approval_status IN (:in_flight_set)`. The 11-status `_GOAL_IN_FLIGHT_STATUSES` constant defined at module level.
2. **Annual review cascade**: `UPDATE annual_reviews SET mentor_id = :new_mentor_id, mentor_overall_review_draft = NULL, mentor_performance_rating_draft = NULL WHERE user_id = :mentee_id AND mentor_id = :old_mentor_id AND status IN (:in_flight_set)`. The 2-status `_REVIEW_IN_FLIGHT_STATUSES` constant.
3. **Clear `mentor_orphaned_at`** if the mentee had been orphaned (now they have a mentor again, even if it's NULL → wait, NULL doesn't clear it). Actually: clear ONLY if `new_mentor_id is not None`. If NULL→Anjola or Anjala→NULL, the orphaned_at state follows the live mentor presence.
4. Per-row log entries in `mentor_reassignment_log` with reason="reassignment". Bulk insert one row per moved entity (use `.execute(sa.insert(MentorReassignmentLog), [{...}])` style for efficiency).
5. Existing notification code stays — fires to old mentor + new mentor + mentee.

### Part C — Deactivation orphan cascade (`deactivate_user`)

**File:** `backend/app/api/routes/admin_routes.py` — `deactivate_user` function (around line 906-972).

Currently nulls `Project.pm_id` and `Project.secondary_evaluator_id`. Add a new block when the deactivation target is a Mentor (`user.role == Role.MENTOR.value`):

1. Find every active mentee: `SELECT id FROM users WHERE org_id = :org_id AND mentor_id = :deactivated_user_id AND is_deleted = FALSE`.
2. For each mentee, run the same in-flight cascade as Part B but with `new_mentor_id = None`:
   - Null `Goal.manager_id` on in-flight goals
   - Null `AnnualReview.mentor_id` + clear drafts on in-flight reviews
   - Set `mentee.mentor_id = NULL`
   - Set `mentee.mentor_orphaned_at = now()`
   - Log entries with `reason="deactivation"`
3. After cascade completes, fire one notification per HR_MyOrg user in the org: `"Mentor {full_name} was deactivated. {N} employee(s) are now orphaned and need a new mentor."`. Deep-link to `/dashboard` (where the new MentorCoverageCard orphan bucket lives).

Reuse the same `_cascade_mentor_reassignment` helper from Part B with `new_mentor_id=None` so the cascade logic doesn't fork.

### Part D — Role-change orphan cascade

**File:** `backend/app/api/routes/admin_routes.py` — `update_user` function.

After the existing role-change validation but before commit:

```python
if (
    "role" in update_data
    and update_data["role"] != user.role
    and user.role == Role.MENTOR.value
    and update_data["role"] != Role.MENTOR.value
):
    # User is being demoted/promoted away from Mentor — orphan all their mentees.
    _orphan_mentees(db, admin=current_user, deactivated_or_demoted_mentor=user, reason="role_change")
```

Extract the "orphan all mentees of this user" logic from Part C into a `_orphan_mentees` helper so both deactivate_user and the role-change branch can call it. The helper handles: per-mentee cascade + null mentor_id + stamp orphaned_at + log + HR notification.

### Part E — Reassignment when mentee was previously orphaned

When HR finally assigns a new mentor to an orphan:
- `_cascade_mentor_reassignment` runs with `new_mentor_id != None`
- Adds one line: `user.mentor_orphaned_at = None` (clearing the orphan marker now that the mentee is mentored again).

The mentee's previously-orphaned in-flight goals/reviews have `manager_id` / `mentor_id` already at NULL (set during orphaning). The cascade query `WHERE manager_id = :old_mentor_id` won't match those because `old_mentor_id` is NULL. So we add a parallel "claim NULL-stamped in-flight rows" branch:

```python
# Plus: claim any NULL-stamped in-flight rows that were orphaned earlier
db.query(Goal).filter(
    Goal.user_id == user.id,
    Goal.manager_id.is_(None),
    Goal.approval_status.in_(_GOAL_IN_FLIGHT_STATUSES),
).update({"manager_id": new_mentor_id})
```

Same shape for AnnualReview. Each claim logs to `mentor_reassignment_log` with `old_mentor_id=None`.

### Part F — Dashboard "Orphaned by Deactivation" bucket

**Backend** — `backend/app/api/routes/dashboard_routes.py` (`get_hr_dashboard_summary`, around line 660-712):
- Extend `MentorCoverage` Pydantic schema (in `app/schemas/dashboard_schemas.py`): add `orphaned_employees: list[OrphanedEmployee]`. `OrphanedEmployee` extends `UnmentoredEmployee` shape with one extra field: `orphaned_at: datetime` (so the UI can show "orphaned 3 days ago").
- Partition the existing `unmentored` query:
  - `truly_unmentored` = `mentor_id IS NULL AND mentor_orphaned_at IS NULL`
  - `orphaned` = `mentor_orphaned_at IS NOT NULL` (covers the case where mentor_id is NULL because of deactivation OR mentor_id is non-null and dangling — both should never coexist after our cascade, but be defensive)
- Return both arrays.

**Frontend** — `frontend/src/components/dashboard/MentorCoverageCard.tsx`:
- Add new section between the existing "Unmentored Employees" and "Top Mentors": `OrphanedSection`.
- Visual: amber/warning styling (vs the unmentored bucket's gray), Icon: `UserX` from lucide.
- Per-row: full name + function/designation + "Orphaned X days ago" computed from `orphaned_at`.
- "Reassign" CTA per row (or just the section header) → navigates to `/admin?tab=users` with a query param that pre-filters to that employee (out of scope for this PR; bucket display + count is enough).
- Empty state: hide the section entirely (don't show "0 orphans" — only renders when there's something to act on). Distinct from the all-clear "Every active Employee has a mentor" green state of the unmentored section.

**Schema** — `frontend/src/services/dashboard.service.ts`: add `orphaned_employees: OrphanedEmployee[]` to the TS mirror of MentorCoverage.

### Part G — HR notification on deactivation/role-change orphaning

Fire inside `_orphan_mentees` after the cascade completes (Part C/D):
- Query all HR_MyOrg users in the org (active only).
- `notify_many(...)` with:
  - `module="admin"`, `entity_type="mentor_deactivation"` (or `"mentor_role_change"`), `entity_id=deactivated_mentor.id`
  - `message=f"Mentor {full_name} was deactivated. {N} mentee(s) are now without a mentor and need reassignment."`
  - `entity_url="/dashboard"` (deep-link to where the orphan bucket lives)
  - `send_email=True` (this is a real "you need to act" event, worth the email)

Reuse the existing `notify_many` helper from `app/services/notification_service.py`.

### Part H — One-shot backfill script

**File:** `backend/scripts/backfill_mentor_state.py` (new).

Runs against the org's current data and:

1. **Fix dangling User.mentor_id pointers** — find every active user with `mentor_id` pointing at a soft-deleted user:
   ```sql
   SELECT u.id, u.mentor_id, m.id AS dead_mentor_id
   FROM users u JOIN users m ON m.id = u.mentor_id
   WHERE u.is_deleted = FALSE AND m.is_deleted = TRUE
   ```
   For each row: null `mentor_id`, set `mentor_orphaned_at = NOW()`, log to `mentor_reassignment_log` with `reason="backfill"`.

2. **Sync stamped → live for in-flight rows** — find every in-flight goal/review where `stamped_mentor_id != live_mentor_id`:
   ```sql
   SELECT g.id, g.manager_id AS stamped, u.mentor_id AS live
   FROM goals g JOIN users u ON u.id = g.user_id
   WHERE u.is_deleted = FALSE
     AND g.approval_status IN (:_GOAL_IN_FLIGHT_STATUSES)
     AND g.manager_id IS DISTINCT FROM u.mentor_id
   ```
   For each row: update `manager_id = u.mentor_id` (which might be NULL if the mentee is orphaned, that's fine). Log to `mentor_reassignment_log` with `reason="backfill"`.

3. Same query for `annual_reviews` with `mentor_id` + the in-flight subset.

4. Idempotent: re-running the script after fixes are applied should produce zero changes.

Script runs as a standalone CLI: `python backend/scripts/backfill_mentor_state.py --org-id=N` (or `--all-orgs`).

Output: counts per category + a CSV dumped to stdout of the affected rows for audit.

### Part I — Constants

**File:** `backend/app/api/routes/admin_routes.py` (top of file, near other module-level helpers):

```python
# Statuses where the assigned mentor still owes an action. Used by the
# reassignment + orphan cascades to decide whether to move the row's
# stamped mentor_id to the new mentor (in-flight) or preserve historical
# attribution (closed).
_GOAL_IN_FLIGHT_STATUSES = frozenset({
    ApprovalStatus.DRAFT.value,
    ApprovalStatus.PENDING_APPROVAL.value,
    ApprovalStatus.CHANGES_REQUESTED.value,
    # *_self_reviewed: employee submitted half/quarter review, mentor still
    # owes the mentor-review submission. Each cycle is independent — moving
    # to the new mentor means the new mentor does THIS cycle's review.
    ApprovalStatus.H1_SELF_REVIEWED.value,
    ApprovalStatus.H2_SELF_REVIEWED.value,
    ApprovalStatus.Q1_SELF_REVIEWED.value,
    ApprovalStatus.Q2_SELF_REVIEWED.value,
    ApprovalStatus.Q3_SELF_REVIEWED.value,
    ApprovalStatus.Q4_SELF_REVIEWED.value,
})

_REVIEW_IN_FLIGHT_STATUSES = frozenset({
    ReviewStatus.DRAFT.value,
    ReviewStatus.PENDING_MENTOR.value,
})
```

## Critical files

**Backend (new):**
- `backend/app/models/mentor_reassignment_log_models.py` — new audit-log model
- `backend/alembic/versions/{rev}_add_mentor_orphaned_at_and_log.py` — schema migration
- `backend/scripts/backfill_mentor_state.py` — one-shot backfill CLI

**Backend (modified):**
- `backend/app/models/user_models.py` — add `mentor_orphaned_at` column
- `backend/app/api/routes/admin_routes.py` — add `_cascade_mentor_reassignment` + `_orphan_mentees` helpers; wire into `update_user` (reassignment + role-change branches) and `deactivate_user`; add `_GOAL_IN_FLIGHT_STATUSES` + `_REVIEW_IN_FLIGHT_STATUSES` constants
- `backend/app/api/routes/dashboard_routes.py` — partition unmentored query into truly-unmentored + orphaned, return both
- `backend/app/schemas/dashboard_schemas.py` — extend `MentorCoverage` with `orphaned_employees: list[OrphanedEmployee]`

**Frontend (modified):**
- `frontend/src/services/dashboard.service.ts` — mirror the new schema field
- `frontend/src/components/dashboard/MentorCoverageCard.tsx` — add OrphanedSection between unmentored and top-mentors

## Critical reuse points (don't re-invent)

- `notify_many(...)` in `app/services/notification_service.py` — fan out the deactivation alert to all HR_MyOrg users.
- `_authorize_user_mutation` already gates HR_Miltenyi from deactivating Mentors — no new auth needed.
- `mentor_overall_review_draft` + `mentor_performance_rating_draft` columns on AnnualReview — already exist; cascade just nulls them on move.
- `ExportAuditLog` model pattern (in `app/models/export_audit_log_models.py`) — mirror its append-only schema for `mentor_reassignment_log`.
- The session claim `has_mentor` already handles the `mentor.is_deleted` case correctly (`auth_routes._build_session:65-69`); the cascade just nulls the FK so the underlying data agrees.

## Verification

**Backend smoke:**
- `python -c "ast.parse(...)"` on every touched file → exit 0
- `python -c "from app.api.routes import admin_routes, dashboard_routes; from app.models import mentor_reassignment_log_models"` → exit 0
- `alembic upgrade head` runs cleanly on the seed DB
- `alembic downgrade -1 && alembic upgrade head` → migration is reversible
- `python backend/scripts/backfill_mentor_state.py --org-id=1` → reports counts; re-run produces 0 changes (idempotent)

**Frontend smoke:**
- `node node_modules/typescript/lib/tsc.js --noEmit` → exit 0

**Manual sweep — seed data exercises every scenario from the design doc**

Login as `sarah.patel@healthark.ai` (HR_MyOrg, password `password123`):

1. **Scenario 1 — mixed-state reassignment.** Pick Bob (mentored by Anjali). Verify Bob has 1 approved goal + ≥1 pending goal + an in-flight annual review. Edit Bob, change mentor → Priya, save.
   - ✅ Approved goal still shows "Mentor: Anjali" in Bob's My Goals
   - ✅ Pending goal now shows "Mentor: Priya"
   - ✅ Annual review's mentor evaluation now opens for Priya in Team Reviews (not Anjali)
   - ✅ `mentor_reassignment_log` has entries for each moved item
   - ✅ Notifications fire to Anjali, Priya, Bob

2. **Scenario 2 — closed-state reassignment.** Pick an employee whose work is all completed. Reassign. Verify zero rows moved + zero log entries (cascade no-op).

3. **Scenario 3b — drafts cleared.** As Anjali, save a draft mentor evaluation for Bob's annual review (don't submit). HR reassigns Bob → Priya. Login as Priya, open Bob's review. Verify the draft fields are empty (Priya starts fresh).

4. **Scenario 6a — unassign to NULL.** Edit Bob, set mentor to nothing, save. Verify Bob's in-flight goals/reviews have NULL stamped mentor + Bob appears in MentorCoverageCard with `mentor_orphaned_at` set.

5. **Deactivation cascade (Part C).** Pick Anjali (Mentor). Verify she has ≥1 mentee (Bob). Deactivate Anjali.
   - ✅ Bob's `mentor_id` is now NULL, `mentor_orphaned_at` is set
   - ✅ Bob's in-flight goals/reviews have NULL stamped mentor
   - ✅ MentorCoverageCard's new "Orphaned by Deactivation" section shows Bob with "Orphaned X seconds ago"
   - ✅ HR notification ("Mentor Anjali Rao was deactivated. 3 mentees are now orphaned…") in Sarah's bell + email
   - ✅ `mentor_reassignment_log` has reason="deactivation" entries

6. **Re-mentoring an orphan (Part E).** After Scenario 5, edit Bob → assign Priya. Verify:
   - ✅ `mentor_orphaned_at` cleared
   - ✅ Orphan bucket on dashboard shrinks by 1 (Bob removed)
   - ✅ Bob's in-flight goals/reviews now stamped with Priya
   - ✅ Log entries with `old_mentor_id=NULL`, `new_mentor_id=priya.id`

7. **Role-change cascade (Part D).** Pick a Mentor with mentees. Edit them, change role to Employee. Same effect as deactivation: mentees orphaned, MentorCoverageCard updates, HR notified with `reason="role_change"`.

8. **Backfill script (Part H).** Manually create a dangling state (SQL: `UPDATE users SET is_deleted=TRUE WHERE email='anjali.rao@healthark.ai'` — but DON'T null mentees' mentor_id). Run `python backend/scripts/backfill_mentor_state.py --all-orgs`. Verify:
   - ✅ Bob's mentor_id is now NULL, orphaned_at is set
   - ✅ Bob's in-flight goals/reviews have NULL stamped mentor
   - ✅ Re-running the script produces zero changes

**Regression checks:**
- Mentor's Team Goals + Team Reviews tabs still work — show only live-mentored mentees (unchanged behavior)
- Annual Review calibration grid (HR) — unchanged
- Project Reviews — unaffected (don't reference mentor)
- Notifications dropdown — historical notifications from now-deactivated mentors still display (per earlier audit decision)
- Export Excel sheets — goals stamped with deactivated mentors still render their names (audit preservation)

## Out of scope (deliberately)

- **FY filter on MenteeDetail page** — separate UI concern; the page currently shows all of a mentee's history flat. Adding an FY picker is a nice-to-have, separate PR.
- **UI cue on historical goal rows** ("approved while under different mentor") — informational; not blocking.
- **Bulk reassignment UI** — HR currently reassigns one-by-one via the Edit User modal. Doing 10 orphans at once needs 10 clicks. A "Reassign all orphaned" bulk action is a follow-up.
- **Reverse cascade on REACTIVATE** — when HR reactivates a previously-deactivated Mentor, this PR does NOT auto-restore their old mentees. Mentees stay orphaned until HR explicitly reassigns them. Reactivation is rare and the explicit choice keeps the audit trail clean.
- **Notification enrichment** — the deactivation alert says "N mentees orphaned" but doesn't list their names inline. Click-through to the dashboard surface shows the list. Inline list in notification body is a polish step.
- **MentorReview half-cycle stamping** — the `GoalMentorReview` table doesn't stamp mentor_id (it's inferred from `Goal.manager_id`). Once we cascade `Goal.manager_id`, all half-cycle reviews implicitly follow. No change needed there.
