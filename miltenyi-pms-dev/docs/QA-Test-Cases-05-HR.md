# QA Test Cases — Module 5: HR-only Features

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Module 1 reviewed. Apply Module 1 §1.7 UI checklist on every screen.
> **Test accounts needed:** Admin (primary), Staff/Mentor/PM (for cross-checks that HR pages are blocked from them).

---

## 5.1 Admin Dashboard

> Rewritten 22 Sep 2026 for the Project Goals flows. Every year is spelled as a calendar-year span ("CY 26-27"); the stored token "FY26-27" appears only in URLs.

### TC-HRD-001 — Open the dashboard

**Login as:** Admin
**Steps:**
1. Sign in (the dashboard is the landing page) or click **Dashboard**.

**Expected:**
- Greeting, the subtitle "Org-wide rollups across staffing, goals and reviews." and a **Year** picker top-right listing years as "CY 26-27 (current)".
- Cards, top to bottom: **Cycles** (Goal year · Current quarter · Annual goals & reviews), **Pending Actions** in the right column (Unsubmitted Annual Reviews, Paused Settings), **Project Goals**, **Annual Review Progress**, **Goal Approval Progress**, **Active Personnel**, then **Mentor Coverage** full width.
- No Project Review card and no project cycle anywhere (the feature is retired for this org).

**UI checks:**
- Grid: 3 columns wide, 2 medium, 1 narrow; Pending Actions stays tall on the right on wide screens.
- Same border, padding, radius and title style on every card.

---

### TC-HRD-002 — Loading skeletons

**Login as:** Admin
**Steps:** Open the dashboard on a throttled connection (DevTools → Network → Slow 3G).
**Expected:** Each card shows its own skeleton in the same shell; content replaces it without a layout jump.

---

### TC-HRD-003 — Cycles card

**Login as:** Admin
**Expected:** **Goal year** "CY 26-27", **Current quarter** "Q3 · CY 26-27", **Annual goals & reviews** "H1 · CY 26-27" — the same values as the Topbar pills and System Settings → Calendar. With no active goal year the first two blocks read "Not set" with a hint pointing at System Settings.

---

### TC-HRD-004 — Project Goals card

**Login as:** Admin
**Expected:**
- Legend **Not started · Draft · Submitted · awaiting approval · Approved** with the donut centre "<approved>/<staff>"; the numbers equal the All Goals queue summary and the System Settings Save confirmation (both come from the same preflight).
- Chips **Goal entry open / closed** and **Weightages visible / hidden** for the picked year.
- A quarters table for the started quarters: **Self-reviews pending · Reviews pending · Submitted · Ratings** (Released / Hidden), the current quarter highlighted; reviews pending in amber when above zero.
- **View all →** opens the All Goals queue; **System Settings** opens the settings tab.
- Picking a year without a goal year shows "No goal year CY 25-26. Goal years start when the Admin rolls Q4 into Q1 in System Settings."

---

### TC-HRD-005 — Annual Review Progress

**Login as:** Admin
**Expected:** **Draft · Pending Mentor · Pending Management · Completed** for the picked year, sublabel "CY 26-27", **View all →** opens Annual Reviews pre-filtered to that year. Staff who have not started are listed in Pending Actions, not here.

---

### TC-HRD-006 — Goal Approval Progress

**Login as:** Admin
**Expected:** **Pending Approval · Changes Requested · Approved** for the picked year (every post-approval review state rolls into Approved; drafts are private and not shown). **View all →** opens Annual Goals pre-filtered to that year.

---

### TC-HRD-007 — Pending Actions: Unsubmitted Annual Reviews

**Login as:** Admin
**Expected:** Chips "N Not Started" and "N Drafts"; the first three rows of each bucket with function · designation and the mentor; Not Started rows open Management Review pre-filtered to the staff member and year, Draft rows open Annual Reviews filtered to drafts. All clear reads "Every staff member has submitted their review."

---

### TC-HRD-008 — Pending Actions: Paused Settings

**Login as:** Admin
**Expected:** One row per switch that is OFF: the annual gates (**Annual reviews paused**, **Annual goal editing disabled**, **Annual final ratings hidden**) and the picked goal year's Project Goals switches — "Goal entry closed · CY 26-27", "Weightages hidden · CY 26-27", "Q1 · CY 26-27 closed for backfill", "Q3 · CY 26-27 ratings not released · N reviews submitted" (only once reviews exist). Every row opens System Settings. All clear reads "No settings paused."

---

### TC-HRD-009 — Active Personnel

**Login as:** Admin
**Expected:** Legend **Staff · Mentor · Admin** with the donut total; each legend row opens the Users tab filtered to that role; empty roles are not listed.

---

### TC-HRD-010 — Mentor Coverage

**Login as:** Admin
**Expected:** **Unassigned staff** (orphaned first with "Lost · Nd ago", then "Never assigned"), all clear "Every active staff member has a mentor."; **Top mentors by load**; **View all →** opens the Users tab filtered to Staff.

---

### TC-HRD-011 — Year picker switches the cards

**Login as:** Admin
**Steps:** Change the **Year** picker.
**Expected:** Annual Review Progress, Goal Approval Progress, Pending Actions and the Project Goals card follow the picked year (one batched call for the annual cards); Cycles, Active Personnel and Mentor Coverage are snapshots and do not change. The picker lists every year with annual data or a goal year, newest first.

