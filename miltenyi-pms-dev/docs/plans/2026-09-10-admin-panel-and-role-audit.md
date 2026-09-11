# Admin panel and role audit — Healthark-only instance

*Date: 10 September 2026. Companion to [`2026-09-09-project-goals-implementation-plan.md`](2026-09-09-project-goals-implementation-plan.md).*

**Status (same day):** decisions D2 (rename the enum values with a data migration), D3 (keep the "Miltenyi Biotec PMS" name, every account `@healthark.ai`, no PM / Miltenyi-HR accounts) and D4 (leave the retired project-review code hidden) were taken and implemented — steps 1, 2, 4 and 5 of the work plan are done (migrations `b3d9f1a7c2e4` and `c8e2f4b6d9a1`, seeds, docs). **D1 (Projects) was settled later the same day** — the stakeholders confirmed nothing is tracked per trial or project, so option (a) was implemented with the quarterly review model (`docs/plans/2026-09-10-quarterly-project-goals-plan.md`): the Projects tab, the HR dashboard Project Coverage card, the Projects export sheet/endpoint and the "Trials" line are gone; `project_routes.py` is gated behind `require_feature("projects")` and the tables stay dormant like project reviews. The Testing Guide `.docx` was not regenerated (python-docx is not installed).

## 1. What changed in the premise

The Pivot-Plan built a five-role model because Miltenyi project managers and Miltenyi HR were expected to log in. That is no longer the case: **only Healthark employees use the application, for their own evaluation.** The roles reduce to

| Business name | Current enum value | Keeps doing |
|---|---|---|
| **Admin** | `HR_MyOrg` | users, framework, settings, all reviews, mentor pairing, unlocks |
| **Staff** | `Employee` | own annual goals, annual self-review, project goals + self-review |
| **Mentor** | `Mentor` | mentees' annual goals and reviews, project-goal approval and review entry |

`PM` and `HR_Miltenyi` go away, together with everything that exists only for them. The Miltenyi *reviewer* stays as a plain **name field** on the employee (the Miltenyi manager still supplies comments offline; the mentor types them in).

Method: read every admin tab, the settings model and routes, the role enum and its call sites, and the seeds; counted role references per file. Verdicts below are **Remove**, **Move**, **Simplify**, **Keep**, or **Decide** (needs your call).

---

## 2. Findings by area

### 2.1 Role model and everything that hangs off it

| # | Item | Where | Verdict |
|---|---|---|---|
| R1 | `PM` and `HR_Miltenyi` enum members, `ADMIN_ROLES`, `PROTECTED_USER_ROLES` | `backend/app/models/user_models.py` | **Remove.** Only `HR_MyOrg` is an admin; the "protected roles" concept existed to stop Miltenyi HR editing Healthark accounts. |
| R2 | Two admin checks, `_require_hr_any` and `_require_hr_myorg` | `admin_routes.py`, `project_routes.py`, `export_routes.py`, `dashboard_routes.py` | **Simplify** to one Admin check. |
| R3 | Email-domain rule by role (`@healthark.ai` for HR/Mentor, `@miltenyi.com` for HR_Miltenyi/PM/Employee) | `admin_routes._validate_email_for_role`, `frontend/src/utils/text.ts` | **Remove.** Every user is a Healthark employee now; the rule currently *forces* Staff to have Miltenyi addresses, which is the opposite of the new premise. Optionally keep a single "must be `@healthark.ai`" check. |
| R4 | Employee-code convention `<ORG>-<ROLE>-NNN` with `HRK` for Healthark roles and `MIL` for Miltenyi roles (`MIL-EMP-001`, `MIL-PM-…`) | `admin_routes._ROLE_TO_ORG_PREFIX`, `_ROLE_TO_ROLE_CODE` | **Simplify.** One org prefix for everyone (`HRK-EMP-`, `HRK-MNT-`, `HRK-HR-`), or drop the org part. Seeded codes today are `MIL-T-S-09` style. |
| R5 | Role labels "HR · Healthark", "HR · Miltenyi", "PM (Miltenyi)", "Employee" | `RoleBadge.tsx`, `UserModal.tsx`, `UsersTab.tsx`, `utils/text.ts` | **Simplify** to "Admin", "Staff", "Mentor". Cheapest is a UI relabel that keeps the DB values (`HR_MyOrg`, `Employee`, `Mentor`); renaming the enum values needs a data migration and touches every filter/route string. **Decide** (D2). |
| R6 | Profile card derives "Organisation: Healthark / Miltenyi" from the role | `components/profile/ProfileInfoCard.tsx` | **Remove** the derivation (always Healthark) or drop the row. |
| R7 | `HR_Miltenyi` locked-field logic in the user form and API (`HR_MILTENYI_EDITABLE_FIELDS`) | `UserModal.tsx`, `admin_routes.update_user` | **Remove.** |
| R8 | Route guards listing `PM` / `HR_Miltenyi` | `frontend/src/App.tsx` (admin, project-reviews) | **Simplify** to the three roles. |
| R9 | Sidebar entries for PM and HR_Miltenyi, PM dashboard layout, `Dashboard.tsx` PM comment | `layouts/Sidebar.tsx`, `pages/EmployeeDashboard.tsx` | **Remove.** |
| R10 | Headcount card buckets Staff / Mentors / **PMs** / HR (HR = both HR roles) | `components/dashboard/HeadcountCard.tsx`, `dashboard_routes.hr-summary` | **Simplify** to Staff / Mentors / Admins. |
| R11 | Notification matrix row 4.1 "when HR Miltenyi creates a user…", Pivot-Plan role table, QA Module 1 accounts, Module 5 HR_Miltenyi cases, Testing Guide | `docs/` | **Update** after the code change. |

