# QA Test Cases — Module 5: HR-only Features

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Module 1 reviewed. Apply Module 1 §1.7 UI checklist on every screen.
> **Test accounts needed:** HR_MyOrg (primary), Staff/Mentor/PM (for cross-checks that HR pages are blocked from them).

---

## 5.1 HR Dashboard

### TC-HRD-001 — Open the dashboard

**Login as:** HR_MyOrg
**Steps:**
1. Open **HR Dashboard** from the sidebar (this should be the default landing page for HR_MyOrg).

**Expected:**
- 7 widgets render in a grid layout:
  1. **Headcount**
  2. **Annual Review Funnel**
  3. **Goal Approval Funnel**
  4. **Project Review Completion**
  5. **Missing Annual Reviews**
  6. **Stalled Goals**
  7. **Mentor Coverage**
- A **Fiscal Year picker** is in the top-right of the dashboard.

**UI checks:**
- Widget grid is responsive: 3 cols on wide, 2 on medium, 1 on narrow.
- All widgets have the same border style, padding, and corner radius.
- Widget titles are consistently styled and aligned.

---

### TC-HRD-002 — Loading skeletons

**Login as:** HR_MyOrg
**Steps:**
1. Open the dashboard (force a slow connection in browser DevTools → Network → Throttle to Slow 3G if needed).

