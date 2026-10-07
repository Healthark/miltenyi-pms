# QA Test Cases — Module 2: Annual Goals

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** You have completed Module 1 (Foundational). Refer back to Module 1 §1.7 for the cross-cutting UI checklist — apply it on every screen here too.
> **Test accounts needed:** Staff (with mentor), Staff (no mentor), Mentor (with mentees), Admin.
> **Vocab:** A *goal* moves through **Draft → Pending Approval → Approved → H1/H2 Self-Reviewed → H1/H2 Mentor-Reviewed**. The mentor can send it back as **Changes Requested**. Ratings are not on this page; the year's rating is given on Annual Reviews.
> **Rewritten 7 Oct 2026.** Annual goals now use the Project Goals table layout: **one goal per person per year in one row** (every goal for the year is written in that row), an **H1 / H2 selector** for the two review columns, and for mentors and the Admin a **roster** with one row per person that opens the same table. The old cards, filters, Add Goal button and pop-up forms are gone, and their test cases are retired.

---

## 2.1 My Goal (Staff)

### TC-GOAL-001 — Open the page with no goal yet

**Login as:** Staff (with a mentor; goal entry open for the year)
**Steps:** Open **Annual Goals** from the sidebar.

**Expected:**
- Header "Annual Goals · CY 26-27" with a subtitle. A **Goal year** dropdown appears only when there is more than one year.
- One tab, **My Goal · CY 26-27**. Above the table: "Goal · CY 26-27", a grey **Not started** badge and a **View role expectations** button.
- An info notice: "Write **all** of your goals for CY 26-27 in this one row…".
- The table has three columns: **Goal** (marked *editing*, with Title, Your goals for the year and Link · optional), **Self review** ("Opens once the goal is approved") and **Mentor review** ("After approval").
- The table footer reads "One goal per person per year. The year's rating is given on the Annual Reviews page."
- Below the table: **Save draft** and **Submit for approval**.

---

### TC-GOAL-002 — No mentor assigned

**Login as:** Staff who does NOT have a mentor
**Expected:** An amber notice "No mentor is assigned to you yet, so you can't set your annual goal. Ask the Admin to assign one." No table and no buttons.

---

### TC-GOAL-003 — Goal entry closed

**Pre-condition:** Admin turns **Edit Access for Annual Goals** OFF for the year (System Settings).
**Login as:** Staff (with a mentor)
**Expected:**
- With no goal: amber notice "Annual goal entry for CY 26-27 is closed. The Admin opens it in System Settings." No table.
- With a saved draft: the goal shows read-only with "Your goal is still a draft, but goal entry for CY 26-27 is closed…".

---

### TC-GOAL-004 — Write and save a draft

**Steps:**
1. Type a title.
2. In **Your goals for the year**, write several goals; use the bullet button (or start lines with `- `) and bold one phrase.
3. Click **Save draft**. Refresh the page.

**Expected:**
- Toast "Draft saved"; the badge reads **Draft**; your text is still there after the refresh.
- The notice and the Mentor review column now name your mentor.
- **Save draft** stays disabled until there is a title (tooltip "Give the goal a title first"); **Submit for approval** needs a title and your goals.

---

### TC-GOAL-005 — Link must be a web address

**Steps:** In **Link · optional**, type `drive folder`.
**Expected:** Red text "Enter a web link that starts with http:// or https://." under the field; both buttons are disabled with the tooltip "Fix the link first". A `https://…` link clears it.

---

### TC-GOAL-006 — Only one goal per year

**Steps:** After saving a draft, look for any way to add another goal.
**Expected:**
- There is none: the page always shows the one row.
- (Testers with API tools) A second create for the same year is refused with "You already have an annual goal for CY 26-27. Write all of the year's goals in that one goal." A mentor or the Admin creating one on the staff member's behalf gets "This staff member already has an annual goal for CY 26-27…".

---

### TC-GOAL-007 — Submit for approval

