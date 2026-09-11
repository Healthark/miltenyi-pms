# QA Test Cases — Module 7: Project Goals (CY 2026, quarterly reviews)

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Module 1 reviewed. Apply Module 1 §1.7 UI checklist on every screen. Module 4 (Project Reviews) is retired on this instance — see §7.5.
> **Test accounts needed (UAT seed, all passwords in `backend/miltenyi-test-seed.py`):** Staff with a framework row (`aarav.patel@healthark.ai`, Regulatory Affairs, Level 1, mentor Rahul), Staff whose function has no framework yet (`saanvi.reddy@healthark.ai`, Pharmacovigilance), Mentor (`rahul.verma@healthark.ai`), Admin (`aanya.sharma@healthark.ai`). Only Healthark staff have accounts; the Miltenyi reviewer is a name on the Staff record, not a login.
> **Vocab:** Each staff member has **one goal set per goal year** (`CY 2026`). Its rows are the **KPIs** of the framework row for the staff member's function × designation level, copied in at creation with their weightages. **Goals are set once a year** — lifecycle **Draft → Submitted → Approved (agreed offline)** — and then **reviewed every quarter** against the same goals: per quarter one **self-review** (text per KPI + one self rating) and one **Miltenyi review** (comments per KPI + one final rating, typed in by the **Mentor** on the Miltenyi reviewer's behalf), then the staff member **acknowledges** that quarter. Quarters are labelled **Q1 · CY 2026 … Q4 · CY 2026**. Ratings are 1–5 where **lower = better**; never per KPI; weightages are informational.
> **The review window is the quarter, not a switch.** The Admin **rolls quarters out** in System Settings (like the Healthark PMS cycle): the **current quarter** is writable, earlier quarters of the same year stay open for **backfill**, later quarters are **locked**. The Admin releases **ratings per quarter**. The yearly switches are **goal entry open** and **weightages visible**. The UAT seed starts with **Q3 · CY 2026 current and Q1–Q3 rolled out**.

---

## 7.1 Staff — My Goals table

### TC-PG-001 — Open Project Goals before a set exists

**Login as:** Staff (Aarav)
**Steps:**
1. Click **Project Goals** in the sidebar.

**Expected:**
- Page title "Project Goals · CY 2026" with the one-line explanation ("Your goals for the year under each KPI, set once and reviewed every quarter…").
- A **Framework · CY 2026** band: role title · function · "level 1 of 4", then the two paragraphs *Business & Strategic Outcomes* and *Functional / Operational Excellence Goals*.
- A line "5 KPIs follow; weightages are fixed by Miltenyi and total 100%."
- A call to action "Start your CY 2026 goals" ("One row per KPI above, set once for the year. Agree the wording with Stefan Bauer first…") with a **Start goal set** button.

**UI checks:**
- The band reads as reference material (muted labels, no inputs). No "Trials" line anywhere.
- Sidebar shows **Project Goals** and does **not** show Project Reviews.

---

### TC-PG-002 — Start the goal set

**Login as:** Staff (Aarav)
**Steps:**
1. Click **Start goal set**.

**Expected:**
- A three-step stage strip (**Draft · Submitted · Approved · agreed offline**) with **Draft** highlighted, and a note: "Write one goal in each row. Agree the wording with Stefan Bauer first; submitting records what was agreed… Goals are set once for CY 2026 and reviewed every quarter."
- No quarter selector yet (quarters appear once the goals are approved).
- One table with four columns: **KPI / Success measure** (from the Miltenyi framework) · **Goal** (marked *Editing*, "Set once a year · agreed offline") · **Self review** ("Per quarter · staff member") · **Miltenyi review** ("Stefan Bauer · entered by the mentor").
- One row per KPI, numbered, with the weightage chip (e.g. 30%) under the KPI text.
- Goal cells are text areas with a `0 / 3,000` counter; Self review cells read "Opens once the goals are approved"; Miltenyi review cells read "After approval".
- Footer row **Quarter rating** — "One self rating and one final rating per quarter. No rating per KPI; weightages are informational." with two dashes.
- Buttons **Save Draft** and **Submit Goals**.

**UI checks:**
- KPI text is fully readable (no truncated single-line boxes).
- Counter updates live while typing.

---

### TC-PG-003 — Save a draft

**Login as:** Staff (Aarav)
**Steps:**
1. Type a goal in rows 1–3 only. Click **Save Draft**.
2. Refresh the page.

