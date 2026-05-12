# QA Test Cases — Module 2: Annual Goals

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** You have completed Module 1 (Foundational). Refer back to Module 1 §1.7 for the cross-cutting UI checklist — apply it on every screen here too.
> **Test accounts needed:** Staff (with mentor), Staff (no mentor), Mentor (with mentees), HR_MyOrg.
> **Vocab:** A *goal* moves through these states — **Draft → Pending Approval → Approved → H1/H2 Self-Reviewed → H1/H2 Mentor-Reviewed** (or Q1..Q4 in quarterly orgs). It can also be sent back as **Changes Requested**.

---

## 2.1 My Goals tab (Staff)

### TC-GOAL-001 — Open My Goals tab

**Login as:** Staff
**Steps:**
1. Open **Annual Goals** from the sidebar.
2. Default tab should be **My Goals**.

**Expected:**
- Page header reads "Team Goals" or "Annual Goals" with the active FY (e.g. "· FY26-27") in muted text next to it.
- A short subtitle below the header explains the page.
- An **Add Goal** button is in the top-right (only when the goal-edit gate is open AND you have a mentor).
- A "Reference your role expectations…" banner appears with a **View Role Expectations** button.

**UI checks:**
- Header and Add Goal button are vertically centered with each other.
- The role-expectations banner does not stretch edge-to-edge; it has padding inside.
- If you have no goals yet, you see a friendly empty state with a target icon and the message "No goals yet".

---

### TC-GOAL-002 — Add Goal button hidden when no mentor

**Login as:** Staff who does NOT have a mentor assigned
**Steps:**
1. Open Annual Goals → My Goals.

**Expected:**
- The Add Goal button is REPLACED by a locked banner: "No mentor assigned — goal creation is disabled."
- The banner has a lock icon.

**UI checks:**
- Lock icon is the same height as the banner text.
- Banner uses muted/gray styling (not red, not green — it's informational).

---

### TC-GOAL-003 — Add Goal button hidden when edit gate closed

**Pre-condition:** HR_MyOrg toggles **Annual goals edit enabled** to OFF in Settings.
**Login as:** Staff (with a mentor)
**Steps:**
1. Open Annual Goals → My Goals.

**Expected:**
- Add Goal button is REPLACED by an amber banner: "Goal submissions are currently closed."
- The banner has a lock icon.

**UI checks:**
- Amber/yellow color (distinct from the gray "no mentor" banner).

---

### TC-GOAL-004 — Create a new goal

**Pre-condition:** Goal edit gate is ON, you have a mentor.
**Login as:** Staff
**Steps:**
1. Click **Add Goal**.
2. A modal opens.
3. Fill in:
   - Title (required) — e.g. "Improve assay turnaround time"
   - Description (optional)
   - Attachment URL (optional)
   - Add 2–3 criteria (each requires a title)
4. Click **Save** (or **Create**).

**Expected:**
- Modal closes.
- Success toast appears.
- New goal appears at the top of My Goals (most-recent first).
- Status badge reads **Draft** (gray).
- Progress shows 0%.

**UI checks on the modal:**
- Modal is horizontally and vertically centered.
- Title field has a clear asterisk indicating required.
- Save and Cancel buttons are at the bottom-right; Cancel left of Save.
- Criteria section lets you add multiple rows with a "+ Add criterion" button — each row aligned consistently.

---

### TC-GOAL-005 — Save validation — empty title

**Login as:** Staff
**Steps:**
1. Click Add Goal.
2. Leave Title blank.
3. Click Save.

**Expected:**
- Save does not proceed.
- An inline error appears under the Title field: "Title is required."
- The modal stays open.

---

### TC-GOAL-006 — Edit a draft goal

**Login as:** Staff
**Steps:**
1. On a goal with **Draft** status, click the **Edit** icon (or the goal title in card view).
2. Change the title or description.
3. Save.

**Expected:**
- Goal updates inline; success toast.
- Status remains Draft.

**UI checks:**
- Edit modal pre-fills with the existing values; criteria show in the order they were created.

---

### TC-GOAL-007 — Cannot edit a non-draft goal

**Login as:** Staff
**Steps:**
1. Find a goal whose status is **Pending Approval** or **Approved**.
2. Look for the Edit button.

**Expected:**
- Edit button is absent (or disabled) for these statuses.
- Hovering a disabled button (if present) shows a tooltip "Goal is locked".

---

### TC-GOAL-008 — Submit a draft for approval

**Login as:** Staff
**Steps:**
1. On a Draft goal, click **Request Approval** (or **Submit**).
2. A confirmation dialog appears: "Submit goal for approval?"
3. Click **Submit**.

**Expected:**
- Status badge updates to **Pending Approval** (amber/yellow).
- Edit and Request-Approval buttons disappear.
- A small note "Awaiting review…" appears in the action area.

**UI checks:**
- Confirm dialog is centered with clear primary (Submit) and secondary (Cancel) buttons.
- Pending Approval badge color matches every other "pending" badge in the app.

---

### TC-GOAL-009 — Goal in Changes Requested state

**Pre-condition:** Mentor sent a goal back (see TC-MENT-002 in Mentor section). The goal status is now **Changes Requested** and `manager_feedback` is filled.
**Login as:** Staff
**Steps:**
1. Open My Goals.
2. Find the goal whose status is Changes Requested.

**Expected:**
- Status badge is amber/red **Changes Requested**.
- Edit button is enabled again.
- The mentor's feedback is visible — either inline in the row (expanded view) or in the goal card.

**UI checks:**
- Feedback is in a tinted box (amber/red 50) with a message icon.
- Feedback text wraps; does not overflow the card or row.

---

### TC-GOAL-010 — Resubmit after changes

**Login as:** Staff
**Steps:**
1. On a Changes Requested goal, click Edit.
2. Change the title or description.
3. Save → status returns to Draft.
4. Click Request Approval → status moves to Pending Approval again.

**Expected:** Goal can cycle through draft → pending again. Mentor's previous feedback is preserved (visible in the goal's history if available).