**Steps:** Click **Submit for approval** and confirm "Submit your CY 26-27 goal for approval?".
**Expected:**
- Badge **Pending Approval**; blue notice "Submitted for approval. <Mentor> approves it or asks for changes. You can't edit it while it waits."
- The Goal column is read-only: title in bold, the goals as a real list, an **Attachment** link if you gave one.
- The mentor gets a bell notification.

---

### TC-GOAL-008 — Changes requested, then resubmit

**Pre-condition:** The mentor requested changes (TC-MENT-004).
**Expected:**
- Amber notice "<Mentor> asked for changes. “<feedback>” Edit your goal below and submit it again."; the Goal column is editable with your earlier text.
- **Save draft** turns it back into **Draft**; the info notice keeps "<Mentor>'s last feedback: “…”".
- **Submit for approval** sends it again (Pending Approval).

---

### TC-GOAL-009 — Approved goal

**Pre-condition:** The mentor approved the goal.
**Expected:** Green notice "Approved on <date>. Your goal is fixed for CY 26-27; each half you review your progress against it." The Goal column is read-only and the H1 / H2 selector appears (§2.2).

---

### TC-GOAL-010 — Attachment link opens externally

**Steps:** Click **Attachment** in the Goal column.
**Expected:** The link opens in a new browser tab.

---

### TC-GOAL-011 — Rich text in the goal

**Steps:** Write goals with bold, italic, a bullet list and a numbered list; save; view the goal read-only (after submitting) and, as Admin, Exports → Goals.
**Expected:**
- The editor stores plain Markdown (`**bold**`, `- item`); its toolbar counter counts the source (max 5,000).
- The read-only Goal column shows real bold text and lists. Typed HTML such as `<b>x</b>` shows as literal text.
- The Excel Description cell has the markers stripped (bullets as "•", line breaks kept).

---

### TC-GOAL-012 — Another year

**Pre-condition:** You have goals in two years, or the goal year has moved on.
**Expected:** The **Goal year** dropdown lists the years ("(current)" on the active one). A past year is read-only ("H2 is closed. CY 25-26 is a past year and read-only."); a past year without a goal reads "You have no annual goal for CY 25-26."

---

### TC-GOAL-013 — Notification links and role expectations

**Steps:** Click a goal notification in the bell; then click **View role expectations**.
**Expected:** The link opens your Annual Goals page on that goal's year. The dialog is titled "Your Role Expectations" and lists the six competencies for your function and level.

---

## 2.2 Self-review in the table (Staff)

### TC-SELFREV-001 — The half selector

**Pre-condition:** Approved goal; the Project Goals quarter is Q3 (annual half H2).
**Expected:**
- Pills **H1** and **H2**; H2 is marked **current**. H1 reads "Open for backfill", or its state once something is in ("In progress", "Self-review in · awaiting review", "Reviewed").
- A half not reached yet (H2 while in Q1–Q2) is greyed with a lock and "Not started".
- On the right: "Self-review · <state>" and "Mentor review · <state>" badges for the selected half; "Half closed" when it is.
- The two review columns are headed with the selected half ("Self review · H1 · you", "Mentor review · H1 · <mentor>").

---

### TC-SELFREV-002 — Save a self-review draft

**Steps:** On an open half, type in the **Self review** column (marked *editing*); **Save draft**; refresh.
**Expected:** Toast "H1 self-review draft saved"; the text is kept; the pill reads "In progress". The mentor and the Admin do not see the draft.

---

### TC-SELFREV-003 — Submit the self-review

**Steps:** **Submit H1 self-review** and confirm.
**Expected:**
- Teal notice "H1 self-review submitted on <date>. <Mentor>'s review fills the last column once it is in."; the column is read-only; badge **H1 Self-Reviewed**.
- The mentor gets a bell notification; their roster shows "Write review" for you.
- **Submit** stays disabled while the text is empty.

---