### 2.2 Users tab and user form

| # | Item | Verdict |
|---|---|---|
| U1 | Role filter with five options | **Simplify** to three. |
| U2 | "Project Manager" column and filter (shown to HR_Miltenyi instead of Mentor), `pm_name` server filter, `project_manager_names` computed on every user row | **Remove** (also removes a per-user query on the users list). |
| U3 | Protected-role filtering (hide Mentor/Admin rows from Miltenyi HR) | **Remove.** |
| U4 | Email placeholder `jane@miltenyi.com`, role dropdown labels | **Simplify.** |
| U5 | **Miltenyi Reviewer** text field (Staff only) | **Keep** — still the source of the project-goal comments. |
| U6 | Function, Designation, Mentor fields | **Keep** — they drive framework mapping and reviewer of record. |

### 2.3 Projects tab

Projects were the unit that generated per-project PM reviews. With that retired and no PM users, the tab's remaining consumers are:

- the "Trials: …" line on a project-goal set (context only, currently shows "—"),
- the HR dashboard **Project Coverage** card (projects whose PM left — meaningless without PMs),
- the Users tab PM column (removed by U2),
- the Projects Excel export (with PM and Secondary Evaluator columns),
- the mentee Projects tab (already hidden).

The project form *requires* a PM (role-validated as `PM`) and offers a secondary-evaluator pool of PM/HR_Miltenyi users, so without those roles the form cannot be used as it stands.

**Decide** (D1): **(a)** remove the tab, the coverage card, the Projects export and the "Trials" line, leaving the tables dormant like project reviews — small; or **(b)** rework projects into a PM-less "trial roster" (code, name, dates, members) so the goal set header and mentee page can show which trials a staff member works on — medium, and only worth it if the stakeholders want that context visible. Recommendation: **(a)** now; (b) can be added later without losing data.

### 2.4 Exports tab

| # | Item | Verdict |
|---|---|---|
| E1 | `MiltenyiExportsView` (Users + Projects, FY-filtered three-sheet workbook), `ExportExcelButton` Miltenyi branch, backend `_require_hr_any` on exports | **Remove.** |
| E2 | Projects export (PM / Secondary Evaluator columns) | **Remove** with D1(a), or strip the PM columns with D1(b). |
| E3 | Project Reviews export | Already gated off; **Remove** the button code with the rest of project reviews when that code is deleted. |
| E4 | Copy: "every project review received", "project reviews" in the per-employee dump description | **Update.** |
| E5 | No export for **Project Goals** (goal sets, self-reviews, ratings) | **Gap**, not redundancy — likely wanted before year-end. Follow-up. |
| E6 | Users, Annual Goals, Annual Reviews quick exports; export audit log | **Keep.** |

### 2.5 Framework Mapping tab