**Expected:**
- Toast "Draft saved".
- After refresh the three goals are still there; rows 4–5 stay empty. Status remains **Draft**.

---

### TC-PG-004 — Submit is blocked while a row is empty

**Login as:** Staff (Aarav), draft from TC-PG-003
**Expected:**
- **Submit Goals** is disabled; hovering shows "Every KPI row needs a goal".
- Filling the remaining rows enables it.

---

### TC-PG-005 — Submit goals

**Login as:** Staff (Aarav)
**Steps:**
1. With every row filled, click **Submit Goals**.
2. Read the dialog ("They stay fixed for the whole year and every quarter's review is written against them…") and confirm (**Submit goals**).

**Expected:**
- Toast "Goals submitted". Stage strip moves to **Submitted**.
- Note: "Submitted on <date>. Read-only while Rahul Verma records the approval agreed with Stefan Bauer."
- Goal cells become read-only text; Save/Submit buttons disappear.
- The mentor receives a bell notification and an email (see §7.6).

---

### TC-PG-006 — Approved: the quarter selector appears

**Pre-condition:** Mentor has completed TC-PG-022. Q3 is the current quarter (UAT seed).
**Login as:** Staff (Aarav)
**Expected:**
- Stage strip complete (**Approved · agreed offline** checked). Note: "Approved (agreed offline), recorded by Rahul Verma on <date>. Goals are locked for CY 2026; each quarter you review against them."
- The mentor's approval note (if any) is **not** shown to the staff member.
- A **Quarter** bar with pills **Q1 · Q2 · Q3 · Q4**: Q1–Q3 selectable, **Q3** marked *current* and pre-selected, **Q4** greyed with a lock ("Q4 has not started yet" on hover). Next to it the quarter progress: "Self-review · Not started — Miltenyi review · Not started".
- Second note: "Q3 · CY 2026 self-review is open. Write what you delivered against each goal this quarter and give one overall rating."
- Column headers now say **Self review — Q3 · CY 2026 · staff member** (marked *Editing*) and **Miltenyi review — Q3 · CY 2026 · Stefan Bauer · entered by the mentor**; footer says **Q3 · CY 2026 rating**.
- Self review cells are text areas with counters; footer shows **Your Q3 · CY 2026 rating** (Select, 1–5).
- **Submit Q3 · CY 2026 Self-Review** is disabled until every row has text **and** a rating; hover text "Every row needs a self-review and you need an overall rating". **Save Draft** works at any time.

---

### TC-PG-007 — Earlier quarter open for backfill, later quarter locked

**Login as:** Staff (Aarav), set approved
**Steps:**
1. Click the **Q1** pill.
2. Try the **Q4** pill.

**Expected:**
- Q1: the two right-hand columns switch to Q1 (headers "Q1 · CY 2026"), the note reads "Q1 · CY 2026 self-review is open… This is an earlier quarter of the year; it stays open for backfill." Self review cells are editable; the URL gains `?cycle=Q1%20CY%202026` so a refresh keeps the quarter.
- Q4: cannot be selected (disabled pill). The API refuses any Q4 save with "Q4 has not started yet. The Admin rolls quarters out in System Settings." (409).
- Switching quarters never mixes drafts: text typed under Q1 does not appear under Q3.

---

### TC-PG-008 — Submit the self-review (one shot per quarter)

**Login as:** Staff (Aarav), Q3 selected
**Steps:**
1. Fill all five self-review cells, pick a rating, click **Submit Q3 · CY 2026 Self-Review**.
2. Confirm in the dialog ("One submission per quarter, locked afterwards…").

**Expected:**
- Toast "Q3 · CY 2026 self-review submitted". Quarter progress shows **Self-review · Submitted**; note "Q3 · CY 2026 self-review submitted on <date>. Stefan Bauer's comments will fill the last column once Rahul Verma has entered them."
- Footer shows the self rating as "Self rating · given <date>"; cells are read-only; the Q3 pill hint reads "Self-review in · awaiting comments".
- Q1 and Q2 are unaffected and still editable.

---

### TC-PG-009 — Draft comments stay hidden

**Pre-condition:** Mentor has saved a Q3 review draft (TC-PG-023) but not submitted.
**Login as:** Staff (Aarav), Q3 selected
**Expected:**
- Miltenyi review cells show the placeholder "Awaiting review", never the draft text, the reviewer name from the draft or the draft rating.