### TC-SELFREV-004 — Moving on closes the earlier half

**Pre-condition:** During H2, the goal is Approved and H1 was never filled.
**Steps:** Submit an H2 self-review, then select H1.
**Expected:** H1 reads "H1 can no longer be filled: your goal has moved on to the next half." (the server rule: halves are filed in order).

---

### TC-SELFREV-005 — H2 opens when the Admin rolls out Q3

**Pre-condition:** Project Goals is in Q1 or Q2 (System Settings → Quarter roll-out); the Topbar reads "H1 · CY 26-27".
**Steps:** Look at the half pills on an approved goal; ask the Admin to roll out Q3 (the confirmation says "Annual goals and reviews move to H2 · CY 26-27…"); refresh.
**Expected:**
- Before: H1 is current; H2 is locked "Not started".
- After: H2 is current and open; H1 stays open for backfill. Rolling back to Q2 closes H2 again. Starting the next goal year moves annual goals to CY 27-28 and closes both halves of CY 26-27.

---

## 2.3 Mentor: roster and one goal

### TC-MENT-001 — Open the roster

**Login as:** Mentor
**Expected:**
- Header "Annual Goals · CY 26-27", tab **Team Goals**, a line "Goal entry for CY 26-27 is open. H2 reviews are open."
- One row per mentee, including those who have not started: Staff member (name and code), Function · designation, Goal (title, "Drafting" for a draft, "Not started"), Status badge, **H1 · self / mentor** and **H2 · self / mentor** step badges, and an Action.
- Summary line, e.g. "3 people · 1 pending approval · 1 review to write · 1 not started".
- Filters: search by name, Function, Status. **Bulk approve (N)** appears when a goal is pending.

---

### TC-MENT-002 — Actions and filters

**Expected:**
- Action **Approve** on a Pending Approval row; **Write review** when a self-review for an open half is in (H1 counts during H2); **Open** otherwise. Rows for drafts and not-started people have no action and do not open.
- Status filter options: Not started, Drafting, Pending approval, Changes requested, Approved (any stage), Self-review in, review pending.
- The dashboard card link `/annual-goals?status=pending_approval` opens the roster pre-filtered.

---

### TC-MENT-003 — Approve a goal

**Steps:** Click **Approve** on a row, then **Approve** on the goal page and confirm "Approve <name>'s CY 26-27 goal?".
**Expected:** Blue notice before: "Submitted for your approval. Approve it, or request changes with a note…". After: toast "Goal approved", badge **Approved**, "Approved on <date>" beside it; the staff member is notified.

---

### TC-MENT-004 — Request changes

**Steps:** On a pending goal, **Request changes**; type feedback; **Send feedback**.
**Expected:** The dialog's button stays disabled while the feedback is empty. After sending: badge **Changes Requested**, amber notice with your note, "Waiting for <name> to revise the goal…"; the staff member sees the note (TC-GOAL-008).

---

### TC-MENT-005 — Bulk approve

**Steps:** On the roster, **Bulk approve (N)**; tick the goals; **Approve**.
**Expected:** The dialog lists the pending goals by mentee; changes-requested goals show as "Awaiting revision" and cannot be ticked. Toast "Approved N goals"; the rows move to Approved.

---

### TC-MENT-006 — A draft stays private

**Expected:** A mentee's draft shows "Drafting" in the roster; opening it by link shows "Staff member drafting" in the Goal column and "<name> is still drafting their CY 26-27 goal. Nothing to do yet."

---

## 2.4 Mentor review in the table

### TC-MENTREV-001 — The page opens on the half waiting for you

**Pre-condition:** During H2, a mentee submitted their H1 self-review.
**Steps:** Click **Write review** on the roster.
**Expected:** The goal page opens on **H1** (not the current H2): teal notice "H1 self-review in (<date>). Write your review in the last column."; the Mentor review column is *editing*; the mentee's self-review is shown read-only.

---

