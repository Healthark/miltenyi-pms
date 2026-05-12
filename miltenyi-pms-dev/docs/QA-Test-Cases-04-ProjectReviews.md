# QA Test Cases — Module 4: Project Reviews

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Module 1 reviewed. Apply Module 1 §1.7 UI checklist on every screen.
> **Test accounts needed:** PM (assigned to projects with staff), Secondary Evaluator (assigned to projects), Staff (on projects), Mentor, HR_MyOrg.
> **Vocab:** A project review is opened by HR/system → **Pending → Draft → Reviewed**. The PM writes the main review; a Secondary Evaluator writes a peer/cross-check review separately. Ratings are 1–5 where **lower = better** (1 best, 5 worst).

---

## 4.1 PM Evaluation tab

### TC-PMR-001 — Open PM Evaluation queue

**Login as:** PM (assigned to active projects with staff)
**Steps:**
1. Open **Project Reviews** from the sidebar.
2. Default tab should be **PM Evaluation**.

**Expected:**
- A list of pending project reviews assigned to this PM.
- Each row shows: Employee · Project (name + code) · Cycle · Status.

**UI checks:**
- Project code is monospace and visually distinct from name.
- Status badge color matches Pending elsewhere (amber).

---

### TC-PMR-002 — Open a pending review

**Login as:** PM
**Steps:**
1. Click on a pending row OR click **Write Review** action.

**Expected:**
- The full evaluation form opens (modal or page).
- Form sections:
  - 7 competency comment fields (Task Execution, Ownership, Project Management, Client Deliverables, Communication, Mentoring, Competency & Skills)
  - Project Rating selector (1–5)
  - Impact Statement textarea

**UI checks:**
- Each competency block has a clear label and a multi-line textarea.
- Rating selector is clearly a 1–5 pick (radio buttons or pill group).
- A hint near the rating reads "Lower is better (1 = best)".

---

### TC-PMR-003 — Save Draft on PM review

**Login as:** PM
**Steps:**
1. Fill in 2–3 competency fields.
2. Click **Save Draft**.

**Expected:**
- Toast: "Draft saved."
- Status badge on the row changes to **Draft**.
- Action button on that row now reads **Continue Draft**.

---

### TC-PMR-004 — Continue Draft

**Login as:** PM
**Steps:**
1. Click **Continue Draft** on a draft row.

**Expected:** Existing content reloads. You can edit and save or submit.

---

### TC-PMR-005 — Submit a PM review

**Login as:** PM
**Steps:**
1. Complete all required fields and the rating.
2. Click **Submit**.
3. Confirm in the dialog.

**Expected:**
- Status moves to **Reviewed**.
- Row's action changes to **Edit** (or **View** — verify with product).
- Toast: "Review submitted."

---

### TC-PMR-006 — Cannot submit without rating

**Login as:** PM
**Steps:**
1. Fill competency fields but DO NOT pick a rating.
2. Click Submit.

**Expected:** Validation error: "Please select a project rating." Form stays open.

---

### TC-PMR-007 — Edit a submitted review

**Login as:** PM
**Steps:**
1. Open a Reviewed row → click **Edit**.

**Expected:**
- Form opens pre-filled with the submitted content.
- Save / Cancel options at the bottom.
- An "Editing" badge or similar indicator is visible in the header.

---

### TC-PMR-008 — Filters

**Login as:** PM
**Steps:**
1. Use Employee combobox + Project combobox + Cycle + Status filters.

**Expected:** AND logic; row count caption updates.

**UI checks:**
- Both comboboxes are typeable with live suggestions.

---

### TC-PMR-009 — View mode toggle

**Login as:** PM
**Steps:**
1. Switch to Cards view → grid of cards.
2. Switch to Table view → table.

**Expected:** Both views render the same dataset.

---

## 4.2 Secondary Evaluation tab

### TC-SEC-001 — Open Secondary Evaluation tab

**Login as:** Secondary Evaluator (a user assigned as `secondary_evaluator_id` on at least one project)
**Steps:**
1. Open Project Reviews → **Secondary Evaluation** tab.

