# Project Goals — implementation plan

Status: approved wireframes (stakeholder sign-off 9 Sep 2026); build starts 9 Sep 2026.
Inputs: `docs/meetings/2026-09-02-miltenyi-goals-gap-review.md` (gap review), `wireframes_new/` (approved screens).
Codebase: Miltenyi-only UAT build, no live instance. The UAT database is wiped and reseeded at the end.

## 1. What we are building

One goal set per employee per period ("CY 2026"), against the Miltenyi "Indicative Goal Themes" framework for the employee's function and level. A single table view: rows are the framework KPIs, columns are KPI · Goal · Self review · PM review, framework paragraphs in a band above, one self rating and one final rating in a footer row. The same table serves the employee, the mentor and HR; only the editable column changes with the stage.

Roles in the flow:

| Actor | Does |
|---|---|
| Employee | Writes one goal per KPI, submits (records an offline agreement), later writes a self review per KPI plus one self rating, acknowledges the final review. |
| Mentor (Healthark) | Is the reviewer of record for their mentees. Marks the set approved (agreed offline), enters the Miltenyi reviewer's comments per KPI, an optional Healthark note per KPI, and the final rating. |
| Miltenyi reviewer | Never logs in. Named per employee; their comments arrive offline and are transcribed by the mentor. |
| HR_MyOrg (Healthark HR) | Maintains the framework (matrix editor, Add Function), the employee mapping (mentor + Miltenyi reviewer), the period switches (entry open, self-review open, weightages visible, ratings visible), and can unlock a set with a logged reason. |
| HR_Miltenyi / PM | No part in this flow. Seeded logins are placeholders and are dropped from the seed. |

### Decisions carried in from the review and the wireframe sign-off

- Architecture option C from the gap review: a new Project Goals module, additive tables, no change to the Annual Goals or Project Reviews state machines.
- Reviewer of record = the employee's existing Mentor (`users.mentor_id`). No new role, no new reviewer FK.
- One evaluation for CY 2026 (after 31 Dec). The review table is keyed by a cycle label so quarterly cycles can be added later without a schema change.
- Weightages live on the framework KPI row and are never entered by employees. Their visibility to employees is a per-period switch. No weighted score.
- Goal approval has no comment loop: employee submits, mentor clicks "Mark approved (agreed offline)" recording who agreed and when. HR can unlock with a reason; every unlock and every post-submission edit is logged.
- The per-project PM review queue is retired for the Miltenyi org: `project_reviews` leaves `enabled_features`, `project_goals` joins it. Code stays; the server-side feature check hides the endpoints.
- Single organisation. `enabled_features` stays and gains a server-side guard (`require_feature`).

### Assumptions taken from the approved wireframes (flag if any is wrong)

1. Final rating is given by the Miltenyi reviewer and transcribed; `final_rating_by` is stored so this can be switched per review.
2. The mentor sees the employee's self rating before entering the final rating.
3. Every KPI row must have a goal before the employee can submit; there is no "additional goals" box in v1.
4. The employee acknowledges the review with one click (read receipt, not agreement).
5. The Healthark note per KPI is optional and shown to the employee labelled as Healthark's.
6. Employees whose function has no framework row at their level see a notice instead of the table.

## 2. Data model (all new, additive)

```
goal_frameworks            org · function_id · level 1..4 · period_label · title · business_outcomes · functional_goals · created_by_id
                           unique (org, function, level, period)
goal_framework_kpis        framework_id · seq · text · weightage           unique (framework, seq)
users                      + miltenyi_reviewer_name (nullable)
project_goal_sets          org · user_id · period_label · framework_id · status
                           submitted_at · approved_at · approved_by_id · approved_agreed_with · approved_agreed_on · approval_note
                           acknowledged_at                                  unique (org, user, period)
project_goal_items         set_id · seq · kpi_id (nullable) · kpi_text (snapshot) · weightage (snapshot) · goal_text
                           unique (set, seq)
project_goal_reviews       org · set_id · cycle_label · self_rating · self_is_draft · self_submitted_at
                           reviewer_id · entered_by_id · miltenyi_reviewer_name · source_received_on · source_url
                           final_rating · final_rating_by · review_is_draft · review_submitted_at
                           unique (set, cycle)
project_goal_review_items  review_id · item_id · self_text · primary_comment · healthark_note   unique (review, item)
project_goal_change_logs   org · set_id · actor_id · action · before (json) · after (json) · reason · created_at
project_goal_period_settings  org · period_label · is_active · entry_open · self_review_open · weightages_visible · ratings_visible
                           unique (org, period)
```