**Keep as is.** Columns Employee · Function · GCC designation · Level · Reviewer (Mentor) · Miltenyi reviewer · Status; only the two reviewer fields editable. Nothing here depends on the removed roles.

### 2.6 Framework tab

| # | Item | Verdict |
|---|---|---|
| F1 | Matrix editor (Level 1–4 × Outcomes / Functional goals / KPIs), Designations → levels strip, Add Function | **Keep.** |
| F2 | **"Visibility & gates · CY 2026"** section (Goal entry open, Self-review window open, Weightages visible, Ratings visible, "make period active") | **Move to System Settings** (you asked for all gates in one place). The Framework tab then holds content only. |

### 2.7 System Settings — every switch, who reads it, verdict

The tab today has four sections: *Annual Review Settings* and *Goal & Review Access Controls* (both per fiscal year), *Performance Cycle Configuration*, and *Developer · Date Simulation*. Below is every field on the settings row and the per-year override row.

| Field | Lives on | UI | Read by | Verdict |
|---|---|---|---|---|
| `annual_reviews_enabled` | per-FY override | "Enable Annual Reviews" | annual_review_routes | **Keep** |
| `annual_review_final_rating_visible` | per-FY override | "Show Ratings on Annual Reviews" | annual_review_routes | **Keep** |
| `annual_goals_edit_enabled` | per-FY override | "Edit Access for Annual Goals" | goal_routes | **Keep** |
| `project_ratings_visible` | per-FY override | "View Project Ratings" | project_review_routes only (retired) | **Remove** from UI now; drop the column when project-review code is deleted |
| same four flags | **also on `SystemSettings`** (org-wide copies) | not shown | never read for gating — only written by `apply_rollover_resets` and used once as a seed when the first per-FY row is created | **Remove** the org-wide copies and the rollover reset. Two copies of the same gate is exactly the duplication you suspected. |
| `active_cycle_name` | SystemSettings | read-only "auto-generated" label | Topbar FY pill, goal/annual routes (FY + half derivation), dashboards | **Keep** but derive as `H1/H2 FYxx-yy` only |
| `cycle_type` (quarterly / half-yearly) | SystemSettings | "cadence" select | Only project reviews used quarters; annual goals are fixed H1/H2 and annual reviews are per FY | **Remove** the select; fix the cadence at half-yearly. The current DB value is `quarterly`, which is why the topbar said "Q2 FY26-27". |
| `fiscal_start_month`, `timezone` | SystemSettings | shown | everything calendar-related | **Keep** |
| `cycle_start_date`, `cycle_end_date` | SystemSettings | — | nothing | **Remove** (dead columns) |
| `goals_submission_open` | SystemSettings | — | nothing | **Remove** (dead) |
| `goals_edit_enabled` | SystemSettings | — | nothing (only `annual_goals_edit_enabled` is read) | **Remove** (dead) |
| `reviews_submission_open` | SystemSettings | **not editable anywhere** | `pages/AnnualReviews.tsx` decides which per-row action to show from it | **Fix**: it is a hidden gate frozen at whatever the seed wrote. Either surface it or (better) drop it and let the per-FY "Enable Annual Reviews" drive the page. |
| `cycle_window_override` (H1/H2 calendar bypass) | SystemSettings | not editable | goal_routes, `SelfReviewCycleMenu` | **Move** into the Developer section next to Date Simulation, or remove if Date Simulation covers the need. |
| `simulated_today` | SystemSettings | Developer section | cycle_utils | **Keep** (env-gated). |
| `entry_open`, `self_review_open`, `weightages_visible`, `ratings_visible`, `is_active` | `project_goal_period_settings` | Framework tab | project_goal_routes | **Move** here as a "Project Goals · CY 2026" section (F2). |

### 2.8 Dashboards and navigation

| # | Item | Verdict |
|---|---|---|
| N1 | HR dashboard **Project Coverage** card (projects without a PM) | **Remove** (D1). |
| N2 | HR dashboard Headcount PM bucket; `hr-summary` HR_Miltenyi slice | **Simplify / Remove** (R10). |
| N3 | Employee dashboard PM layout; `MyAnnualReviewWidget` project-review section (already gated) | **Remove** the PM branch; gated code can go when project reviews are deleted. |
| N4 | Sidebar **Project Reviews** entry (gated), PM and HR_Miltenyi rows | **Remove.** |
| N5 | Topbar "Project · Q2 FY26-27" pill (gated) | **Remove** with `cycle_type`. |
| N6 | Notification icon map entry `project_review` | Harmless; remove with the feature. |