**Expected:**
- A list of reviews where you're the secondary.
- Each row shows: Employee · Project (name + code) · Cycle · Status.
- Three possible statuses: **Pending**, **Draft**, **Submitted**.

**UI checks:**
- "Pending" badge: amber.
- "Draft" badge: amber-filled.
- "Submitted" badge: green.

---

### TC-SEC-002 — Filters (Employee / Project / Cycle / Status)

**Login as:** Secondary Evaluator
**Steps:**
1. Use each filter; verify AND logic.
2. Confirm **Draft** is one of the options in the Status filter.

**Expected:** Filter narrows; "All" resets each.

---

### TC-SEC-003 — Write a new secondary review

**Login as:** Secondary Evaluator
**Steps:**
1. On a Pending row, click **Write Review**.

**Expected:**
- Modal opens. Title is "Secondary Feedback".
- Subtitle: "Write your perspective on the staff's contribution to this project."
- A single textarea labeled **Review** (NOT "Impact Statement").
- Save Draft and Submit buttons at the bottom.

**UI checks:**
- Modal width is around max-w-2xl (comfortable).
- Textarea is at least 8 rows tall.

---

### TC-SEC-004 — Save Draft as Secondary

**Login as:** Secondary Evaluator
**Steps:**
1. Type a partial review.
2. Click **Save Draft**.

**Expected:**
- Toast: "Draft saved."
- Modal stays open, with a "Draft" badge in the header bar.
- Row status changes to **Draft** in both card and table views.
- Action button on that row now reads **Continue Draft** (amber-styled).

**UI checks:**
- Draft card has amber tint background; clear distinction from Pending and Submitted cards.
- Draft preview text on the card is line-clamped to 3 lines.

---

### TC-SEC-005 — Continue Draft

**Login as:** Secondary Evaluator
**Steps:**
1. Click **Continue Draft**.

**Expected:** Existing draft text reloads. Save Draft button is still available; Submit button is enabled.

---

### TC-SEC-006 — Submit Secondary Review

**Login as:** Secondary Evaluator
**Steps:**
1. With the draft loaded (or starting fresh), click **Submit**.

**Expected:**
- Modal closes.
- Row swaps to Submitted (green badge) in both views.
- Action becomes **Edit**.
- Toast: "Review submitted."

---

### TC-SEC-007 — Edit a Submitted review

**Login as:** Secondary Evaluator
**Steps:**
1. On a Submitted row, click **Edit**.

**Expected:**
- Modal opens with an "Editing" badge.
- Save Draft button is hidden (because the review is already submitted).
- Submit button reads **Save Changes**.

---

### TC-SEC-008 — Cannot submit empty review

**Login as:** Secondary Evaluator
**Steps:**
1. Open a Pending row.
2. Leave the textarea empty.
3. Click Submit.

**Expected:** Submit button is disabled until the textarea has non-whitespace content.

---

### TC-SEC-009 — Card view three-way rendering

**Login as:** Secondary Evaluator
**Steps:**
1. Switch to Cards view.
2. Compare cards for Pending vs Draft vs Submitted reviews.

**Expected:**
- Pending: amber "Pending" badge; **Write Review** button.
- Draft: amber-filled "Draft" badge; **Continue Draft** button; draft preview (line-clamped).
- Submitted: green "Submitted" badge; **Edit** button; submitted review preview (line-clamped).

**UI checks:**
- All three card variants use the same width and minimum height.
- Background tint differs subtly so the state is recognisable at a glance.

---

### TC-SEC-010 — Table view three-way rendering

**Login as:** Secondary Evaluator
**Steps:**
1. Switch to Table view.

**Expected:**
- Status column shows three distinct badges (Pending, Draft, Submitted).
- Action column shows three distinct buttons (Write Review, Continue Draft, Edit).

---

## 4.3 Team Reviews tab (Mentor view)

### TC-TR-001 — Open Team Reviews

**Login as:** Mentor (assigned mentees who are on projects)
**Steps:**
1. Open Project Reviews → **Team Reviews** tab.