---

### TC-GOAL-011 — Approved goal shows criteria checklist

**Login as:** Staff
**Steps:**
1. Find an Approved goal.
2. Expand it (click the row to expand in table view, or look at the card).

**Expected:**
- Status badge reads **Approved** (green).
- All criteria are listed.
- Each criterion has a checkbox to mark complete.
- Progress percent recomputes when you check/uncheck a criterion.

**UI checks:**
- Checkbox is properly aligned with criterion text.
- Progress bar updates smoothly without flicker.
- Completed criteria are visually distinct (struck-through or muted).

---

### TC-GOAL-012 — Attachment link opens externally

**Login as:** Staff
**Steps:**
1. On a goal with an attachment URL (one you set during creation), click the **Attachment** link.

**Expected:**
- Opens in a new browser tab.
- Original app tab is preserved.

---

### TC-GOAL-013 — Year filter

**Pre-condition:** You have goals across multiple FYs.
**Login as:** Staff
**Steps:**
1. Use the **Year** dropdown filter.
2. Select a specific year (e.g. "FY 2026–27").

**Expected:** Only goals matching that FY are shown.

**Then:** Select "All Years" → table resets.

**UI checks:** Year dropdown options use the human format "FY 2026–27", not the raw `2026`.

---

### TC-GOAL-014 — Status filter

**Login as:** Staff
**Steps:**
1. Use the Status dropdown.
2. Select "Draft" → only Draft goals shown.
3. Try each option: Pending Approval, Changes Requested, Approved, H1 Self-Reviewed, H1 Mentor-Reviewed, H2 Self-Reviewed, H2 Mentor-Reviewed.

**Expected:** Each filter narrows the list correctly. "All" resets.

---

### TC-GOAL-015 — Search