---

### TC-PG-010 — Reviewed: comments visible, rating hidden

**Pre-condition:** Mentor submitted the Q3 review (TC-PG-024); the Q3 **ratings visible** switch is off.
**Login as:** Staff (Aarav), Q3 selected
**Expected:**
- Note "Q3 · CY 2026 reviewed on <date> by Stefan Bauer, entered by Rahul Verma."; quarter progress "Miltenyi review · Submitted"; Q3 pill hint "Reviewed".
- Each Miltenyi review cell shows the comment with the attribution "Stefan Bauer · Miltenyi"; a Healthark note, if the mentor added one, is shown separately and labelled as Healthark's.
- Footer: self rating visible; "Final rating is hidden until the Admin releases Q3 · CY 2026's ratings".
- Button **Acknowledge Q3 · CY 2026 review** with the text "Acknowledging confirms you have read this quarter's review; it does not signal agreement."

---

### TC-PG-011 — Ratings released per quarter

**Pre-condition:** Admin turns **Q3 · CY 2026 ratings visible** on (TC-PG-045).
**Login as:** Staff (Aarav)
**Expected:** Under Q3 the footer now shows the final rating as "Final rating · given by Stefan Bauer" (or "given by Healthark" when the mentor chose that). Under Q1/Q2 a submitted final rating stays hidden until their own switch is turned on.

---

### TC-PG-012 — Acknowledge

**Login as:** Staff (Aarav), Q3 selected
**Steps:** Click **Acknowledge Q3 · CY 2026 review**.
**Expected:** The button is replaced by "Acknowledged on <date>"; the quarter progress shows "Acknowledged <date>"; the Q3 pill hint reads "Reviewed · acknowledged". Refreshing keeps it. There is no undo; the Admin unlocking that quarter's review clears it (TC-PG-032). Other quarters are not affected.

---

### TC-PG-013 — Staff whose function has no framework row

**Login as:** Staff (Saanvi, Pharmacovigilance)
**Expected:**
- No framework band and no **Start goal set** button. A notice explains that no framework row exists for the function/level yet and that the Admin adds it in Admin Panel → Framework.
- Once the Admin adds the row (TC-PG-042) and the page is refreshed, TC-PG-001 applies.

---

### TC-PG-014 — Goal entry closed

**Pre-condition:** Admin turns **Goal entry open** off in System Settings.
**Login as:** a Staff member without a set, and one with a Draft
**Expected:** Neither can create, save or submit goals; the page says entry is closed for the period. Approved sets and their quarterly reviews are unaffected.

---

### TC-PG-015 — Weightages hidden

**Pre-condition:** Admin turns **Weightages visible to staff** off in System Settings.
**Login as:** Staff (Aarav)
**Expected:** The % chips disappear from the KPI column and the band line no longer mentions "total 100%". Mentor and Admin still see the weightages.

---

### TC-PG-016 — No quarter rolled out yet

**Pre-condition:** A period before its first roll-out (a freshly created period has no current quarter; the UAT seed already sits on Q3, so this needs a fresh database or a developer to clear `current_quarter_seq`).
**Login as:** Staff with an approved set
**Expected:** An amber notice "Quarterly reviews have not started yet. The Admin opens Q1 when the first quarter's reviews are due."; every quarter pill is locked; Self review / Miltenyi review cells read "Quarterly reviews have not started". The mentor / Admin queue shows the quarter bar fully locked and a hint that Q1 is rolled out in System Settings.

---

## 7.2 Mentor — Team Goals queue and set page

### TC-PG-020 — Team Goals queue for one quarter

