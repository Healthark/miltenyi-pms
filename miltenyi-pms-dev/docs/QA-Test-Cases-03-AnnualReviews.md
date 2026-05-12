# QA Test Cases — Module 3: Annual Reviews

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Module 1 & 2 reviewed. Apply Module 1 §1.7 UI checklist on every screen.
> **Test accounts needed:** Staff, Mentor (with mentees who have draft+pending+completed reviews), HR_MyOrg.
> **Vocab:** Annual reviews flow through stages: **Draft → Pending Mentor → Pending Management → Completed**. Each stage has its own actor (Staff, Mentor, HR/Management).

---

## 3.1 My Reviews tab (Staff)

### TC-AREV-001 — Open My Reviews

**Login as:** Staff
**Steps:**
1. Open **Annual Reviews** from the sidebar.

**Expected:**
- Page header reads "Annual Reviews" (NOT "Team Reviews").
- Tab bar shows **My Reviews** (active by default).
- A row exists for the current FY even if you haven't started yet (synthesized row).
- The leftmost column is **Mentor** (your mentor's name).

**UI checks:**
- Top of the page does NOT have a "Start Self-Review" button (action lives on each row).
- Active FY is shown next to the page title (e.g. "· FY26-27").

---

### TC-AREV-002 — Synthesized current-FY row when no review exists

**Pre-condition:** Staff has no annual review for the current FY.
**Login as:** Staff
**Steps:**
1. Open My Reviews.

**Expected:**
- A single row appears for the current FY with:
  - Mentor's name in the Mentor column
  - Cycle: current FY (e.g. "FY26-27")
  - Status: a muted "Not started" badge
  - Action: a **Start Self-Review** button

---

### TC-AREV-003 — Start a new self-review

**Login as:** Staff
**Steps:**
1. Click **Start Self-Review** on the current-FY row.
2. A modal/page opens with the self-review form.
3. Fill in the required sections (overall reflection, achievements, etc.).
4. Click **Submit**.
5. Confirm in the dialog.

**Expected:**
- Status moves to **Pending Mentor**.
- Action button on the row changes to **View**.
- Toast: "Self-review submitted."

**UI checks:**
- Form fields are clearly labeled; required fields have an asterisk.
- Long sections allow multi-line input (textarea, not single-line).
- Submit button at the bottom; primary brand color; disabled until required fields are non-empty.

---

### TC-AREV-004 — Save Draft

**Login as:** Staff
**Steps:**
1. Start a new self-review.
2. Fill in partial content.
3. Click **Save Draft**.

**Expected:**
- Modal/page closes (or stays open with confirmation).
- Row's Action button now reads **Continue Draft**.
- Status badge reads **Draft**.

---

### TC-AREV-005 — Continue Draft

**Login as:** Staff (with a draft row)
**Steps:**
1. Click **Continue Draft**.
2. The existing draft content loads.
3. Edit; click Save Draft → reopens with new content.
4. Eventually click Submit.

**Expected:** Draft is preserved between sessions until submitted.

---

### TC-AREV-006 — Mentor column populated after Save Draft

**Pre-condition:** Use a test Staff (e.g. "Charlie") whose mentor is known.
**Login as:** that Staff
**Steps:**
1. Start a self-review and click Save Draft.
2. Observe the table row immediately after save.

**Expected:**
- The Mentor column still shows the mentor's name (does NOT flash empty).
- Refresh the page → mentor name is still there.

**(This validates a previous fix — bug regression test.)**

---

### TC-AREV-007 — View a completed review

**Login as:** Staff with at least one completed annual review
**Steps:**
1. Find a row whose status is **Completed**.
2. Click **View**.

**Expected:**
- A read-only modal/page opens.
- Shows your self-review content + mentor's review + final ratings.
- No edit controls; all sections read-only.

---

### TC-AREV-008 — FY filter

**Login as:** Staff with multiple FYs in history
**Steps:**
1. Use the **Fiscal Year** filter dropdown.
2. Select a past FY.

**Expected:** Only that FY's rows are shown. "All" resets.

---

### TC-AREV-009 — Status filter

**Login as:** Staff
**Steps:**
1. Use the Status filter.
2. Try each option: Not Started, Draft, Pending Mentor, Pending Management, Completed.

**Expected:** Each option narrows correctly.

---

### TC-AREV-010 — View mode toggle (cards/table)

**Login as:** Staff
**Steps:**
1. Switch to Cards → cards render with Mentor, FY, Status, Action.
2. Switch to Table → table renders the same columns.

**Expected:**
- Both views show identical content.
- Cards equal height in same row.

---

### TC-AREV-011 — Synthesized row vs real row in the same table

**Pre-condition:** Staff has a completed review for FY 2024–25, no review yet for current FY (2026–27).
**Login as:** Staff
**Steps:**
1. Open My Reviews.

**Expected:**
- Two rows appear: synthesized current FY (Start Self-Review action) and the completed FY 2024–25 (View action).
- Both rows have the same column layout.

**UI checks:**
- Synthesized row is not visually broken or styled differently.

---

## 3.2 Mentor Review stage

### TC-MREV-001 — Mentor sees pending-mentor queue

**Login as:** Mentor
**Steps:**
1. Open Annual Reviews → **Team Reviews** (or "My Mentees' Reviews") tab.
2. Filter Status = "Pending Mentor".

**Expected:** All mentee reviews where the staff has submitted their self-review (so it's now Mentor's turn) appear here.

---

### TC-MREV-002 — Open a pending mentor review

**Login as:** Mentor
**Steps:**
1. Click on a pending row → opens the mentor review modal/page.

**Expected:**
- Top section: mentee's self-review content (read-only).
- Below: mentor's input fields — rating(s) and comments.
- Save Draft and Submit buttons at the bottom.

**UI checks:**
- Read-only vs editable sections are visually distinct (e.g. different background).
- Modal is comfortably sized; no horizontal scroll.

---

### TC-MREV-003 — Save Draft as Mentor

**Login as:** Mentor
**Steps:**
1. Fill in partial mentor review.
2. Click Save Draft.

**Expected:** Status remains Pending Mentor; reopening loads your draft.

---

### TC-MREV-004 — Submit Mentor Review

**Login as:** Mentor
**Steps:**
1. Complete the mentor review form.
2. Click Submit → confirm.

**Expected:**
- Status moves to **Pending Management** (or "Pending HR" depending on the org's flow).
- The review is removed from the Mentor's pending queue.
- Mentee can see (read-only) the mentor's comments in their own My Reviews.

---

### TC-MREV-005 — Cannot edit submitted mentor review

**Login as:** Mentor
**Steps:**
1. Open a review now in Pending Management state.

**Expected:**
- View only — no edit controls.
- A note: "Awaiting management review."

---

## 3.3 Management Review stage

### TC-MGMTREV-001 — HR/Management sees pending-management queue

**Login as:** HR_MyOrg (acting as management)
**Steps:**
1. Open Annual Reviews → All Reviews (or a "Pending Management" tab).
2. Filter Status = "Pending Management".

**Expected:** All reviews that have passed mentor review and await final finalisation.

---

### TC-MGMTREV-002 — Finalise a review

**Login as:** HR_MyOrg
**Steps:**
1. Open a Pending Management review.
2. Set final rating(s) (per the org's rating system).
3. Add closing remarks.
4. Click **Finalize** (or **Complete**).
5. Confirm.

**Expected:**
- Status moves to **Completed**.
- Toast: "Review completed."
- Both Staff and Mentor can now see the completed review (read-only).

---

### TC-MGMTREV-003 — Cannot revert completed review (or has restricted unlock)

**Login as:** HR_MyOrg
**Steps:**
1. Open a Completed review.

**Expected:**
- Either the review is fully locked (no edit), OR
- An "Unlock" / "Reopen" action exists but requires a confirmation modal.

(Validate the expected behavior with the product team.)

---

## 3.4 All Reviews tab (HR)

### TC-ALLREV-001 — Open All Reviews

**Login as:** HR_MyOrg
**Steps:**
1. Open Annual Reviews → All Reviews.

**Expected:** Org-wide table of every annual review (every FY, every employee).

**UI checks:**
- Columns include: Employee · Function · Designation · FY · Mentor · Status · (Rating if visible).
- Filters and search are on the same row, not separate stacked sections.

---

### TC-ALLREV-002 — Filter combinations

**Login as:** HR_MyOrg
**Steps:**
1. Combine: Employee combobox + FY filter + Function + Designation + Mentor + Status.

**Expected:** Each filter narrows the table; AND logic applies. "Clear all" (if present) resets every filter.

---

### TC-ALLREV-003 — Search

**Login as:** HR_MyOrg
**Steps:**
1. Type part of an employee name in the search box.

**Expected:** Live filter applies.

**UI check:** Search box and filter dropdowns are on the same row, evenly spaced.

---

### TC-ALLREV-004 — Sort columns

**Login as:** HR_MyOrg
**Steps:**
1. Click Employee header → A-Z sort.
2. Click Status header → status-alphabetical sort.

**Expected:** Arrow indicator shows only on the active column.

---

### TC-ALLREV-005 — Export

**Login as:** HR_MyOrg
**Steps:**
1. Click **Export** on All Reviews.

**Expected:** Excel file downloads with one row per review and key columns (refer to Module 5 §5.2).

---

### TC-ALLREV-006 — Open a review from HR view

**Login as:** HR_MyOrg
**Steps:**
1. Click on a review row in All Reviews.

**Expected:**
- Read-only detail opens showing self-review + mentor review + management remarks.
- Rating visibility honors `project_ratings_visible` (if applicable to annual reviews) — confirm with product team.

---

## 3.5 Annual Reviews — Cross-checks

- Refer to **Module 1 §1.7** UI checklist on every screen.
- After every submission (self/mentor/management), refresh the page → state persists.
- The Mentor column on Staff My Reviews must NEVER show "—" if a mentor is assigned.
- Date formatting must read as "FY26-27" or "FY 2026–27", consistent everywhere.
- Test in three browser widths: narrow / medium / wide.

---

**End of Module 3.** Next: Module 4 — Project Reviews.