**Login as:** Staff
**Steps:**
1. Type part of a goal title in the search box.

**Expected:** Live filter — only matching goals remain.

---

### TC-GOAL-016 — Toggle Card / Table view

**Login as:** Staff
**Steps:**
1. Switch to **Cards** view.
2. Switch to **Table** view.

**Expected:**
- Both views show the same goals after filtering.
- View preference might persist on the page (acceptable either way).

**UI checks:**
- Card view: cards are equal height in the same row; the layout uses a 3-column grid on wide screens, 2 on medium, 1 on narrow.
- Table view: columns are Goal / Mentor / Year / Status / Actions; sortable headers are clickable.

---

### TC-GOAL-017 — Sort columns (table view)

**Login as:** Staff
**Steps:**
1. Click the **Goal** column header → rows sort alphabetically.
2. Click again → reverse order.
3. Click **Year** → numeric sort.
4. Click **Status** → alphabetical by status.

**Expected:** Sort indicator (arrow) appears only on the active column.

---

### TC-GOAL-018 — Expand a goal row (table view)

**Login as:** Staff
**Steps:**
1. Click on a goal row.

**Expected:**
- Row expands to show description, attachment link, mentor feedback (if any), and criteria checklist.
- The chevron icon rotates 180°.

**UI checks:**
- Expanded content is indented under the row, not breaking column alignment of OTHER rows.
- Chevron rotation animates smoothly.

---

### TC-GOAL-019 — Self-review menu appears on approved goals

**Pre-condition:** A goal is in **Approved** state and you're inside the H1 window.
**Login as:** Staff
**Steps:**
1. Look at the action area of the approved goal.

**Expected:** A "Self-Review" cycle menu (dropdown or button group) is visible offering **H1** and possibly **H2** (depending on the current half).

**UI checks:**
- Menu options are clearly labeled with the half AND year (e.g. "H1 FY 2026–27").

---

## 2.2 Team Goals tab (Mentor)

### TC-MENT-001 — Open Team Goals tab

**Login as:** Mentor
**Steps:**
1. Open Annual Goals.
2. Default tab is **Team Goals**.

**Expected:**
- A table or grid of mentees' goals is shown.
- Each row includes: mentee name, goal title, year, status.

**UI checks:**
- Mentee name is in the same column position as **Goal** in the Staff view — alignment is consistent across roles.

---

### TC-MENT-002 — Approve a pending goal

**Login as:** Mentor
**Steps:**
1. Find a goal with status **Pending Approval**.
2. Click the action button → **Approve** (or open the goal card → Approve).
3. Confirm in the dialog.

**Expected:**
- Status updates to **Approved**.
- Success toast.
- Approved-at timestamp is recorded (visible in expanded view or details).

---

### TC-MENT-003 — Request changes with feedback

**Login as:** Mentor
**Steps:**
1. Find a Pending Approval goal.
2. Click **Request Changes**.
3. A feedback modal opens.
4. Type a clear message (e.g. "Please add a deadline to criterion #2.").
5. Click Submit.

**Expected:**
- Status updates to **Changes Requested**.
- Mentee sees this feedback when they next open the goal (TC-GOAL-009).

**UI checks:**
- Feedback textarea is comfortably sized (multiple lines, resizable or generous).
- Submit button is disabled until you've typed some feedback.

---

### TC-MENT-004 — Bulk approve

**Pre-condition:** Multiple goals are in Pending Approval.
**Login as:** Mentor
**Steps:**
1. Select 2–3 goals via checkboxes in the table.
2. Click **Bulk Approve**.
3. Confirm.

**Expected:**
- All selected goals move to Approved.
- A summary toast or snackbar notes how many succeeded.
- If any failed (e.g. one was already moved by another window), the snackbar lists each failure with a reason.

**UI checks:**
- Bulk Approve button is hidden until at least one row is selected.
- Button is on the right side of the toolbar; doesn't shift layout when it appears.

---

### TC-MENT-005 — Mentor review (H1)

