# Project Goals — quarterly reviews on yearly goals

*Date: 10 September 2026. Supersedes the single-review lifecycle in [`2026-09-09-project-goals-implementation-plan.md`](2026-09-09-project-goals-implementation-plan.md) §1–3; everything not mentioned here stays as built.*

**Status (2026-09-10, same day, all UNCOMMITTED on `main`):** implemented end to end. Backend: migration `d4a7b2c9e1f3` (tables `project_goal_quarters`, `project_goal_cycle_logs`; `current_quarter_seq` on the period; `acknowledged_at` moved to the review; `cycle_label` on the change log; set status reduced to draft/submitted/approved; data step placed the existing period on Q3 and relabelled Aarav's review), `app/services/project_goal_periods.py`, rewritten `project_goal_routes.py` (per-quarter self-review / review / acknowledge / unlock, `GET /team?cycle=`, `GET /period`, in-app + email notifications) and `goal_framework_routes.py` (`/cycle`, `/cycle/rollout`, `/cycle/set`, `/cycle/rollback`, `/cycle/log`, `PATCH /quarters/{seq}`), `project_routes` gated behind `require_feature("projects")`, Projects sheets/endpoint and the dashboard `project_coverage` removed. Frontend: `QuarterSelector.tsx`, `QuarterRolloutCard.tsx`, `ToggleRow.tsx`, rewritten `ProjectGoals.tsx` / `GoalsTable.tsx` / `TeamQueue.tsx` / `StageStrip.tsx` / `UnlockModal.tsx` / services; System Settings → Project Goals = goal-year card + quarter roll-out card with per-quarter ratings switches; Projects tab, `ProjectCoverageCard`, Projects export button and the "Trials" line removed. Seeds start in Q3 CY 2026 with Q1–Q3 rolled out. Verified: smoke test 86/86 (`scratchpad/smoke_project_goals.py`, fresh migrated DB), `tsc` clean except the 4 pre-existing errors in untouched files, dev DB migrated in place, browser walk as Admin / Staff / Mentor. QA module 07 rewritten for quarters.

## 1. Decisions this plan implements

| # | Source | Decision |
|---|---|---|
| 1 | Shreshta, 10 Sep | Goals are set **once at the start of the year** and do not change quarter to quarter. |
| 2 | Shreshta, 10 Sep | Reviews happen **every quarter** against those same goals. Project reviews are quarterly; annual goal reviews stay half-yearly (untouched). |
| 3 | Shreshta, 10 Sep | Nothing is tracked per trial or project. Everything lives in the tabular view. |
| 4 | Zaahid, 10 Sep | The quarter is **rolled out by the Admin**, the Healthark PMS way (roll out / set manually / roll back, logged, announced). Project Goals gets its **own** quarter control because it runs on Miltenyi's calendar year while Annual Goals run on Healthark's fiscal halves. |
| 5 | Zaahid, 10 Sep | The **current quarter is the window**: self-reviews and Miltenyi reviews may be filed for the current quarter or any earlier quarter of the same year, never a future one. No "self-review window" switch. One **"Ratings visible to staff" switch per quarter**, off until the Admin releases it. |
| 6 | Zaahid, 10 Sep | One self rating and one final rating per quarter; weightages stay informational. |
| 7 | Zaahid, 10 Sep | No consolidated year rating; that belongs to the Annual Review tab, discussed later. |
| 8 | Zaahid, 10 Sep | Quarter selector above the single table. |
| 9 | Zaahid, 10 Sep | Per-quarter rules carried over: mentor may draft before the self-review, submission waits for it, Admin may force past it, post-submission edits are logged and notify, acknowledgement per quarter, HR unlock per quarter. |
| 10 | Zaahid, 10 Sep | Notifications the Healthark way, layers 1 and 2: in-app **and email** on the workflow events, in-app announcement to everyone on roll-out. The HR tracker with Remind digests is the first follow-up. |
| 11 | Zaahid, 10 Sep | Export and the annual-review link wait. |
| 12 | Zaahid, 10 Sep | Existing test data: Aarav's review becomes the first live quarter. |
| 13 | Zaahid, 10 Sep | Projects are removed: tab, dashboard card, Excel sheets, "Trials" line. Tables stay dormant. |

## 2. Behaviour

### 2.1 Periods and quarters

- A **period** is a calendar year (`CY 2026`). It carries the framework rows, the goal sets, the two yearly switches (**Goal entry open**, **Weightages visible**) and a **current quarter** (1–4, or none before the first roll-out).
- A **quarter** row exists for every quarter that has started (seq ≤ current): `Q1 CY 2026` … `Q4 CY 2026`, displayed "Q3 · CY 2026". It carries one switch, **Ratings visible to staff**, off by default.
- **Roll out next quarter** advances Q3 → Q4. Rolling past Q4 creates the next period (`CY 2027`, entry closed, weightages visible, current quarter Q1), copies the framework rows and KPIs into it so Admin can adjust them, marks the old period inactive (read-only history) and requires the label to be typed. **Set manually** jumps to any quarter of the active period (first-time setup: `Q3 CY 2026`). **Roll back** returns to the previous label from the log. Every change writes `project_goal_cycle_logs` (from, to, kind, who, when) and posts an in-app announcement to every active user.
- Goal entry is independent of quarters: the Admin opens it at the start of the year (and now, for 2026) and closes it when goals are in.

### 2.2 Goals (unchanged except the status list)

Set status is **Draft → Submitted → Approved** only. Submit needs every KPI row filled; the mentor (or Admin) records the offline approval; goals are then locked for the year. HR **Unlock goals** is the correction path and is refused once any quarter has a submitted self-review or review.

### 2.3 Quarterly review

Each quarter of an approved set has its own review row: self-review text per KPI + one self rating; Miltenyi comments per KPI (transcribed by the mentor) + optional Healthark note + provenance (reviewer name, received on, link) + one final rating with "given by"; acknowledgement.

- **Writable quarters**: those with seq ≤ current quarter of the active period. A future quarter shows "opens when the Admin rolls the quarter"; a past period is read-only.
- Self-review: Save Draft any time in a writable quarter; Submit is one-shot and needs every row + rating.
- Miltenyi review: draft any time after approval; Submit needs the self-review of that quarter, every comment and a rating; the Admin may force past a missing self-review; post-submission edits are logged and notify the staff member.
- Redaction for the staff member: draft comments hidden until the review is submitted; the final rating hidden until that quarter's **Ratings visible** switch is on; approval note never shown; self-review drafts hidden from the mentor until submitted.
- Acknowledge per quarter once the review is submitted; an HR unlock of that quarter clears it.
- **Unlock review** takes the quarter; the review returns to draft (or the set returns to "approved with no self-review" semantics for that quarter when the self-review was never submitted).

### 2.4 Screens

- **Staff — My Goals**: header, three-step goal strip, framework band, a **quarter selector** (Q1–Q4, started quarters enabled, the current one highlighted, future ones disabled with a hint, each showing its state: not started / self-review submitted / reviewed ★n / acknowledged), then the same four-column table where the Self review and Miltenyi review columns belong to the selected quarter. Footer shows that quarter's ratings. Before approval the selector is inert and the review columns say "Opens after approval".
- **Mentor / Admin — set page**: same table + selector; approve; per-quarter review entry, provenance, submit, edit-after-submit, unlock (goals or the selected quarter); change log entries carry the quarter.
- **Team / All Goals queue**: quarter selector (defaults to current); columns Employee · Function · Level · Miltenyi reviewer · Goals · Self review (Qn) · Miltenyi review (Qn) · Acknowledged · Actions (Mark approved / Enter review / Open). The "Trials" column goes.
- **System Settings → Project Goals**: period card (label, active, Goal entry open, Weightages visible), **quarter roll-out card** (current quarter, Roll out next quarter → …, Set manually, Roll back, with the Healthark-style "what will / won't change" confirmation and typed confirmation on a year change), and the list of started quarters with their **Ratings visible** switches.

### 2.5 Notifications

| Event | Recipient | Channels |
|---|---|---|
| Goals submitted | mentor | bell + email |
| Goals approved | staff | bell + email |
| Self-review submitted (Qn) | mentor | bell + email |
| Miltenyi review submitted (Qn) | staff | bell + email |
| Review edited after submission (Qn) | staff | bell |
| HR unlock (goals or Qn) | staff + mentor | bell + email |
| Quarter rolled out / set | every active user | bell (announcement) |

Email goes through the existing `notification_service.notify(send_email=True, background_tasks=…)`, which is already wired to `send_email.send_notification_email` (Resend or SMTP; silently skipped when neither is configured).

## 3. Data model and migration `d4a7b2c9e1f3`

| Table | Change |
|---|---|
| `project_goal_period_settings` | add `current_quarter_seq` (int, nullable); drop `self_review_open`, `ratings_visible` |
| `project_goal_quarters` (new) | `org_id`, `period_label`, `seq` 1–4, `cycle_label` ("Q3 CY 2026"), `ratings_visible`, `opened_at`, `opened_by_id`; unique (org, period, seq) |
| `project_goal_cycle_logs` (new) | `org_id`, `from_label`, `to_label`, `kind` rollout/set/rollback, `actor_id`, `created_at` |
| `project_goal_sets` | status values reduced to draft/submitted/approved (data: self_reviewed/reviewed → approved); drop `acknowledged_at` (copied to the review row first) |
| `project_goal_reviews` | add `acknowledged_at`; data: `cycle_label` = period label → the first live quarter (calendar quarter of the migration date) |
| `project_goal_change_logs` | add `cycle_label` (nullable) |

Data steps run before the column drops: for every active period set `current_quarter_seq` to the calendar quarter of today, create quarter rows 1..current (ratings_visible copied from the old period switch for the current one), relabel existing reviews, copy acknowledgements.

## 4. API

Employee (`/project-goals`): `GET /me` (period incl. quarters + current, set incl. `reviews[]`), `POST /me`, `PUT /me/items`, `POST /me/submit`, `PUT /me/self-review` (`cycle_label`), `POST /me/self-review/submit` (`cycle_label`), `POST /me/acknowledge` (`cycle_label`).
Mentor/Admin: `GET /team?cycle=`, `GET /sets/{id}`, `GET /sets/{id}/log`, `POST /sets/{id}/approve`, `PUT /sets/{id}/review` (`cycle_label`), `POST /sets/{id}/review/submit` (`cycle_label`, `force`), `POST /sets/{id}/unlock` (`target`, `cycle_label`, `reason`).
Admin (`/admin/goal-frameworks`): existing matrix/rows/mapping; `GET/PATCH /settings` (entry_open, weightages_visible, is_active); new `GET /cycle` (current, next, previous, effects, quarters), `POST /cycle/rollout`, `POST /cycle/set {target}`, `PATCH /quarters/{seq}` (ratings_visible).
Removed from responses: `trials`. `project_routes` and the Projects export are gated off (`require_feature("projects")`) like project reviews.

## 5. Frontend files

`services/project-goals.service.ts`, `services/goal-framework.service.ts`, `pages/ProjectGoals.tsx`, `components/project-goals/{GoalsTable,StageStrip,TeamQueue,UnlockModal}.tsx`, new `components/project-goals/QuarterSelector.tsx`, `components/admin/SystemSettingsTab.tsx` (Project Goals section + new `QuarterRolloutCard`), removals in `AdminPanel.tsx`, `HrDashboard.tsx`, `ExportsTab.tsx`, `services/{dashboard,export}.service.ts`, `queryKeys.ts`.

## 6. Seeds

Both seeds: period `CY 2026` with current quarter 3 and quarter rows Q1–Q3; the demo seed's sample sets move to Q3 (bob reviewed + acknowledged, evan self-reviewed, iris approved, charlie submitted, mia draft); no projects, no project reviews.

## 7. Slices and verification

| # | Slice | Done when |
|---|---|---|
| 1 | Models, migration, schemas, routes, admin cycle endpoints, notifications with email | fresh DB migrates, `alembic check` clean for the new objects, smoke test extended to two quarters passes |
| 2 | Frontend services, staff page, set page, team queue, quarter selector | `tsc` clean; browser walk Staff → Mentor → Admin across Q3 and a rolled-out Q4 |
| 3 | System Settings: period switches, roll-out card, quarter ratings switches | roll out, set, roll back and ratings toggles work and log |
| 4 | Removals (Projects tab, coverage card, Projects sheets, Trials) | `tsc`, no dead routes reachable |
| 5 | Seeds, dev DB migrated in place, docs (QA 7, plan status, audit D1, memory) | seed re-run idempotent; QA module matches behaviour |

## 8. Follow-ups (not in this plan)

HR tracker for Project Goals with Remind email digests and log (Healthark layer 3); Admin "Notify" tab; Project Goals Excel export; quarterly ratings on the mentee Annual Summary / annual review; automated reminders (no scheduler exists).