Set status: `draft → submitted → approved → self_reviewed → reviewed`. Items snapshot the KPI text and weightage at creation, so a framework edit does not rewrite an existing set.

The existing `role_expectations` table and the six GCC axes are untouched; they still back the (now hidden) PM evaluation form and the mentor goal-review reference rail.

## 3. Backend

New files:
- `app/models/project_goal_models.py` — the tables above.
- `app/schemas/project_goal_schemas.py`.
- `app/api/routes/project_goal_routes.py` — mounted at `/api/v1/project-goals`.
- `app/api/routes/goal_framework_routes.py` — mounted at `/api/v1/admin/goal-frameworks` (HR_MyOrg only).
- `app/core/features.py` — `require_feature(name)` dependency reading `Organization.enabled_features`.
- `seed_data/goal_themes.py` — the seven CY 2026 documents, generated from the structured PDF extraction.
- Alembic revision `a7c3e9d1f2b4_add_project_goals` (revises `c5e8d27a91f6`).

Endpoints (all behind `CurrentUser` + `require_feature("project_goals")`):

| Method · path | Who | Effect |
|---|---|---|
| GET `/project-goals/me` | Employee | Framework row, period settings, own set (or null), review. Creates nothing. |
| POST `/project-goals/me` | Employee | Create the draft set for the active period (items snapshot the KPIs). |
| PUT `/project-goals/me/items` | Employee, status draft | Save goal texts (draft). |
| POST `/project-goals/me/submit` | Employee, status draft, all items non-empty | → submitted. Notifies mentor. |
| PUT `/project-goals/me/self-review` | Employee, status approved, self_review_open | Save self texts + self rating (draft). |
| POST `/project-goals/me/self-review/submit` | Employee, all self texts + rating | → self_reviewed. Notifies mentor. |
| POST `/project-goals/me/acknowledge` | Employee, status reviewed | Stamps acknowledged_at. |
| GET `/project-goals/team` | Mentor (own mentees), HR_MyOrg (all) | Queue rows: set status, review status, Miltenyi reviewer, framework availability. |
| GET `/project-goals/sets/{id}` | Owner, mentor of owner, HR_MyOrg | Full set + framework + review. Rating redaction for the owner follows `ratings_visible`. |
| POST `/project-goals/sets/{id}/approve` | Mentor of owner | submitted → approved with agreed_with / agreed_on / note. Log. Notify employee. |
| PUT `/project-goals/sets/{id}/review` | Mentor of owner, status ≥ approved | Save primary comments, Healthark notes, provenance, final rating (draft). |
| POST `/project-goals/sets/{id}/review/submit` | Mentor of owner, status self_reviewed (HR may override) | → reviewed. Log. Notify employee. |
| PUT `/project-goals/sets/{id}/review` after submit | Mentor of owner | Edit; logs before/after; notifies employee. |
| POST `/project-goals/sets/{id}/unlock` | HR_MyOrg | Reason required; approved → draft (goal column) or reviewed → approved (review). Log. Notify. |
| GET `/admin/goal-frameworks?period=` | HR_MyOrg | Every row for the period with KPIs, plus designations per level per function. |
| POST `/admin/goal-frameworks` | HR_MyOrg | Add a row (function, level, title, paragraphs, KPIs summing to 100). |
| PUT `/admin/goal-frameworks/{id}` | HR_MyOrg | Replace paragraphs, title and KPI list (weights must total 100). |
| DELETE `/admin/goal-frameworks/{id}` | HR_MyOrg | Only if no set references it. |
| PATCH `/admin/goal-frameworks/designations/{id}` | HR_MyOrg | Set `career_level` (and label). |
| GET `/admin/goal-frameworks/mapping` | HR_MyOrg | Employee, function, designation, level, mentor, Miltenyi reviewer, status. |
| GET/PATCH `/admin/goal-frameworks/settings?period=` | HR_MyOrg | Period switches. |
| PATCH `/admin/users/{id}` | existing | Gains `miltenyi_reviewer_name`. |

Permissions are relational, like the mentor goal review today: mentor actions require `owner.mentor_id == current_user.id`. HR_MyOrg reads everything and performs unlocks. HR_Miltenyi and PM get 403 everywhere in this module.