---

### TC-HRD-012 — Empty-state dashboard

**Pre-condition:** A fresh org with no goals or reviews.
**Login as:** Admin
**Expected:** Cards show graceful empty states ("No annual reviews in CY 26-27 yet.", "No goal year …") — never "0 / 0" or NaN%.

---

## 5.2 Excel Exports

There are 8 export surfaces. Test each one.

### TC-EXP-001 — Export Users

**Login as:** Admin
**Steps:**
1. Open the Users page.
2. Click **Export to Excel** (in the toolbar).
3. Confirm any download dialog.

**Expected:**
- An `.xlsx` file downloads.
- File name follows a clear pattern (e.g. `users-FY26-27-2026-05-12.xlsx`).
- Opens in Excel / Google Sheets without warnings.
- Columns: Name · Email · Role · Function · Designation · Mentor · Status · Date Joined.
- Rows match what the UI shows.

---

### TC-EXP-002 — Export Goals

**Login as:** Admin
**Steps:**
1. Open Annual Goals → All Goals.
2. Apply at least one filter (e.g. Year = current FY).
3. Click **Export**.

**Expected:**
- Excel file downloads with goals matching the current filter (filtered, not all).
- Columns include: Employee · Function · Designation · Goal Title · Description · Year · Mentor · Status · Created · (Self/Mentor Review status per half).

---

### TC-EXP-003 — Export Annual Reviews

**Login as:** Admin
**Steps:**
1. Open Annual Reviews → All Reviews.
2. Click Export.

**Expected:** Excel with one row per review.

---

### TC-EXP-004 — Export Project Reviews

**Login as:** Admin
**Steps:**
1. Open Project Reviews → All Reviews.
2. Click Export.

**Expected:** Excel with one row per project review; rating shown only if `project_ratings_visible` is ON for that report (or always present in HR exports — verify).

---

### TC-EXP-005 — Export Secondary Evaluations

**Login as:** Admin
**Steps:**
1. Find the Secondary Evaluations export entry point (may be on Project Reviews → All Reviews or a dedicated page).
2. Export.

**Expected:** Excel with one row per secondary evaluation; submitted content visible.

---

### TC-EXP-006 — Export Mentor Coverage

**Login as:** Admin
**Steps:**
1. From HR Dashboard's Mentor Coverage widget (or an admin page), click Export.

**Expected:** Excel with one row per mentor and their mentee count + list of mentees.

---

### TC-EXP-007 — Export Missing Annual Reviews

**Login as:** Admin
**Steps:**
1. From the Missing Annual Reviews widget or All Reviews tab, click Export of the filtered subset.

**Expected:** Excel with one row per employee with no review for the selected FY.

---

### TC-EXP-008 — Export Stalled Goals

**Login as:** Admin
**Steps:**
1. From the Stalled Goals widget or All Goals (filtered to Pending Approval older than N days), click Export.

**Expected:** Excel with one row per stalled goal.

---

### TC-EXP-009 — Export with no rows

**Login as:** Admin
**Steps:**
1. Apply a filter that returns zero rows.
2. Click Export.

**Expected:**
- Either:
  - Export button is disabled, OR
  - File downloads with headers only.
- No crash, no error toast.

---

### TC-EXP-010 — Export with very large dataset (if applicable)

**Login as:** Admin
**Steps:**
1. With a large dataset (1000+ rows), click Export.

**Expected:**
- A loading state appears during generation.
- File downloads successfully — no timeout.

**UI checks:**
- "Generating export…" spinner or progress indicator is shown.
- Export button is disabled during generation (no double-clicks).

---

### TC-EXP-011 — Export button placement

**Login as:** Admin
**Steps:**
1. Walk through every page that has an export button.

**UI checks:**
- Button is consistently placed on the right side of the filter toolbar (not in a new row, not floating).
- Button has consistent label and icon across pages.

---

## 5.3 Audit Log of Exports

### TC-AUDIT-001 — Open audit log

**Login as:** Admin
**Steps:**
1. Navigate to the Audit Log page (may be under Admin → Audit, or its own sidebar item).

**Expected:** A table of audit entries showing: Actor · Action · Target · Timestamp.

---

### TC-AUDIT-002 — Export action is recorded

**Login as:** Admin
**Steps:**
1. Perform an export (e.g. TC-EXP-001 Users export).
2. Refresh the audit log.

**Expected:**
- A new row appears with: Actor = your HR account · Action = "Exported Users" · Timestamp = just now.

---

### TC-AUDIT-003 — Filter audit log

**Login as:** Admin
**Steps:**
1. Use Actor / Action / Date filters.

**Expected:** Each narrows the table.

---

### TC-AUDIT-004 — Audit log cannot be edited

**Login as:** Admin
**Steps:**
1. Try to delete or edit an audit log row.

**Expected:** No such control exists. Audit log is append-only.

---

## 5.4 Cross-checks

- **Non-HR roles** cannot access HR Dashboard, Users page, Settings, Audit Log, or any export endpoint (refer to Module 1 §1.2 TC-RBAC).
- After every export, file opens correctly in Excel/Sheets — no corruption.
- Audit log entries appear in real time after the triggering action.
- Refer to Module 1 §1.7 UI checklist on every screen.

---

**End of Module 5.** Next: Module 6 — Cross-cutting UX & Regression.