**Login as:** Mentor (Rahul)
**Steps:** Click **Project Goals**.
**Expected:**
- Title "Project Goals · CY 2026" with the mentor explanation ("You record the offline approval once and enter the Miltenyi reviewer's comments each quarter.").
- The **Quarter** bar (Q1–Q3 selectable, Q3 current and pre-selected, Q4 locked). Changing the quarter reloads the two review columns; the URL keeps `?cycle=`.
- Filters: search, **Function**, **Goals** (Not started, Draft, Submitted, Approved, No framework) and **Q3 · CY 2026** (Self-review pending, Review pending, Reviewed, Acknowledged).
- Count chips: goals statuses, then per quarter "Q3 · CY 2026 · self-review pending / review pending / reviewed / acknowledged".
- Columns: Staff member · Function · level · Miltenyi reviewer · Goals · year · **Q3 · CY 2026 self-review** · **Q3 · CY 2026 review** · Actions. No Trials column.
- Actions: **Mark approved** (goals Submitted), **Enter Q3 review** (goals Approved and the quarter's self-review Submitted; Admins also without it), **Open** (everything else with a set), "Not started" text for no set, and "No framework for this level" in red when the function × level row is missing.
- Only the mentor's own mentees are listed.

---

### TC-PG-021 — Open a set

**Login as:** Mentor (Rahul)
**Steps:** Click **Open** / **Mark approved** on Aarav.
**Expected:**
- Header "Aarav Patel · Regulatory Affairs Associate · Regulatory Affairs · CY 2026" and a line "Mentor: Rahul Verma · Miltenyi reviewer: Stefan Bauer" (no Trials).
- **Back to team** returns to the queue. Two tabs: **Goals & reviews · CY 2026** and **Change log**.
- The same table as the staff member sees, with the Goal column read-only. Once the set is approved, the same **Quarter** bar as the staff member's, pre-selected to the quarter chosen in the queue.

---

### TC-PG-022 — Mark approved (agreed offline)

**Login as:** Mentor (Rahul), set in **Submitted**
**Steps:**
1. Click **Mark approved (agreed offline)**.
2. Check the dialog: **Miltenyi reviewer** is prefilled with the staff member's reviewer name, **Agreed on** defaults to today, optional note.
3. Confirm with **Mark approved**.

**Expected:**
- Stage strip complete; the quarter bar appears; under the current quarter the note reads "Aarav Patel has not submitted a Q3 · CY 2026 self-review. You can draft Stefan Bauer's comments now; submission waits for the self-review."
- Staff member receives a bell notification and an email. The approval note is visible to mentor and Admin only.
- The dialog cannot be confirmed with an empty reviewer name or date.

---

### TC-PG-023 — Draft the Miltenyi comments before the self-review

**Login as:** Mentor (Rahul), set **Approved**, Q3 selected
**Expected:**
- Above the table: provenance fields **Miltenyi reviewer** (prefilled), **Input received on** (date) and **Source** (link, optional), plus **Entered by** = the mentor.
- Each Miltenyi review cell has two boxes: "Type or paste Stefan Bauer's Q3 · CY 2026 words for this KPI." and "Your own observation, shown to the staff member as Healthark's." (optional).
- Footer: **Final rating** (1–5) and **Given by** toggle (Stefan Bauer / Healthark).
- **Save Draft** → toast "Review draft saved". **Submit Q3 · CY 2026 Review** is disabled with hover text "Waiting for the staff member's self-review".
- The staff member cannot see any of this yet (TC-PG-009). Likewise, while the staff member's self-review is only a **draft**, the mentor's Self review column shows "Awaiting self-review" and the queue shows "Draft" without the rating.
- Selecting **Q1** shows Q1's own (empty) review; drafts are per quarter.

---

### TC-PG-024 — Submit the quarter's review

**Pre-condition:** Staff member completed TC-PG-008 for Q3.
**Login as:** Mentor (Rahul), Q3 selected
**Steps:**
1. Confirm the Self review column now shows the staff member's text and self rating; note "Q3 · CY 2026 self-review in (<date>)…".
2. Fill every Miltenyi comment, set the final rating, click **Submit Q3 · CY 2026 Review**, confirm ("This publishes Stefan Bauer's Q3 · CY 2026 comments and the final rating to Aarav Patel…").

**Expected:**
- Toast "Q3 · CY 2026 review submitted"; note "Q3 · CY 2026 review submitted on <date> by Rahul Verma. Not yet acknowledged by the staff member. Edits are logged and notify Aarav Patel."
- **Submit** stays disabled while any Miltenyi comment or the final rating is missing (hover text names the rule). Healthark notes are optional.
- Staff member receives a bell notification and an email.

---

### TC-PG-025 — Edit after submission

**Login as:** Mentor (Rahul), Q3 reviewed
**Steps:** Click **Edit review** (amber), change one comment, **Save changes**.
**Expected:** The change is saved, a **review edit · Q3 · CY 2026** entry appears in the change log, and the staff member receives a bell + email ("Your Q3 · CY 2026 project goals review was edited by Rahul Verma."). A prior acknowledgement is not cleared by an edit (only by an Admin unlock). **Edit review** is not offered for a closed quarter (TC-PG-046).

---

### TC-PG-026 — Change log tab

**Login as:** Mentor (Rahul) or Admin
**Expected:** Entries newest first — e.g. review submit **Q3 · CY 2026** · self submit **Q3 · CY 2026** · approve · submit — each with actor and date; quarter actions carry the quarter chip, goal actions do not; unlocks show the Admin's reason.

---

### TC-PG-027 — Not my mentee

**Login as:** Mentor (Neha)
**Steps:** Open `/project-goals/1` (Aarav's set) directly.
**Expected:** An error notice (403), no goal content. Neha's queue never lists Aarav.

---

## 7.3 Admin — All Goals, unlock

### TC-PG-030 — All Goals queue

**Login as:** Admin (Aanya)
**Steps:** Click **Project Goals**.
**Expected:** Same layout as the mentor queue (quarter bar included) but titled **All Goals**, listing every Staff member, with the Function filter covering all functions that have staff. Counts include "No framework" rows.

---

### TC-PG-031 — Admin can act as reviewer

**Login as:** Admin (Aanya)
**Expected:** The Admin can open any set, mark it approved and enter/submit any started quarter's review exactly like the mentor. When the staff member has not self-reviewed that quarter, the Admin alone sees an amber **Submit anyway (Admin)** button; mentors never see it. Forced submissions are recorded in the change log with the reason "forced past missing self-review".

---

### TC-PG-032 — Unlock a quarter's review / unlock goals

**Login as:** Admin (Aanya), Q3 reviewed and acknowledged
**Steps:**
1. With Q3 selected, click **Unlock Q3 · CY 2026 review**; read the dialog ("The review goes back to draft so the mentor can correct it. The staff member's acknowledgement for this quarter is cleared; their self-review is kept…"). **Reason** is mandatory.
2. Confirm.

**Expected:**
- Q3's review is a draft again, the Q3 acknowledgement is gone, the self-review and every other quarter are untouched.
- Staff member **and** mentor receive a bell + email quoting the reason; an **unlock · Q3 · CY 2026** entry with the reason appears in the change log.
- **Unlock goals** (shown while the set is Submitted or Approved) returns the set to Draft and clears the approval record — but is **refused once any quarter's self-review or review has been submitted** ("Reviews have already been submitted against these goals (Q3 · CY 2026…). Unlock the quarter's review instead.").
- Mentors do not see either Unlock button.

---

## 7.4 Admin — Admin Panel: Framework Mapping, Framework, System Settings

### TC-PG-040 — Framework Mapping tab

**Login as:** Admin (Aanya)
**Steps:**
1. Admin Panel → **Framework Mapping**.
2. Click the pencil on Aarav Patel.

**Expected:**
- Columns: Staff member · Function · GCC designation · Designation level (chip "L1 · Entry") · Reviewer (Mentor) · Miltenyi reviewer · Status.
- Status chips **Mapped / No framework / No level / No function** with counts; filters by search, function and status.
- The edit dialog shows Function, GCC designation and Level read-only, and only two editable fields: **Reviewer (Mentor)** and **Miltenyi reviewer**. **Save** → toast "Mapping saved"; the new names appear in the queue rows and in the staff member's page header.
- Only Admins see this tab. The Admin Panel tabs are **Users · Exports · System Settings · Framework Mapping · Framework** — there is no Projects tab.

---

### TC-PG-041 — Framework tab: matrix and staged edits

**Login as:** Admin (Aanya)
**Steps:**
1. Admin Panel → **Framework**. Select **Biostatistics**.
2. In the KPI row for Level 1 click **Edit KPIs**, change one weightage so the total is not 100, click **Done**.
3. Fix the weightages so the total is 100 again, click **Done**, then **Save**.

**Expected:**
- Function select lists all eight functions; those without rows are marked "(no rows)".
- Summary chip "20 KPIs · 4 of 4 levels defined · CY 2026".
- **Designations → levels** strip: each designation of the function with a level select (changes apply immediately, toast "Designation level updated").
- Matrix: one column per Level 1–4, rows *Outcomes*, *Functional goals* and *KPI / Success Measures · Weightage* with a **Total 100%** badge.
- While the total is not 100 the badge turns red and **Save** is disabled. **Discard** drops all staged edits.
- **Save** → toast "Framework saved".
- The Framework tab holds content only; every switch is in System Settings.

---

### TC-PG-042 — Add Function (one role/level row)

**Login as:** Admin (Aanya)
**Steps:**
1. Select **Pharmacovigilance** (empty state "No framework rows for Pharmacovigilance yet.").
2. Click **Add Function**, fill step 1 (level, role title, two paragraphs) and step 2 (KPIs totalling 100), save.

**Expected:**
- Toast "Framework row added"; the level column fills in.
- Framework Mapping now shows the Level-1 Pharmacovigilance staff as **Mapped**; their Project Goals page shows the band (TC-PG-013).
- Creating the same function × level twice is refused (409 "already exists").

---

### TC-PG-043 — System Settings → Project Goals: goal-year switches

**Login as:** Admin (Aanya)
**Steps:** Admin Panel → **System Settings → Project Goals · CY 2026**, card **Goal year · CY 2026**. Toggle each switch and check the Staff page after each.
**Expected:**
- Exactly two switches: **Goal entry open** → TC-PG-014 and **Weightages visible to staff** → TC-PG-015. There is **no** "self-review window" and **no** period-wide "ratings visible" switch.
- Each toggle shows toast "Setting updated" and persists after refresh.
- An inactive period shows an amber notice with a link to make it active.

---

### TC-PG-044 — Quarter roll-out card

**Login as:** Admin (Aanya)
**Steps:** Same section, card **Quarter roll-out · the review window**.
**Expected (UAT seed):**
- "Current review quarter **Q3 · CY 2026**"; a strip of four tiles: Q1 and Q2 "open · backfill" with their opened date, Q3 "current", Q4 locked "Not started".
- Buttons: **Roll out Q4 · CY 2026** (primary); **Set manually** select (Q1, Q2, Q4 of CY 2026) with **Set**; **Show roll-out log**.
- Click **Roll out Q4 · CY 2026**: a dialog "Q3 · CY 2026 → Q4 · CY 2026" with **What changes** (Q4 becomes current; earlier quarters stay open for backfill; everyone gets an announcement; the move is logged) and **What does not change** (approved goals; other quarters' submissions; annual goals/reviews and the H1/H2 cycle; ratings stay hidden). Confirm → toast "Current quarter: Q4 · CY 2026"; the Q4 tile becomes *current*; a **Roll back to Q3 · CY 2026** button appears; the primary button now reads **Roll out Q1 · CY 2027 · NEW YEAR**.
- Every user's bell shows "Project Goals moved to Q4 · CY 2026…" (no email). Staff pages now offer Q4 and keep Q1–Q3 open.
- Click **Roll back to Q3 · CY 2026** → dialog (amber) "Quarters after Q3 · CY 2026 are closed again. Nothing already submitted is deleted…" → confirm → current is Q3 again, the Q4 tile is locked again, the log shows *rollback* above *rollout*, each with actor and time.
- **Set manually** to Q1 → dialog (amber, backwards) → confirm → Q1 current, Q2/Q3 locked; existing Q3 submissions stay readable on the staff and mentor pages but cannot be edited. Set back to Q3.

---

### TC-PG-045 — Ratings released per quarter

**Login as:** Admin (Aanya)
**Steps:** In the roll-out card, section **Ratings visible to staff · per quarter**, turn on **Q3 · CY 2026 ratings visible**.
**Expected:** One switch per started quarter (Q1, Q2, Q3), toast "Quarter updated". Only Q3's final rating becomes visible to staff (TC-PG-011). A quarter that has not started has no switch.

---

### TC-PG-046 — Year roll-over (Q4 → Q1 of the next year)

**Login as:** Admin (Aanya), current quarter set to Q4
**Steps:**
1. Click **Roll out Q1 · CY 2027 · NEW YEAR**.
2. Try to confirm without typing; then type `CY 2027` and confirm.

**Expected:**
- The dialog carries an amber block "This starts a new goal year. Type CY 2027 to confirm."; **Move to Q1 · CY 2027** stays disabled until the exact label is typed (the API answers 400 without it).
- After confirming: the section header reads **Project Goals · CY 2027**, current quarter **Q1 · CY 2027**, only Q1 started; **Goal entry open** is on for CY 2027; the Framework tab shows the CY 2027 matrix with the same rows as CY 2026 (carried over).
- Staff see "Start your CY 2027 goals" (a new set); their CY 2026 set is no longer on their page. Mentors/Admins can still open a CY 2026 set by URL: every quarter is read-only ("This goal set belongs to CY 2026, which is closed." on any save) and **Edit review** is not offered.
- Everyone gets the announcement "…CY 2027 is the new goal year…".
- **Roll back to Q4 · CY 2026** returns to the old year (CY 2026 active again, CY 2027 kept but inactive).

---

### TC-PG-047 — Miltenyi Reviewer on the user form

**Login as:** Admin (Aanya)
**Steps:** Admin Panel → Users → edit a Staff member; then edit a Mentor.
**Expected:** Staff have a **Miltenyi Reviewer** text field after **Assigned Mentor**; the field is absent for other roles and is cleared when the role is changed away from Staff. The value is what Framework Mapping and the staff member's page show.

---

## 7.5 Retired surfaces (project reviews and projects are off for Miltenyi)

### TC-PG-060 — Nothing points at Project Reviews or Projects any more

**Login as:** each of the three roles in turn
**Expected:**
- **Sidebar:** Staff, Mentor and Admin see **Project Goals**; nobody sees Project Reviews.
- **Topbar:** only the financial-year pill (no "Project · Q…" pill).
- **Staff dashboard:** Active cycles card shows Fiscal Year and Goal Review Cycle only; the My Reviews card has no Project Reviews sub-section.
- **Admin dashboard:** no Project Review Completion card and no Project Coverage card; the Active Personnel donut shows Staff / Mentors / Admins.
- **Mentee page:** tabs Annual Summary · Annual Goals · Annual Review (no Projects tab).
- **Admin Panel:** no Projects tab; **Exports** quick downloads are Users · Annual Goals · Annual Reviews only; the combined workbook has three sheets (Users, Annual Goals, Annual Reviews) and the per-employee workbook has Profile, Annual Goals, Annual Reviews.
- Typing `/project-reviews` in the address bar redirects to the dashboard; `/api/v1/project-reviews/...`, `/api/v1/projects` and `/api/v1/export/project-reviews.xlsx` answer 403; `/api/v1/export/projects.xlsx` answers 404.

---

## 7.6 Notifications in this module

Bell = in-app notification (Topbar). Email is sent in addition when SMTP is configured (same wording, subject in brackets). Deep links open the set with the quarter pre-selected.

| Event | Recipient | Bell | Email subject |
|---|---|---|---|
| Staff submits goals | Mentor | "<Staff> submitted their CY 2026 project goals. Confirm the offline agreement and mark them approved." | "<Staff> submitted their CY 2026 project goals" |
| Mentor/Admin marks approved | Staff | "Your CY 2026 project goals were marked approved (agreed with <name>). They are locked for the year; quarterly self-reviews run against them." | "Your CY 2026 project goals are approved" |
| Staff submits a quarter's self-review | Mentor | "<Staff> submitted their Q3 · CY 2026 self-review. Enter <Miltenyi reviewer>'s comments when they arrive." | "<Staff> submitted their Q3 · CY 2026 self-review" |
| Mentor/Admin submits a quarter's review | Staff | "<Miltenyi reviewer>'s Q3 · CY 2026 comments on your project goals are in, entered by <Mentor>." | "Your Q3 · CY 2026 project goals review is in" |
| Mentor/Admin edits a submitted review | Staff | "Your Q3 · CY 2026 project goals review was edited by <Mentor>." | "Your Q3 · CY 2026 project goals review was edited" |
| Admin unlocks goals or a quarter's review | Staff **and** Mentor | "The Admin unlocked the <CY 2026 goals / Q3 · CY 2026 review> on <Staff>'s project goals: <reason>" | "Project goals unlocked: …" |
| Admin rolls a quarter out / sets / rolls back | Every active user (except the Admin who did it) | "Project Goals moved to Q4 · CY 2026. Self-reviews and Miltenyi reviews for Q4 · CY 2026 are open; earlier quarters of CY 2026 stay open for backfill." (year change: "…CY 2027 is the new goal year…"; roll back: "…Quarters after it are closed again.") | bell only |

Self-notifications are suppressed (an Admin acting as the mentor of record is not pinged about their own action). Nothing is emailed for drafts or acknowledgements.