**Expected:**
- Each widget shows a skeleton/loader during initial load.
- Skeletons use the same shell as the loaded state (so the layout doesn't shift).

**UI checks:**
- Skeleton animation (pulse or shimmer) is consistent across widgets.
- Once loaded, content fades in or replaces the skeleton without a layout jump.

---

### TC-HRD-003 — Headcount widget

**Login as:** HR_MyOrg
**Steps:**
1. Locate the Headcount widget.

**Expected:**
- Shows total active users across the org.
- Optionally breaks down by Function or Role.

**UI checks:**
- Large number is the focal point; secondary stats below or beside it.
- If a chart is present, axes/legends are readable.

---

### TC-HRD-004 — Annual Review Funnel widget

**Login as:** HR_MyOrg
**Steps:**
1. Locate the Annual Review Funnel widget.

**Expected:**
- Shows counts at each stage: **Not Started · Draft · Pending Mentor · Pending Management · Completed**.
- A visual element (bar/funnel) makes proportions easy to read.

**UI checks:**
- Stage labels do not overflow their containers.
- Color coding for each stage matches the badges used in tables.

---

### TC-HRD-005 — Goal Approval Funnel widget

**Login as:** HR_MyOrg
**Steps:**
1. Locate the Goal Approval Funnel widget.

**Expected:**
- Shows counts at: **Draft · Pending Approval · Changes Requested · Approved · Reviewed (H1) · Reviewed (H2)** for the selected FY.

---

### TC-HRD-006 — Project Review Completion widget

**Login as:** HR_MyOrg
**Steps:**
1. Locate the Project Review Completion widget.

**Expected:**
- Shows percentage / count of completed vs total project reviews for the cycle.

**UI checks:**
- Progress bar fills with brand color; percentage text overlays clearly.

---

### TC-HRD-007 — Missing Annual Reviews widget

**Login as:** HR_MyOrg
**Steps:**
1. Locate the widget.

**Expected:**
- Shows a list of employees with no annual review submitted for the current FY.
- If the list is long, only the top 5 are shown with a "View all" link.

---

### TC-HRD-008 — Stalled Goals widget

**Login as:** HR_MyOrg
**Steps:**
1. Locate the Stalled Goals widget.

**Expected:**
- Shows goals that have been in Pending Approval for over N days (e.g. > 7 days).

---

### TC-HRD-009 — Mentor Coverage widget

**Login as:** HR_MyOrg
**Steps:**
1. Locate the Mentor Coverage widget.

**Expected:**
- Shows count of mentors and average mentees-per-mentor, OR a chart of mentor → mentee distribution.
- Identifies mentors with 0 mentees and staff with no mentor.

---

### TC-HRD-010 — FY picker switches all widgets

**Login as:** HR_MyOrg
**Steps:**
1. Note the current values across all widgets.
2. Change the FY picker to a different FY.

**Expected:**
- All widgets that depend on FY refresh together (single batched API call — should be fast).
- Numbers update for the new FY.

**UI checks:**
- FY picker is consistent in size/style with other dropdowns.
- Loading state shown while refetching.

---

### TC-HRD-011 — Widget click-through (if implemented)

**Login as:** HR_MyOrg
**Steps:**
1. On widgets that link to detail lists (e.g. Missing Annual Reviews), click an item or "View all".

**Expected:**
- Navigates to a filtered All Reviews / All Goals view pre-filtered to the matching slice.

---

### TC-HRD-012 — Empty-state dashboard

**Pre-condition:** A brand-new test org with no users/goals/reviews.
**Login as:** HR_MyOrg of that org
**Steps:**
1. Open the dashboard.

**Expected:**
- Widgets do NOT show "0" with confusing context — they show graceful empty states ("No data yet").
- Page does not crash or render NaN%.

---

## 5.2 Excel Exports

There are 8 export surfaces. Test each one.

### TC-EXP-001 — Export Users

**Login as:** HR_MyOrg
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

**Login as:** HR_MyOrg
**Steps:**
1. Open Annual Goals → All Goals.
2. Apply at least one filter (e.g. Year = current FY).
3. Click **Export**.

**Expected:**
- Excel file downloads with goals matching the current filter (filtered, not all).
- Columns include: Employee · Function · Designation · Goal Title · Description · Year · Mentor · Status · Created · (Self/Mentor Review status per half).

---

### TC-EXP-003 — Export Annual Reviews

**Login as:** HR_MyOrg
**Steps:**
1. Open Annual Reviews → All Reviews.
2. Click Export.

**Expected:** Excel with one row per review.

---

### TC-EXP-004 — Export Project Reviews

**Login as:** HR_MyOrg
**Steps:**
1. Open Project Reviews → All Reviews.
2. Click Export.

**Expected:** Excel with one row per project review; rating shown only if `project_ratings_visible` is ON for that report (or always present in HR exports — verify).

---

### TC-EXP-005 — Export Secondary Evaluations

**Login as:** HR_MyOrg
**Steps:**
1. Find the Secondary Evaluations export entry point (may be on Project Reviews → All Reviews or a dedicated page).
2. Export.

**Expected:** Excel with one row per secondary evaluation; submitted content visible.

---

### TC-EXP-006 — Export Mentor Coverage

**Login as:** HR_MyOrg
**Steps:**
1. From HR Dashboard's Mentor Coverage widget (or an admin page), click Export.

**Expected:** Excel with one row per mentor and their mentee count + list of mentees.

---

### TC-EXP-007 — Export Missing Annual Reviews

**Login as:** HR_MyOrg
**Steps:**
1. From the Missing Annual Reviews widget or All Reviews tab, click Export of the filtered subset.

**Expected:** Excel with one row per employee with no review for the selected FY.

---

### TC-EXP-008 — Export Stalled Goals

**Login as:** HR_MyOrg
**Steps:**
1. From the Stalled Goals widget or All Goals (filtered to Pending Approval older than N days), click Export.

**Expected:** Excel with one row per stalled goal.

---

### TC-EXP-009 — Export with no rows

**Login as:** HR_MyOrg
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

**Login as:** HR_MyOrg
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

**Login as:** HR_MyOrg
**Steps:**
1. Walk through every page that has an export button.

**UI checks:**
- Button is consistently placed on the right side of the filter toolbar (not in a new row, not floating).
- Button has consistent label and icon across pages.

---

## 5.3 Audit Log of Exports

### TC-AUDIT-001 — Open audit log

**Login as:** HR_MyOrg
**Steps:**
1. Navigate to the Audit Log page (may be under Admin → Audit, or its own sidebar item).

**Expected:** A table of audit entries showing: Actor · Action · Target · Timestamp.

---

### TC-AUDIT-002 — Export action is recorded

**Login as:** HR_MyOrg
**Steps:**
1. Perform an export (e.g. TC-EXP-001 Users export).
2. Refresh the audit log.

**Expected:**
- A new row appears with: Actor = your HR account · Action = "Exported Users" · Timestamp = just now.

---

### TC-AUDIT-003 — Filter audit log

**Login as:** HR_MyOrg
**Steps:**
1. Use Actor / Action / Date filters.

**Expected:** Each narrows the table.

---

### TC-AUDIT-004 — Audit log cannot be edited

**Login as:** HR_MyOrg
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