**Expected:**
- A list of project reviews for the mentor's mentees.
- Each row shows: Employee · Project · Cycle · Rating (or Hidden) · Status.

---

### TC-TR-002 — View a Reviewed row's full content

**Login as:** Mentor
**Steps:**
1. On a row with status **Reviewed**, click the **View** action.

**Expected:**
- A read-only modal opens.
- Header: project name + code, employee name, cycle, PM name.
- **Project Rating** row: shows label + the rating badge inline (no star icon, no chunky row).
- **PM's Competency Feedback** section: a 2-column grid of competency cards, each with label + comment.
- **PM's Impact Statement** section (if non-empty): blue-tinted block.
- **Secondary Impact Statements** section (if any are submitted): green-tinted blocks, one per evaluator.

**UI checks:**
- Modal width is max-w-5xl (wider than usual).
- 2-column grid switches to 1-column on narrow screens.
- Each competency card has clear label and wrapped comment.
- Text is slightly smaller than the regular body (≈ 12px) — but still readable.

---

### TC-TR-003 — Rating hidden honors org setting

**Pre-condition:** HR_MyOrg toggles **project_ratings_visible** to OFF in Settings.
**Login as:** Mentor
**Steps:**
1. Open Team Reviews → click View on a Reviewed row.

**Expected:**
- Project Rating row reads **"Hidden"** with a lock icon.
- The badge is replaced.

**Then:** HR toggles back to ON, refresh → badge reappears.

---

### TC-TR-004 — Pending PM placeholder

**Login as:** Mentor
**Steps:**
1. Find a row where the PM has not submitted their review yet.

**Expected:** Action area shows "Awaiting PM" (or similar) — no View button.

---

### TC-TR-005 — Filters and sort

**Login as:** Mentor
**Steps:**
1. Use Employee + Project + Status + Cycle filters.
2. Sort by columns.

**Expected:** Each filter narrows; sort indicator works as in other tables.

---

## 4.4 All Reviews tab (HR)

### TC-ALLPR-001 — Open All Reviews

**Login as:** HR_MyOrg
**Steps:**
1. Open Project Reviews → **All Reviews**.

**Expected:** Org-wide table of every project review.

**UI checks:** Filter row layout matches Team Reviews; search/filter/sort consistent.

---

### TC-ALLPR-002 — View any row

**Login as:** HR_MyOrg
**Steps:**
1. Click on any Reviewed row.

**Expected:** Same read-only modal as Team Reviews (TC-TR-002).

---

### TC-ALLPR-003 — Export

**Login as:** HR_MyOrg
**Steps:**
1. Click **Export** on All Reviews.

**Expected:** Excel file downloads with one row per review and columns matching what HR sees.

---

## 4.5 Edge cases

### TC-PR-EDGE-001 — PM is also a Mentor

**Pre-condition:** A user has both PM and Mentor roles for different projects/mentees.
**Login as:** that user
**Steps:**
1. Open Project Reviews → tabs should show both PM Evaluation and Team Reviews.
2. Confirm reviews under each tab match their role for that record.

---

### TC-PR-EDGE-002 — Staff assigned as their own secondary evaluator (should not happen)

**Pre-condition:** Try to assign a staff as a secondary on a project where they're also the reviewed party.

**Expected:** The system should reject this combination — either in the project setup or when generating reviews. If it does happen, the staff should not see their own review in Secondary Evaluation.

---

### TC-PR-EDGE-003 — Project with no PM assigned

**Pre-condition:** A project missing `pm_id`.
**Expected:** Project should not generate project reviews (or HR receives a warning). If reviews exist anyway, they should not break the PM Evaluation queue.

---

## 4.6 Cross-checks

- Refer to **Module 1 §1.7** UI checklist on every screen.
- Confirm "Review" labeling everywhere (no "Impact Statement" anywhere user-facing in the Secondary tab).
- Modal sizes: PM eval (large), Secondary eval (max-w-2xl), Team Reviews detail (max-w-5xl), Goal review detail (max-w-3xl).
- Drafts persist between sessions; refreshing the page does NOT lose draft content.

---

**End of Module 4.** Next: Module 5 — HR-only features.