**Pre-condition:** A mentee has submitted their H1 self-review on an approved goal.
**Login as:** Mentor
**Steps:**
1. Find the goal in Team Goals.
2. Open the goal; locate the Mentor Review section for H1.
3. Read the mentee's H1 self-review.
4. Click **Write Mentor Review** for H1.
5. Type your review.
6. Click **Save Draft** → confirm a draft saved.
7. Reopen the same goal — draft is preserved.
8. Edit the draft → click **Submit**.

**Expected:**
- Status moves to **H1 Mentor-Reviewed**.
- Mentee sees the mentor review next time they open the goal.

**UI checks:**
- Modal shows mentee's self-review (read-only) above your textarea — visually distinct sections.
- Role-expectations side panel (if present) is collapsible.

---

### TC-MENT-006 — Filter mentees and search

**Login as:** Mentor
**Steps:**
1. Use the search box to type a mentee's name → table filters.
2. Combine with a Status filter → AND logic applies.

---

## 2.3 All Goals tab (HR_MyOrg)

### TC-ALLGOAL-001 — Open All Goals tab

**Login as:** HR_MyOrg
**Steps:**
1. Open Annual Goals → All Goals.

**Expected:**
- A table of employees who have any goal (drafts excluded).
- Columns: **Employee · Function · Designation · Year · Mentor**.
- A row count caption like "9 employees · 14 of 14 goals".

**UI checks:**
- Columns are aligned consistently across rows.
- The export button is in its own column on the right.

---

### TC-ALLGOAL-002 — Expand an employee row

**Login as:** HR_MyOrg
**Steps:**
1. Click on an employee row.

**Expected:**
- Row expands; a brand-tinted sub-header appears with columns **Goal · Description · Status · Action**.
- Each goal under the employee is numbered `1.`, `2.`, `3.` …
- A left ribbon visually attaches the expanded block to the employee row.

**UI checks:**
- Sub-header columns align under the parent columns (Goal under Employee, Description spans Function+Designation, Status under Year, Action under Mentor).
- Description wraps to multiple lines if long, never cuts off.
- Brand-tinted background reads as clearly a "child" of the employee row.

---

### TC-ALLGOAL-003 — Filters

**Login as:** HR_MyOrg
**Steps:**
1. Try each filter individually: Employee (typeable combobox), Year, Function, Designation, Status.
2. Combine filters → AND logic applies.

**Expected:** Row count caption updates with each filter change.

**UI checks:**
- Employee combobox is typeable; matching suggestions appear as you type.
- Combobox results scroll if more than ~8 items.

---

### TC-ALLGOAL-004 — View modal for a goal with reviews

**Pre-condition:** At least one goal has a submitted self-review and/or mentor review.
**Login as:** HR_MyOrg
**Steps:**
1. Expand the employee.
2. On a goal with reviews, click **View**.

**Expected:**
- A read-only modal opens showing:
  - Goal title + owner + FY + mentor in the header.
  - Status badge.
  - Description.
  - For each cycle half (H1 / H2 or Q1..Q4) with content:
    - **Self-Review** — blue-tinted block.
    - **Mentor Review** — green-tinted block.
- Halves without either review are skipped — not shown as empty.
- Draft reviews are hidden (HR sees only submitted content).

**UI checks:**
- Modal is wider than the goal-create modal (≈ 3xl) for readability.
- Sections have clear spacing between them.
- Close X is in the top-right.
- ESC and clicking the dark backdrop close the modal.

---

### TC-ALLGOAL-005 — Goal without reviews shows dash

**Login as:** HR_MyOrg
**Steps:**
1. Expand an employee; find a goal that's only in Draft/Pending/Approved (no reviews yet).

**Expected:**
- Action column shows `—` (em dash), not a View button.

---

### TC-ALLGOAL-006 — Export Goals to Excel

**Login as:** HR_MyOrg
**Steps:**
1. Click the **Export** button on the All Goals tab.
2. Excel file downloads.