Notifications (in-app, `module="project_goal"`, deep link `/project-goals?set_id=`): set submitted → mentor; approved → employee; self-review submitted → mentor; review submitted / edited → employee; unlocked → employee and mentor. Copy names the Miltenyi reviewer, not "your PM".

## 4. Frontend

- `services/project-goals.service.ts`, `services/goal-framework.service.ts`; `queryKeys.projectGoals.*`, `queryKeys.admin.goalFrameworks*`.
- `pages/ProjectGoals.tsx` — role switch: Employee → own table; Mentor → team queue with a detail view at `/project-goals/:setId`; HR_MyOrg → all sets list + detail.
- `components/project-goals/`: `GoalsTable.tsx` (the shared table; props decide the editable column), `FrameworkBand.tsx`, `StageStrip.tsx`, `ApproveModal.tsx`, `ProvenanceBand.tsx`, `TeamQueue.tsx`, `UnlockModal.tsx`.
- Admin Panel: `FrameworkMappingTab.tsx` and `FrameworkTab.tsx` (matrix editor with staged Save/Discard, `AddFunctionModal.tsx` two-step). Tabs shown to HR_MyOrg only.
- `Sidebar.tsx`: "Project Goals" item (feature `project_goals`, roles Employee, Mentor, HR_MyOrg). `App.tsx`: routes with `requiredFeature="project_goals"`.
- `UserModal.tsx`: Miltenyi reviewer field for Employees.
- Reuse: `PerformanceRatingSelect`, `PerformanceRatingBadge`, badge styles from `ApprovalStatusBadge`, the `EvalModal` textarea class, `useConfirm`, `useToast`.

## 5. Seed and data

- `seed_data/goal_themes.py`: seven functions × four levels, KPIs and weightages, generated from the PDF extraction (two truncated KPI texts completed by hand and marked). Pharmacovigilance has no rows.
- `seed.py`: Miltenyi `enabled_features` = dashboard, goals, project_goals, annual_reviews, mentoring, admin (project_reviews removed); seed frameworks for CY 2026; period settings row (entry open, weightages visible, self-review closed, ratings hidden); `miltenyi_reviewer_name` on employees; drop the PM and HR_Miltenyi placeholder accounts; sample sets in different stages for the demo.
- UAT database: `alembic upgrade head` then reseed (wipe is acceptable; no live data).

## 6. Slices and verification

| # | Slice | Done when |
|---|---|---|
| 1 | Models, migration, model registry, `users.miltenyi_reviewer_name`, `seed_data/goal_themes.py` | `alembic upgrade head` on a fresh SQLite DB succeeds; `alembic check` reports no drift for the new tables; `py_compile` clean. |
| 2 | Feature guard, schemas, employee + mentor + HR routes, notifications, change log | Route module imports; manual smoke via Swagger: create set → submit → approve → self-review → review → acknowledge; forbidden-role checks return 403. |
| 3 | Admin framework routes (CRUD, designations level, mapping, settings) | Matrix payload round-trips; weight validation rejects ≠ 100. |
| 4 | Seed rewrite + reseed | `python seed.py` runs; login as employee/mentor/HR shows expected data. |
| 5 | Frontend: services, keys, nav, routes, employee table, mentor queue + table, HR views | `tsc --noEmit` clean; walk the flow in the browser as each role. |
| 6 | Frontend: admin Framework Mapping + Framework tabs, UserModal field | Add Function creates a row; edits save; mapping shows statuses. |
| 7 | Retire project reviews for Miltenyi: feature flag, nav, dashboard widgets fall back cleanly | PM/HR_Miltenyi surfaces hidden; employee dashboard shows no dead project-review strip. |
| 8 | Docs and QA: update Pivot-Plan decision note, add QA cases for the module, notifications matrix rows | Docs reflect the shipped behaviour. |

Each slice ends with `python -m py_compile` on changed backend files and `npx tsc --noEmit -p tsconfig.app.json` on the frontend, plus a browser walk for UI slices.

## 7. Out of scope for this build (follow-ups)

Reviewer packet PDF/email; exports for the new tables; dashboard cards for project goals; surfacing the goal-set review on the mentee Summary tab and the calibration grid; automated reminders (no scheduler exists); quarterly cycles for CY 2027; per-team framework variants.

## 8. Open items still with stakeholders

Whether a KPI text can be tweaked per employee (assumed no); whether CY 2027 is quarterly; Pharmacovigilance document; who mentors and therefore reviews Shreshta and Amit; whether Miltenyi is comfortable with its managers' names and comments being stored.