### 2.9 Seeds and data

| # | Item | Verdict |
|---|---|---|
| S1 | `miltenyi-test-seed.py`: 4 PM users, Werner (HR_Miltenyi); staff emails `@miltenyi.com`; codes `MIL-T-S-xx` | **Update**: three roles only, all `@healthark.ai`, Healthark codes. Keep the Miltenyi reviewer names. |
| S2 | `seed.py` (demo seed): PMs, HR_Miltenyi, projects, project reviews, sample sets | **Update** the same way; drop projects and project reviews from it (D1). |
| S3 | `Organization.domain = "miltenyi.com"` | Unused anywhere; leave or null. |
| S4 | `enabled_features` | **Keep** (single org, server-side gate). Remove `project_reviews` from the list is already done; `admin`/`mentoring` gates still used by routes. |

### 2.10 Things that still make sense and should stay

Function + GCC designation + level on the user (framework mapping), mentor pairing and reassignment log, annual goals with H1/H2 mentor reviews, annual reviews with management rating and calibration grid, Framework Mapping, Framework matrix, exports for users/goals/annual reviews with audit log, date simulation for QA, the Miltenyi reviewer name field and the Project Goals module itself.

Branding: the login page and `<title>` say "Miltenyi Biotec PMS". The instance still evaluates Healthark staff *on the Miltenyi engagement*, so this may be intended. **Decide** (D3).

---

## 3. Target admin panel

Tabs: **Users · Framework Mapping · Framework · Exports · System Settings** (Projects removed under D1(a)).

System Settings sections:

1. **Annual Reviews · FY** — Enable Annual Reviews; Show Ratings on Annual Reviews. (per FY, as today)
2. **Annual Goals · FY** — Edit Access for Annual Goals. (per FY)
3. **Project Goals · CY 2026** — Goal entry open; Self-review window open; Weightages visible to staff; Ratings visible to staff; period active / create next period. (moved from Framework)
4. **Calendar** — current FY and half (read-only, derived), fiscal year starts in, timezone.
5. **Developer** — Date simulation; H1/H2 window bypass (if kept).

Removed from the page: cadence select, "View Project Ratings", the org-wide duplicate flags.

---

## 4. Decisions needed

- **D1 Projects:** remove the tab and its card/export now (recommended), or rework into a PM-less trial roster.
- **D2 Role names:** relabel in the UI only ("Admin", "Staff", "Mentor"; DB keeps `HR_MyOrg`/`Employee`/`Mentor`) (recommended), or rename the enum values with a data migration.
- **D3 Branding and emails:** keep "Miltenyi Biotec PMS" as the product name? Reseed every account as `@healthark.ai`? Keep an "`@healthark.ai` only" email check?
- **D4 Dead code:** leave the project-review code dormant behind the feature gate for this round (recommended — smaller diff, reversible), or delete it now.

## 5. Work plan and sizing

| Step | Scope | Size |
|---|---|---|
| 1 | System Settings consolidation: move the Project Goals switches, remove "View Project Ratings" and the cadence select, drop the dead/duplicate flags (`goals_submission_open`, `goals_edit_enabled`, `reviews_submission_open`, `cycle_*_date`, org-wide annual copies), surface or drop `cycle_window_override`; migration for dropped columns | M |
| 2 | Role removal: enum, admin checks, email-domain rule, code prefixes, users tab/modal, route guards, sidebar, dashboards, headcount, profile card, exports view | L (≈25 files; most edits are deletions) |
| 3 | Projects (D1): remove tab, coverage card, export, "Trials" line; or rework | S / M |
| 4 | Seeds rewritten for three roles and Healthark emails; dev DB reseeded | S |
| 5 | Docs: Pivot-Plan role table + note, QA Modules 1/5/7 accounts and cases, notifications matrix 4.1, this audit marked done | S |

Each step ends with `py_compile`, `alembic check`, `tsc --noEmit`, the project-goals smoke test and a browser walk as Admin, Staff and Mentor.