**Expected:** File opens cleanly in Excel/Sheets with one row per goal and columns matching what HR sees in the table (plus reviews if exported).

**Refer to Module 5 §5.2 for full export test cases.**

---

## 2.4 Goal Self-Review

### TC-SELFREV-001 — Open Self-Review modal (H1)

**Pre-condition:** A goal is **Approved**.
**Login as:** Staff
**Steps:**
1. On the approved goal, choose **H1** from the self-review menu.
2. Modal opens.

**Expected:**
- Modal title reads "Self-Review · H1 FY 2026–27" (or current FY).
- A single freeform textarea is present.

**UI checks:**
- Textarea is at least 6 rows tall.
- Modal width is comfortable (around max-w-xl).
- Save Draft and Submit buttons at the bottom-right.

---

### TC-SELFREV-002 — Save Draft

**Login as:** Staff
**Steps:**
1. Type a partial reflection.
2. Click **Save Draft**.

**Expected:**
- Success toast: "Draft saved."
- Modal stays open with a "Draft" badge in the title bar.
- Submit button remains enabled.

---

### TC-SELFREV-003 — Submit Self-Review

**Login as:** Staff
**Steps:**
1. With the modal still open and the draft text in place, click **Submit**.
2. Confirm in the dialog.

**Expected:**
- Modal closes.
- Goal status updates to **H1 Self-Reviewed**.
- Success toast.
- The self-review is now locked — opening it again shows it read-only.

---

### TC-SELFREV-004 — Re-opening a submitted self-review

**Login as:** Staff
**Steps:**
1. Re-open the H1 self-review from the goal.

**Expected:**
- Textarea is read-only (or replaced with a static paragraph).
- Save Draft / Submit are hidden or disabled.
- A note says "Submitted on <date>".

---

### TC-SELFREV-005 — H2 unlocks after H2 calendar window opens (or override is ON)

**Pre-condition:** Currently in H1 calendar window, no override.
**Login as:** Staff
**Steps:**
1. Look at the self-review menu options on an approved goal.

**Expected:**
- H1 is enabled.
- H2 is hidden or shows "Available after Oct 1" (or similar).

**Then:** HR_MyOrg toggles **cycle_window_override** ON; Staff refreshes → both H1 and H2 are now available.

---

## 2.5 Goal Mentor-Review

### TC-MENTREV-001 — Mentor reads mentee's self-review

**Pre-condition:** Mentee has submitted an H1 self-review.
**Login as:** Mentor
**Steps:**
1. Open the goal in Team Goals.
2. Locate the H1 review section.

**Expected:** The mentee's self-review is visible (read-only) to the mentor.

---

### TC-MENTREV-002 — Mentor writes H1 review

**Login as:** Mentor
**Steps:**
1. Click **Write Mentor Review** for H1.
2. Type a review.
3. Save Draft → reopen → Submit.

**Expected:**
- Status moves to **H1 Mentor-Reviewed**.
- Mentee sees the review in their goal.

**UI checks:**
- Role-expectations reference panel (if present) is collapsed by default; toggle expands/collapses it.
- Modal does not become too tall on small screens — it scrolls inside itself.

---

### TC-MENTREV-003 — Mentor cannot review before mentee submits self-review

**Login as:** Mentor
**Steps:**
1. Find a goal that's Approved but the mentee has NOT submitted H1 self-review yet.

**Expected:**
- Mentor cannot start the H1 mentor review (button disabled or hidden, with a note "Awaiting mentee's self-review").

---

## 2.6 Annual Goals — Cross-checks

- Refer to **Module 1 §1.7** UI checklist for every screen in this module.
- All success operations show a green toast; all failures show a red toast.
- After every state change (submit, approve, reject, save-draft), refresh the page and confirm the change persisted.
- Test in three browser widths: narrow / medium / wide.

---

**End of Module 2.** Next: Module 3 — Annual Reviews.