### TC-MENTREV-002 — Write and submit the review

**Steps:** Type a review; **Save draft**; refresh; **Submit H1 review** and confirm.
**Expected:**
- Toast "H1 review draft saved"; the draft is kept after the refresh and only you see it.
- After submitting: green notice "H1 review submitted on <date>." and the page stays on H1; badge **H1 Mentor-Reviewed**; the roster shows "Mentor · submitted"; the mentee is notified.

---

### TC-MENTREV-003 — Draft before the self-review

**Pre-condition:** Approved goal, no self-review yet for the open half.
**Expected:** Amber notice "<name> has not submitted an H2 self-review yet. You can draft your review now; submitting waits for the self-review." **Save draft** works; **Submit H2 review** is disabled with the tooltip "Waiting for <name>'s H2 self-review".

---

### TC-MENTREV-004 — The mentee's role expectations

**Steps:** **View role expectations** on the goal page.
**Expected:** A dialog titled "<name>'s role expectations" with the mentee's function, designation and six competencies (it no longer depends on the retired Project Reviews feature). The Admin sees the same dialog.

---

### TC-MENTREV-005 — The review shows who wrote it

**Expected:** Under a submitted mentor review, the author's name is shown, even if the staff member's mentor changed afterwards.

---

### TC-MENTREV-006 — Hidden until the Admin releases the half

**Pre-condition:** A submitted H1 mentor review; System Settings → **Show H1 Mentor Reviews on Annual Goals** is OFF for the year.
**Expected:**
- The mentor's confirmation and notice say the review stays hidden from the mentee until the Admin releases H1 reviews.
- The staff member's Mentor review column shows a lock: "Your mentor's H1 review is in. It shows here once the Admin releases H1 reviews." After the Admin turns the switch ON, the text and the author appear. H2 has its own switch.

---

### TC-MENTREV-007 — From My Mentees

**Steps:** My Mentees → a mentee → **Annual Goals** tab.
**Expected:** The same goal view (status, half selector, table, Approve / Request changes / review buttons) for the year picked at the top of the mentee page; "All years" lists each year's goal, newest first. A mentee without a goal shows "No annual goal for this year yet".

---

## 2.5 Admin: All Goals (read only)

### TC-ALLGOAL-001 — The roster of every staff member

**Login as:** Admin
**Expected:** Tab **All Goals** with every Staff member (with or without a goal); an extra **Mentor** column and filter ("No mentor" when none); **Export Excel** at the top right. The Action column offers **Open** only.

---

### TC-ALLGOAL-002 — Open a goal

**Expected:** The same table, read-only: no Approve, Request changes or review buttons. Notices say who is waiting ("Waiting for <mentor> to approve it.", "Waiting for <mentor>'s review."). Unsubmitted drafts of the staff member and of the mentor are not shown. **Back to all goals** returns to the roster on the same year.

---

### TC-ALLGOAL-003 — Year and dashboard link

**Expected:** The **Goal year** dropdown lists every year with goals plus the active one. The HR dashboard's Goal Approval Progress card opens the roster on its year (`?fy=2026`).

---

### TC-ALLGOAL-004 — Export Goals to Excel

**Steps:** **Export Excel** on the roster.
**Expected:** The goals workbook downloads, as before.

---

## 2.6 Annual Goals — Cross-checks

- Refer to **Module 1 §1.7** UI checklist for every screen in this module.
- Successful saves show a green toast; failures show a red message above the table.
- After every state change (save, submit, approve, request changes, review), refresh and confirm it persisted.
- Test in three browser widths: narrow / medium / wide. The table scrolls sideways on narrow screens; the page itself does not.
- There is no delete button: the one goal for the year is edited while it is a draft.
- Data from before the one-goal rule can hold two goals in one year: the staff page shows the oldest with an amber note, and the roster shows "+1 older goal this year".

---

**End of Module 2.** Next: Module 3 — Annual Reviews.
