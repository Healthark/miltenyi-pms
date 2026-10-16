# Personal frameworks — implementation plan (16 Oct 2026)

**Ask (Zaahid, 16 Oct 2026):** the Admin must be able to override a staff member's Project Goals framework — KPI weightages, KPI texts and the text parts (title, the two paragraphs) — for that person only, taking effect immediately, even when the role's framework is already set. Today this was done once by a production script for Ramanadh Babu D (weights only, no UI).

**Decisions taken (16 Oct 2026, Zaahid accepted all recommendations):**
1. KPIs can be **added or removed only until the goals are approved**; after approval only KPI texts and weightages change (removing a KPI after quarter reviews exist would delete those reviews).
2. The **staff member and their mentor get a bell notice** (and email when SMTP is on) when their framework is personalised, changed or reverted.
3. Personal frameworks are **not carried into the next goal year**; the new year starts from the role. The editor offers **"Copy last year's"** when one existed.
4. A **"Personalised" marker** shows on the framework band to everyone who sees the sheet (staff, mentor, Admin), and in the Admin lists.

Also in scope: **lock past-year frameworks** (the API accepts edits to any year's rows today; the UI only edits the active year).

---

## 1. How it works today (audit)

- A goal set (`project_goal_sets`) points at one framework row (`framework_id`), chosen by the person's function × career level × goal year when they press **Start** (`project_goal_routes._framework_for`).
- KPI text and weightage are **copied** onto the person's goal rows (`project_goal_items.kpi_text`, `.weightage`) at that moment. Quarter reviews attach to those rows (`project_goal_review_items.item_id`, cascade).
- The band text (title, business outcomes, functional goals) is **read live** from the framework row the set points at.
- Editing a role column on the Framework tab changes the column only; existing sets keep their rows. Exception: a column's Additional goals % follows to DRAFT sets (`update_row`, `_sync_extra_rows`).
- Year roll-over copies every column into the new year (`_copy_frameworks`); last year's sets keep pointing at last year's rows. **So next year's KPI changes never alter last year's goals or reviews.**
- Gaps: (a) no per-person framework, so Ramanadh's weights live only on his rows and the Admin can't see them; (b) several queries assume one framework per function × level × year and would break once a second (personal) row exists for the same pair; (c) past-year columns are editable through the API.

## 2. Data model — one additive migration

Revision `f5a7c9e1b3d6_personal_frameworks` (down: `e4f6a8b0c2d5`):

- `goal_frameworks.user_id` — nullable FK `users.id`, indexed. Set = this row is **that person's personal framework** for `period_label`. Null = a role column (all existing rows).
- `goal_frameworks.based_on_id` — nullable FK `goal_frameworks.id` (ON DELETE SET NULL): the role column it was customised from (shown as "based on …", used by Revert).
- Replace the unique constraint `uix_goal_framework_row (org_id, function_id, level, period_label)` with two partial unique indexes (Postgres and SQLite both support them; batch mode for SQLite):
  - `uix_goal_framework_row` on `(org_id, function_id, level, period_label) WHERE user_id IS NULL` — one column per role per year, as today;
  - `uix_goal_framework_personal` on `(org_id, user_id, period_label) WHERE user_id IS NOT NULL` — at most one personal framework per person per year.
- The model gets matching `Index(..., unique=True, postgresql_where=..., sqlite_where=...)` so the test suite's `create_all` builds the same rules.
- No change to `project_goal_sets` or `project_goal_items`.

Apply with `alembic upgrade head` per schema: `miltenyi` (testing), `miltenyi_uat`, and production `miltenyi_pms` (the user runs it on production). Existing data is untouched.

## 3. Backend

### 3.1 New service `app/services/personal_frameworks.py`
- `role_column(db, org_id, function_id, level, period)` — the column (`user_id IS NULL`).
- `personal_framework(db, org_id, user_id, period)` — the person's row or None.
- `framework_for_person(db, user, period)` — personal row if any, else the role column. Replaces `_framework_for` wherever a *person's* framework is meant.
- `draft_for_person(db, user, period)` — what the editor opens with: the existing personal row; or, when none, band text from the role column and **KPI rows from the person's current goal rows if they have a set** (so Ramanadh opens at 35/30/20/10/5 + Additional goals 0), else from the column. Also returns: set status, whether KPI count may change, the role column summary, last year's personal row (for "Copy last year's").
- `apply_framework_to_set(db, s, fw, actor, action)` — the immediate sync:
  - re-point `s.framework_id`;
  - KPI rows matched by `seq`: update `kpi_text`, `weightage`, `kpi_id`; goal text and quarter reviews stay;
  - rows added / removed only while `s.status` is draft or submitted (removing a row deletes its goal text; the editor warns);
  - after approval a KPI-count change is refused (409, see 3.2);
  - the Additional goals row takes the framework's `extra_goal_weightage` (if the row exists; the year switch still decides whether it exists);
  - one `project_goal_change_logs` row: `framework_personalised` / `framework_reverted`, before/after = title + KPI texts/weights + Additional goals %.

### 3.2 New Admin endpoints (`/admin/goal-frameworks/personal`, Admin only)
| Method | Path | Does |
|---|---|---|
| GET | `/personal?period=` | Personal frameworks of the year: person, function · level, based-on column, set status, total, updated at/by |
| GET | `/personal/{user_id}?period=` | `draft_for_person` (editor contents + flags) |
| PUT | `/personal/{user_id}?period=` | Create or update the person's personal framework (title, two paragraphs, KPIs, Additional goals %; KPIs + Additional goals = 100, same validator as columns); apply it to their set at once; log; notify staff + mentor |
| DELETE | `/personal/{user_id}?period=` | Revert: re-point the set to the role column and apply it (same rules; 409 if approved and the column has a different KPI count); delete the personal row; log; notify |

Rules: active goal year only; the person must be active Staff with a function and a career level; their role column must exist (it is the base and the revert target). Errors in plain sentences, e.g. "Aarav's goals are approved: you can change KPI texts and weightages, not add or remove KPIs."

### 3.3 Existing code to adjust (personal rows must never be mistaken for role columns)
- `project_goal_routes`: `GET /me` (framework shown before Start) and `POST /me` (Start) use `framework_for_person`; `/team` builds its function × level map from **columns only** and, for a person with a personal framework, shows its title plus a new `personalised: true`; `_framework_out` adds `is_personal` and `personal_for_name`.
- `goal_framework_routes`: the matrix, `create_row` uniqueness check, `delete_row` in-use count, `/mapping` "defined" set and `_copy_frameworks` (year roll-over) all filter `user_id IS NULL`; `_get_row` (column edit / delete) refuses personal rows; `/mapping` rows gain `personalised: bool`. `update_row`'s draft sync already filters by the column's id, so personal sets are unaffected. `_sync_extra_rows` reads `st.framework` and therefore already uses the personal value.
- **Past-year lock:** column create / update / delete and the personal endpoints refuse a goal year that is not the active one (409 "CY 25-26 is a past year; its framework is locked.").

### 3.4 Notifications
Bell (+ email when SMTP is on) to the staff member and their mentor, module `project_goal`, linking to the set (or `/project-goals` before Start):
- "The Admin personalised your CY 26-27 Project Goals framework." / "… for <name>." (mentor)
- "Your CY 26-27 Project Goals framework is back to the standard for your role."

## 4. Frontend

- **Service** `goal-framework.service.ts`: types `PersonalFramework`, `PersonalFrameworkDraft`; `listPersonal`, `getPersonal`, `savePersonal`, `revertPersonal`. Query keys under `admin.goalFrameworks`.
- **Shared editor:** move the column editor pieces out of `FrameworkTab.tsx` (draft type, totals, validation, KPI list with the pinned Additional goals row, `TotalBadge`, `AutoTextarea`) into `components/admin/frameworkEditor.tsx`, no behaviour change for the Framework tab.
- **`PersonalFrameworkModal`:** header "Personal framework · <name> · CY 26-27", "based on <role column>"; the editor; KPI add/remove disabled after approval with the reason; a warning when a removed KPI has goal text; **Copy last year's** when available; **Save** (confirmation: "Applies to <name>'s goals now; <name> and <mentor> are notified") and **Revert to standard** (confirmation).
- **Framework Mapping tab:** a "Personalised" chip in the row and a **Customise framework** action per staff member (opens the modal).
- **Framework tab:** a "Personal frameworks · CY 26-27" section listing them with **Edit** and **Revert**.
- **Project Goals pages:** `FrameworkBand` shows a "Personalised" chip when `is_personal`; the Admin's set page gets a **Customise framework** button (same modal); `TeamQueue` shows "Personalised" beside "Level n · title".
- Invalidate `projectGoals.all` and the framework keys after save / revert.

## 5. Tests (`backend/tests/test_personal_frameworks.py`)
1. Personalise before Start: `GET /me` shows the personal framework; Start builds rows from it.
2. Draft set: save updates rows by position, keeps goal text, may add/remove KPIs; change-log row; notices to staff and mentor.
3. Approved set with a quarter review: text/weight change applies and the review survives; KPI-count change → 409.
4. Revert: rows return to the column values; personal row gone; notices.
5. Isolation: matrix, `/team` and `/mapping` ignore personal rows; editing the column leaves personal sets alone; year roll-over does not copy personal rows.
6. Past-year lock on column and personal endpoints.
7. Admin only (mentor / staff → 403); totals must be 100.
8. The editor draft for a person with custom rows (Ramanadh's case) opens with their current weights.

Plus `npx tsc -b`, `npm run build`, the full backend suite, and a browser check on a scratch SQLite copy (temporary servers on :8010 / :5180 with email off, as on 7 Oct).

## 6. Docs
QA module 07 (new "Personal frameworks" cases), QA 05 (Admin), the UAT guide's Framework / Framework Mapping rows (+ the Word copy), a Pivot-Plan revision note.

## 7. Roll-out
1. Merge; run `alembic upgrade head` on `miltenyi`, `miltenyi_uat`, and (user) production `miltenyi_pms`; restart the backend; rebuild the frontend.
2. **Ramanadh, no script:** the Admin opens **Customise framework** for him; the editor shows his current 35/30/20/10/5 and Additional goals 0; **Save** turns that into his personal framework with no visible change to his sheet. Claude verifies read-only afterwards.

## 8. Build order (one branch `feat/personal-frameworks`, one PR)
1. Migration + model indexes; column-only filters; past-year lock; tests for isolation and the lock.
2. Service + personal endpoints + sync + notifications; tests 1–4, 7, 8.
3. Frontend: shared editor extraction, modal, Mapping / Framework tab entries, band and queue markers.
4. Docs; browser check; PR.
