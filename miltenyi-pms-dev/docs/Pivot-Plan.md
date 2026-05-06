# Plan: Pivot the App to the MyOrg-Staffs-Miltenyi Model

## Context

The app currently models a single-tenant performance management system. The new business reality: MyOrg (the platform owner) staffs employees to a client (Miltenyi). Distinct parties play distinct roles in the performance lifecycle:

- **Miltenyi PMs** evaluate the staffed employees on project work (quarterly cycle).
- **MyOrg mentors** — three fixed people — review their mentees' goals (twice yearly via H1/H2 self-reviews) and write annual reviews (yearly).
- **Two HRs** coexist: MyOrg HR (full super-admin) and Miltenyi HR (limited admin: users + projects + project reviews + system settings, but **cannot edit Mentors or MyOrg HR rows** — security boundary).

This codebase is the Miltenyi-side hosted instance. MyOrg has a separate hosting setup (out of scope). All features — project reviews, goals (with H1/H2 self-reviews), annual reviews, mentor flow — stay in this single codebase. Role-gated UI hides the wrong-side features per user.

Self-reviews exist on goals and annual reviews (already in schema). Project reviews stay PM-only — no self-review there.

## Decisions taken in discussion

1. **Tenancy:** Single-tenant codebase. "Two instances" is a hosting topology fact, not a feature requirement.
2. **Role model:** Expand `User.role` enum directly. Replace `Admin`/`Staff` with the richer enum below.
3. **Project form:** PM becomes a project-level field (not a member checkbox), restricted to Miltenyi-PM users. Drop `reports_to_id`. **Keep** `secondary_evaluator_id`. Members are Staff employees only.
4. **Migration:** Fresh wipe — drop dev DB, rewrite `seed.py`, run Alembic migrations from scratch.
5. **Self-review scope:** Only goals + annual reviews (already exist). Project reviews remain PM-only.
6. **Cycle decoupling:** Already correct in code — goals always use H1/H2 ([`get_goal_cycle_name`](backend/app/core/cycle_utils.py:54)), project reviews use org's `cycle_type` (quarterly), annual reviews use FY. No cadence code change needed.

## New role taxonomy

`User.role` enum (replaces current `Admin`/`Staff`):

| Role          | Identity                                 | Can do                                                                                    | Cannot do                                                        |
| ------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `HR_MyOrg`    | MyOrg HR — full super-admin              | Everything: users, projects, system settings, all reviews, mentor pairing                 | —                                                                |
| `HR_Miltenyi` | Miltenyi HR — limited admin              | View users, manage projects, view project reviews, edit system settings                   | **Edit Mentors or HR_MyOrg users** (security boundary)           |
| `Mentor`      | Pure mentor (3 fixed MyOrg people)       | View mentees, review mentee goals, write mentee annual reviews                            | Set own goals, be rated, do project reviews, be a project member |
| `PM`          | Miltenyi project manager                 | Submit/edit project reviews on their team                                                 | Set goals, be rated, write annual reviews, be a project member   |
| `Staff`       | MyOrg employee assigned to Miltenyi work | Set goals, self-review goals (H1/H2), self-review annual reviews, see own project reviews | Mentor others, do project reviews                                |

Existing `is_management` flag → dropped (the new enum supersedes it).
Existing `mentor_id` self-FK → kept (HR pairs Staff to Mentors via the existing UserModal mentor combobox).

## Implementation slices

Land the work in slices, each leaving the app coherent.

### Slice 1: Backend role taxonomy + auth gates

- [`backend/app/models/user_models.py`](backend/app/models/user_models.py) — add Python `Role(str, Enum)` for the 5 values; `role` column stays `String` storing the enum value. Drop `is_management` column.
- [`backend/app/api/routes/auth_routes.py:71`](backend/app/api/routes/auth_routes.py#L71) — drop `is_management` from JWT claims; emit `role` as the new enum value.
- [`backend/app/api/routes/admin_routes.py`](backend/app/api/routes/admin_routes.py) — replace `_require_admin` with role-specific guards: `_require_hr_myorg`, `_require_hr_any` (= MyOrg or Miltenyi HR), `_require_hr_myorg_for_target` (used when editing a Mentor or HR_MyOrg row — the security boundary).
- [`backend/app/api/routes/goal_routes.py`](backend/app/api/routes/goal_routes.py) — gate goal creation: only `Staff` can own goals. Mentor's edit-on-mentee path stays (already exists at [:365, :399, :458, :502](backend/app/api/routes/goal_routes.py#L365)).
- [`backend/app/api/routes/annual_review_routes.py`](backend/app/api/routes/annual_review_routes.py) — only `Staff` are reviewees; only their `mentor_id` (a `Mentor`) can write the mentor side. Update [:91](backend/app/api/routes/annual_review_routes.py#L91) (the `is_management` check on management override) to gate on `HR_MyOrg` instead.
- [`backend/app/api/routes/project_review_routes.py`](backend/app/api/routes/project_review_routes.py) — only `PM` can submit; only `Staff` can be reviewed. Drop self-evaluation defenses since self-review never existed here.

### Slice 2: Project model + form changes

- [`backend/app/models/project_models.py`](backend/app/models/project_models.py) — add `pm_id = Column(Integer, ForeignKey("users.id"), nullable=True)`. Drop `reports_to_id`. Keep `secondary_evaluator_id`. Drop `evaluator_type` semantics on `ProjectAssignment` (PM is no longer a member, so `evaluator_type` becomes redundant — drop it).
- [`backend/app/api/routes/project_routes.py`](backend/app/api/routes/project_routes.py) — accept/return `pm_id`. Validate `pm_id`'s user has `role=PM`. Validate `secondary_evaluator_id`'s user is **not** `PM` or `Mentor` (any other role OK).
- [`backend/app/api/routes/project_review_routes.py`](backend/app/api/routes/project_review_routes.py) — replace `ProjectAssignment.evaluator_type='Primary'` lookups (used at [:200, :278, :424, :536](backend/app/api/routes/project_review_routes.py#L200)) with `Project.pm_id == current_user.id`. PM is no longer in the assignments table.
- [`frontend/src/components/admin/ProjectModal.tsx`](frontend/src/components/admin/ProjectModal.tsx) — replace per-member `is_pm` checkbox with a project-level PM `UserCombobox` filtering to `role=PM`. Remove the Reports-To input. Keep the Secondary Evaluator combobox (filter: not PM, not Mentor).
- [`frontend/src/services/project.service.ts`](frontend/src/services/project.service.ts) — update payload/response types (`pm_id` added, `reports_to_id` removed). Drop `is_pm` from `AssignmentCreatePayload`.
- [`frontend/src/pages/ProjectReviews.tsx`](frontend/src/pages/ProjectReviews.tsx) + project-review tabs — fetch PM via `project.pm_id` instead of via assignments.

### Slice 3: Frontend role-gated UI

- [`frontend/src/services/auth.service.ts`](frontend/src/services/auth.service.ts) — extend `AuthResponse.role` to the new enum. Drop `is_management`.
- [`frontend/src/contexts/AuthProvider.tsx`](frontend/src/contexts/AuthProvider.tsx) — expose `isHRMyOrg`, `isHRMiltenyi`, `isMentor`, `isPM`, `isStaff` helpers (similar to existing `hasFeature`).
- [`frontend/src/layouts/Sidebar.tsx`](frontend/src/layouts/Sidebar.tsx) — replace `requiredRole: ["Admin"]` filter logic with per-role nav lists:
  - Mentor: My Mentees, Profile, Support
  - PM: Project Reviews, Profile, Support
  - Staff: Dashboard, Project Reviews, Annual Goals, Annual Reviews, Profile, Support
  - HR_Miltenyi: Admin Panel (subset), Profile, Support
  - HR_MyOrg: Admin Panel (all tabs), Profile, Support
- [`frontend/src/components/ProtectedRoute.tsx`](frontend/src/components/ProtectedRoute.tsx) — accept `allowedRoles?: Role[]`; redirect to `/dashboard` (or `/unauthorized`) if user's role isn't in the list.
- [`frontend/src/components/admin/UserModal.tsx:13`](frontend/src/components/admin/UserModal.tsx#L13) — update ROLES constant to the 5-value enum. (User just modified this file — preserve their `["Admin", "Staff"]` shape and replace, don't revert other recent changes.)
- [`frontend/src/components/admin/UsersTab.tsx`](frontend/src/components/admin/UsersTab.tsx) — render Role badge per row. For HR_Miltenyi viewer, hide Edit/Delete buttons on `Mentor` and `HR_MyOrg` rows.
- [`frontend/src/components/admin/RoleBadge.tsx`](frontend/src/components/admin/RoleBadge.tsx) — extend to render all 5 role colors.

### Slice 4: Admin tab visibility split

- [`frontend/src/components/admin/`](frontend/src/components/admin) — split tabs:
  - HR-any (visible to both HRs): `UsersTab`, `ProjectsTab`, `SystemSettingsTab`
  - HR-MyOrg-only: `ManagementReviewTab` (currently gated by `is_management` — re-gate to `role === "HR_MyOrg"`), mentor-pairing rows in `UsersTab`
- Backend mirrors this: every admin endpoint declares its required role guard from Slice 1.

### Slice 5: seed.py rewrite

[`backend/seed.py`](backend/seed.py) — wipe and rewrite:

- 1 × `HR_MyOrg` (e.g. `hr@myorg.miltenyi.com` or whatever convention emerges)
- 1 × `HR_Miltenyi` (e.g. `hr@miltenyi.com`)
- 3 × `Mentor` (the 3 fixed people)
- 4 × `PM` (one per Miltenyi project + a couple reserves)
- ~10 × `Staff` (MyOrg employees with Miltenyi-issued emails) — paired to mentors via `mentor_id`
- 4 projects with `pm_id` set, `secondary_evaluator_id` set, members = Staff only
- Goals + GoalSelfReviews + GoalMentorReviews for Staff only
- AnnualReviews for Staff only (Mentor-rated, HR_MyOrg-finalized)
- ProjectReviews populated for current Q1 (some pending, some reviewed)

### Slice 6: Wipe + smoke test

- Drop dev DB (`backend/app.db` or whatever the local SQLite path is)
- `alembic upgrade head`
- `python backend/seed.py`
- Start backend + frontend
- Log in as each of the 5 roles, walk visible nav, attempt forbidden actions, confirm 403 / hidden UI
- Verify project review workflow: Staff sees pending → PM submits → Staff sees reviewed
- Verify goal review workflow: Staff sets goal → submits H1 self-review → Mentor reviews → Staff sees feedback
- Verify annual review workflow: Staff submits self-review → Mentor reviews → HR_MyOrg finalizes
- Verify HR_Miltenyi cannot edit a Mentor or HR_MyOrg user (UI hides + backend 403)

## Open items to resolve during implementation (don't block this plan)

- **Concrete email convention** for the 5 role types in seed (need user input — currently a guess: `hr@myorg.miltenyi.com` for MyOrg HR, etc.). Will ask before running seed.
- **Whether existing Alembic migrations get a new revision** for the role expansion + project schema changes, or whether we use the wipe-and-fresh-seed escape hatch only. Recommendation: write a migration too, since prod will eventually need it.
- **`Project.secondary_evaluator_id` permitted roles** — confirmed: any role except PM and Mentor. (HR_MyOrg, HR_Miltenyi, or Staff are all valid secondary evaluators.)
- **`ManagementReviewTab` future** — repoint to `HR_MyOrg` gate for now; if it's redundant after the role split, delete in a follow-up.
- **Existing seed users named like Alice/Bob/Charlie** — keep those identities or replace with realistic MyOrg/Miltenyi names? Will ask.

## Critical files reference

| Layer                  | File                                                                                                 | Why critical                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| DB models              | [`backend/app/models/user_models.py`](backend/app/models/user_models.py)                             | Role enum lives here; everything else gates off this column                      |
| DB models              | [`backend/app/models/project_models.py`](backend/app/models/project_models.py)                       | `pm_id` introduction; drop `reports_to_id` and assignment `evaluator_type`       |
| Auth                   | [`backend/app/api/routes/auth_routes.py`](backend/app/api/routes/auth_routes.py)                     | JWT claim shape — frontend reads role from here                                  |
| Cycle util (no change) | [`backend/app/core/cycle_utils.py`](backend/app/core/cycle_utils.py)                                 | Already supports decoupled cadences — leave alone                                |
| Project review routes  | [`backend/app/api/routes/project_review_routes.py`](backend/app/api/routes/project_review_routes.py) | Many places assume `evaluator_type='Primary'` — all repointed to `Project.pm_id` |
| Frontend role helper   | [`frontend/src/contexts/AuthProvider.tsx`](frontend/src/contexts/AuthProvider.tsx)                   | Single source of truth for role-based UI gates                                   |
| Sidebar                | [`frontend/src/layouts/Sidebar.tsx`](frontend/src/layouts/Sidebar.tsx)                               | Per-role nav list — biggest UX consequence                                       |
| Project form           | [`frontend/src/components/admin/ProjectModal.tsx`](frontend/src/components/admin/ProjectModal.tsx)   | The form-changes the user explicitly called out                                  |
| Seed                   | [`backend/seed.py`](backend/seed.py)                                                                 | Rewritten end-to-end with new role distribution                                  |

## Verification

After all slices land:

1. **DB integrity:** `alembic upgrade head` on a fresh DB; `python backend/seed.py` runs without errors.
2. **Type-check:** `python -m py_compile` on every changed backend file; `tsc --noEmit -p frontend/tsconfig.app.json`.
3. **Per-role smoke:** log in as each of the 5 role types, walk the visible UI, confirm only the right surfaces appear.
4. **Forbidden-action checks:**
   - PM tries to GET `/api/v1/goals` → 403
   - Mentor tries to POST `/api/v1/goals` → 403
   - HR_Miltenyi tries to PATCH a `role=Mentor` user → 403
   - Staff tries to POST a project review → 403
5. **Happy paths:**
   - Staff sets goal → submits H1 self-review → Mentor reviews → Staff reads mentor feedback
   - PM opens pm-queue → submits evaluation → Staff sees reviewed status
   - HR_MyOrg finalizes Staff annual review with management rating
6. **Visual verification:** open the app in a browser, confirm Sidebar nav matches the role table, confirm UserModal role dropdown shows all 5 options for HR_MyOrg and only the 4 non-MyOrg-HR options for HR_Miltenyi (TBD — flag for user).
