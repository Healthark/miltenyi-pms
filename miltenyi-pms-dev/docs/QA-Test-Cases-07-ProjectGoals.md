# QA Test Cases — Module 7: Project Goals (goal year CY 26-27, quarterly reviews)

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Module 1 reviewed. Apply Module 1 §1.7 UI checklist on every screen. Module 4 (Project Reviews) is retired on this instance — see §7.5.
> **Test accounts needed (UAT seed, all passwords in `backend/miltenyi-test-seed.py`):** Staff with a framework row (`aarav.patel@healthark.ai`, Regulatory Affairs, Level 1, mentor Rahul), Staff whose function has no framework yet (`saanvi.reddy@healthark.ai`, Pharmacovigilance), Mentor (`rahul.verma@healthark.ai`), Admin (`aanya.sharma@healthark.ai`). Only Healthark staff have accounts; the Miltenyi reviewer is a name on the Staff record, not a login.
> **Vocab:** Each staff member has **one goal set per goal year** (`CY 26-27`; goal years end around April, so they are labelled as spans). Its rows are the **KPIs** of the framework row for the staff member's function × designation level, copied in at creation with their weightages. **Goals are set once a year** — lifecycle **Draft → Submitted → Approved (agreed offline)** — and then **reviewed every quarter** against the same goals: per quarter one **self-review** (text per KPI + one self rating) and one **Miltenyi review** (comments per KPI + one final rating, typed in by the **Mentor** on the Miltenyi reviewer's behalf; the Mentor may add an optional **Secondary review** per KPI), then the staff member **acknowledges** that quarter. A submitted review is final — only the Admin can unlock it. Quarters are labelled **Q1 · CY 26-27 … Q4 · CY 26-27**. Ratings are 1–5 where **lower = better**; never per KPI; weightages are informational.
> **The review window is the quarter, not a switch.** The Admin **rolls quarters out** in System Settings (like the Healthark PMS cycle): the **current quarter** is writable, earlier quarters of the same year stay open for **backfill**, later quarters are **locked**. After Q4 the roll-out **starts the next goal year all closed** and the previous year **stays open for backfill until the Admin closes it**. Per goal year the Admin sets **goal entry open**, **weightages visible**, **quarters open for backfill** (past years) and **ratings visible per quarter**; every switch is staged and confirmed before saving. The UAT seed starts with **Q3 · CY 26-27 current and Q1–Q3 rolled out**.

---

## 7.1 Staff — My Goals table

### TC-PG-001 — Open Project Goals before a set exists

**Login as:** Staff (Aarav)
**Steps:**
1. Click **Project Goals** in the sidebar.

**Expected:**
- Page title "Project Goals · CY 26-27" with the one-line explanation ("Your goals for the year under each KPI, set once and reviewed every quarter…").
- A **Framework · CY 26-27** band: role title · function · "level 1 of 4", then the two paragraphs *Business & Strategic Outcomes* and *Functional / Operational Excellence Goals*.
- A line "5 KPIs follow; weightages are fixed by Miltenyi and total 100%."
- A call to action "Start your CY 26-27 goals" ("One row per KPI above, set once for the year. Agree the wording with Stefan Bauer first…") with a **Start goal set** button.

**UI checks:**
- The band reads as reference material (muted labels, no inputs). No "Trials" line anywhere.
- Sidebar shows **Project Goals** and does **not** show Project Reviews.

---

### TC-PG-002 — Start the goal set

**Login as:** Staff (Aarav)
**Steps:**
1. Click **Start goal set**.

**Expected:**
- A **Goals · CY 26-27** line with the status badge **Draft** (there is no stage strip), and a note: "Write one goal in each row. Agree the wording with Stefan Bauer first; submitting records what was agreed… Goals are set once for CY 26-27 and reviewed every quarter."
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
- Toast "Goals submitted". The status badge reads **Submitted**.
- Note: "Submitted on <date>. Read-only while Rahul Verma records the approval agreed with Stefan Bauer."
- Goal cells become read-only text; Save/Submit buttons disappear.
- The mentor receives a bell notification and an email (see §7.6).

---

### TC-PG-006 — Approved: the quarter selector appears

**Pre-condition:** Mentor has completed TC-PG-022. Q3 is the current quarter (UAT seed).
**Login as:** Staff (Aarav)
**Expected:**
- Status badge **Approved · agreed offline**. Note: "Approved (agreed offline), recorded by Rahul Verma on <date>. Goals are locked for CY 26-27; each quarter you review against them."
- The mentor's approval note (if any) is **not** shown to the staff member.
- A **Quarter** bar with pills **Q1 · Q2 · Q3 · Q4**: Q1–Q3 selectable, **Q3** marked *current* and pre-selected, **Q4** greyed with a lock ("Q4 has not started yet" on hover). Next to it the quarter progress: "Self-review · Not started — Miltenyi review · Not started".
- Second note: "Q3 · CY 26-27 self-review is open. Write what you delivered against each goal this quarter and give one overall rating."
- Column headers now say **Self review — Q3 · CY 26-27 · staff member** (marked *Editing*) and **Miltenyi review — Q3 · CY 26-27 · Stefan Bauer · entered by the mentor**; footer says **Q3 · CY 26-27 rating**.
- Self review cells are text areas with counters; footer shows **Your Q3 · CY 26-27 rating** (Select, 1–5).
- **Submit Q3 · CY 26-27 Self-Review** is disabled until every row has text **and** a rating; hover text "Every row needs a self-review and you need an overall rating". **Save Draft** works at any time.

---

### TC-PG-007 — Earlier quarter open for backfill, later quarter locked

**Login as:** Staff (Aarav), set approved
**Steps:**
1. Click the **Q1** pill.
2. Try the **Q4** pill.

**Expected:**
- Q1: the two right-hand columns switch to Q1 (headers "Q1 · CY 26-27"), the note reads "Q1 · CY 26-27 self-review is open… This is an earlier quarter of the year; it stays open for backfill." Self review cells are editable; the URL gains `?cycle=Q1%20CY%202026` so a refresh keeps the quarter.
- Q4: cannot be selected (disabled pill). The API refuses any Q4 save with "Q4 has not started yet. The Admin rolls quarters out in System Settings." (409).
- Switching quarters never mixes drafts: text typed under Q1 does not appear under Q3.

---

### TC-PG-007a — Admin closes an earlier quarter for backfill

**Pre-condition:** Admin turned the **Open for backfill** switch of the Q1 row off in the **Quarters** table (System Settings, Project Goals column) and saved; Q3 is current.
**Login as:** Staff (Aarav), then Mentor (Rahul)
**Expected:**
- The Q1 pill shows a lock and reads "Closed"; its Self review cells are read-only and the note says "Q1 · CY 26-27 is closed."; the API refuses a save with "Q1 · CY 26-27 is closed for backfill. The Admin can reopen it in System Settings." (409). Q2 and Q3 are unaffected.
- The mentor's Q1 review column is read-only for the same reason.
- The current quarter cannot be closed: its row shows an **always open** chip instead of a switch (the API answers 400).
- Turning the switch back on reopens Q1 for both roles; a self-review may then be written from scratch, months after the quarter ended.

---

### TC-PG-008 — Submit the self-review (one shot per quarter)

**Login as:** Staff (Aarav), Q3 selected
**Steps:**
1. Fill all five self-review cells, pick a rating, click **Submit Q3 · CY 26-27 Self-Review**.
2. Confirm in the dialog ("One submission per quarter, locked afterwards…").

**Expected:**
- Toast "Q3 · CY 26-27 self-review submitted". Quarter progress shows **Self-review · Submitted**; note "Q3 · CY 26-27 self-review submitted on <date>. Stefan Bauer's comments will fill the last column once Rahul Verma has entered them."
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
- Note "Q3 · CY 26-27 reviewed on <date> by Stefan Bauer, entered by Rahul Verma."; quarter progress "Miltenyi review · Submitted"; Q3 pill hint "Reviewed".
- Each Miltenyi review cell shows the comment with the attribution "Stefan Bauer · Miltenyi"; a Secondary review, if the mentor added one, is shown separately and labelled "Secondary review · Rahul Verma".
- Footer: self rating visible; "Final rating is hidden until the Admin releases Q3 · CY 26-27's ratings".
- Button **Acknowledge Q3 · CY 26-27 review** with the text "Acknowledging confirms you have read this quarter's review; it does not signal agreement."

---

### TC-PG-011 — Ratings released per quarter

**Pre-condition:** Admin turns **Q3 · CY 26-27 ratings visible** on (TC-PG-045).
**Login as:** Staff (Aarav)
**Expected:** Under Q3 the footer now shows the final rating as "Final rating · given by Stefan Bauer" (or "given by Healthark" when the mentor chose that). Under Q1/Q2 a submitted final rating stays hidden until their own switch is turned on.

---

### TC-PG-012 — Acknowledge

**Login as:** Staff (Aarav), Q3 selected
**Steps:** Click **Acknowledge Q3 · CY 26-27 review**.
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

### TC-PG-016a — The "Additional goals" row (HR requirement)

**Pre-condition:** Admin turned **Additional goals row** on in System Settings (Project Goals column) with weightage 10 % and saved.
**Login as:** Staff (Kabir, no set yet), then Mentor (Rahul)
**Expected:**
- **Start goal set** creates the KPI rows plus one last row marked **+** and titled **Additional goals** — "Anything else you are working on this year, agreed with your reviewer · optional" — with the 10 % chip. The framework band's note ends with "plus one optional "Additional goals" row at 10%".
- The row is optional everywhere: **Submit Goals** enables once every *KPI* row is filled even if this row is empty; the same for the self-review and for the mentor's review. An empty row reads "No additional goals" on the read-only views.
- Text written in it is reviewed like any other row: self-review and Miltenyi comment cells work the same.
- Draft sheets follow the Admin's setting: turning the switch off removes the empty row from drafts (a filled one stays), changing the weightage updates drafts; submitted and approved sheets keep the row and weightage they were created with. The setting is carried into the next goal year at roll-over.

---

## 7.2 Mentor — Team Goals queue and set page

### TC-PG-020 — Team Goals queue for one quarter

**Login as:** Mentor (Rahul)
**Steps:** Click **Project Goals**.
**Expected:**
- Title "Project Goals · CY 26-27" with the mentor explanation ("You record the offline approval once and enter the Miltenyi reviewer's comments each quarter.").
- The **Quarter** bar (Q1–Q3 selectable, Q3 current and pre-selected, Q4 locked). Changing the quarter reloads the two review columns; the URL keeps `?cycle=`.
- Filters: search (name, email, designation, mentor, Miltenyi reviewer), **Function**, **Level**, **Goals** (Not started, Draft, Submitted, Approved, No framework) and **Q3 · CY 26-27** (Self-review pending, Review pending, Reviewed, Acknowledged). The Admin also gets a **Mentor** filter (with "No mentor").
- Under the filters one summary line: "Showing 3 of 3 staff · 1 awaiting approval · 2 Q3 · CY 26-27 reviews to enter". There are no count chips.
- Columns: Staff member · Function · level · (Admin only: Mentor) · Miltenyi reviewer · Goals · year · **Q3 · CY 26-27 self-review** · **Q3 · CY 26-27 review** · Actions. No Trials column.
- Actions: **Mark approved** (goals Submitted), **Enter Q3 review** (goals Approved and the quarter's self-review Submitted; Admins also without it), **Open** (everything else with a set), "Not started" text for no set, and "No framework for this level" in red when the function × level row is missing.
- Only the mentor's own mentees are listed.

---

### TC-PG-021 — Open a set

**Login as:** Mentor (Rahul)
**Steps:** Click **Open** / **Mark approved** on Aarav.
**Expected:**
- Header "Aarav Patel · Regulatory Affairs Associate · Regulatory Affairs · CY 26-27" and a line "Mentor: Rahul Verma · Miltenyi reviewer: Stefan Bauer" (no Trials).
- **Back to team** returns to the queue. One tab: **Goals & reviews · CY 26-27** (there is no change log).
- The same table as the staff member sees, with the Goal column read-only. Once the set is approved, the same **Quarter** bar as the staff member's, pre-selected to the quarter chosen in the queue.

---

### TC-PG-022 — Mark approved (agreed offline)

**Login as:** Mentor (Rahul), set in **Submitted**
**Steps:**
1. Click **Mark approved (agreed offline)**.
2. Check the dialog: **Miltenyi reviewer** is prefilled with the staff member's reviewer name, **Agreed on** defaults to today, optional note.
3. Confirm with **Mark approved**.

**Expected:**
- Status badge **Approved · agreed offline**; the quarter bar appears; under the current quarter the note reads "Aarav Patel has not submitted a Q3 · CY 26-27 self-review. You can draft Stefan Bauer's comments now; submission waits for the self-review."
- Staff member receives a bell notification and an email. The approval note is visible to mentor and Admin only.
- The dialog cannot be confirmed with an empty reviewer name or date.

---

### TC-PG-023 — Draft the Miltenyi comments before the self-review

**Login as:** Mentor (Rahul), set **Approved**, Q3 selected
**Expected:**
- Above the table: provenance fields **Miltenyi reviewer** (prefilled) and **Input received on** (date), plus **Entered by** = the mentor. There is no Source field.
- Each Miltenyi review cell has two boxes: "Type or paste Stefan Bauer's Q3 · CY 26-27 words for this KPI." and **Secondary review · optional** ("Your own observation as the mentor, shown to the staff member as the secondary review.").
- Footer: **Final rating** (1–5) and **Given by** toggle (Stefan Bauer / Healthark).
- **Save Draft** → toast "Review draft saved". **Submit Q3 · CY 26-27 Review** is disabled with hover text "Waiting for the staff member's self-review".
- The staff member cannot see any of this yet (TC-PG-009). Likewise, while the staff member's self-review is only a **draft**, the mentor's Self review column shows "Awaiting self-review" and the queue shows "Draft" without the rating.
- Selecting **Q1** shows Q1's own (empty) review; drafts are per quarter.

---

### TC-PG-024 — Submit the quarter's review

**Pre-condition:** Staff member completed TC-PG-008 for Q3.
**Login as:** Mentor (Rahul), Q3 selected
**Steps:**
1. Confirm the Self review column now shows the staff member's text and self rating; note "Q3 · CY 26-27 self-review in (<date>)…".
2. Fill every Miltenyi comment, set the final rating, click **Submit Q3 · CY 26-27 Review**, confirm ("This publishes Stefan Bauer's Q3 · CY 26-27 comments and the final rating to Aarav Patel. The review is final once submitted; only the Admin can unlock it.").

**Expected:**
- Toast "Q3 · CY 26-27 review submitted"; the quarter progress row shows **Miltenyi review · Submitted** (and, later, the acknowledgement date). No further note is shown.
- The table is read-only; there is **no Edit button**. **Submit** stays disabled while any Miltenyi comment or the final rating is missing (hover text names the rule). Secondary reviews are optional.
- Staff member receives a bell notification and an email.

---

### TC-PG-025 — A submitted review is final

**Login as:** Mentor (Rahul), Q3 reviewed
**Expected:** No Edit button anywhere on the set page; every Miltenyi review cell and the provenance fields are read-only. Any attempt to save through the API is refused with "The Q3 · CY 26-27 review is already submitted and cannot be edited. Ask the Admin to unlock it if it needs a correction." (409). The correction path is TC-PG-032 (Admin unlock, then the mentor edits and resubmits).

---

### TC-PG-026 — (removed 11 Sep 2026)

The change log tab was dropped from the set page. Actions are still recorded in the database for audit but have no screen.

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
**Expected:** Same layout as the mentor queue (quarter bar included) but titled **All Goals**, listing every Staff member, with a **Mentor** column and filter in addition, and the Function filter covering all functions that have staff. "No framework" rows show in red and are counted in "Showing N of M staff".

---

### TC-PG-031 — Admin can act as reviewer

**Login as:** Admin (Aanya)
**Expected:** The Admin can open any set, mark it approved and enter/submit any started quarter's review exactly like the mentor. When the staff member has not self-reviewed that quarter, the Admin alone sees an amber **Submit anyway (Admin)** button; mentors never see it. Forced submissions are recorded in the change log with the reason "forced past missing self-review".

---

### TC-PG-032 — Unlock a quarter's review / unlock goals

**Login as:** Admin (Aanya), Q3 reviewed and acknowledged
**Steps:**
1. With Q3 selected, click **Unlock Q3 · CY 26-27 review**; read the dialog ("The review goes back to draft so the mentor can correct it. The staff member's acknowledgement for this quarter is cleared; their self-review is kept…"). **Reason** is mandatory.
2. Confirm.

**Expected:**
- Q3's review is a draft again, the Q3 acknowledgement is gone, the self-review and every other quarter are untouched.
- Staff member **and** mentor receive a bell + email quoting the reason. The mentor can now edit the Q3 review again and resubmit it.
- **Unlock goals** (shown while the set is Submitted or Approved) returns the set to Draft and clears the approval record — but is **refused once any quarter's self-review or review has been submitted** ("Reviews have already been submitted against these goals (Q3 · CY 26-27…). Unlock the quarter's review instead.").
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
- The edit dialog has four fields: **Function**, **GCC designation** (filtered by the chosen function; the level follows the designation and is shown read-only), **Reviewer (Mentor)** and **Miltenyi reviewer**. **Save** → toast "Mapping saved"; the same values show on the Users tab, in the queue rows and in the staff member's page header.
- A staff member whose goals for the current year exist (Draft, Submitted or Approved) shows a small lock note "Goals …" under the status; in their dialog Function and GCC designation are disabled with an amber note, and the API refuses such a change with "… has CY 26-27 project goals in progress (…). Function and designation can change once the next goal year starts." (409). The same rule applies when editing the user on the Users tab. Promotions are recorded between goal years.
- Only Admins see this tab. The Admin Panel tabs are **Users · Exports · System Settings · Framework Mapping · Framework** — there is no Projects tab.

---

### TC-PG-041 — Framework tab: matrix and staged edits

**Login as:** Admin (Aanya)
**Steps:**
1. Admin Panel → **Framework**. Select **Biostatistics**.
2. In the KPI row for Level 1 click **Edit KPIs**, change one weightage so the total is not 100, click **Done**.
3. Fix the weightages so the total is 100 again, click **Done**, then **Save**.

**Expected:**
- Function select lists every function; those without a level column are marked "(no levels yet)". A pencil next to the select renames the function.
- Summary chip "20 KPIs · 4 levels defined · CY 26-27".
- **Designations → levels** strip: each designation of the function with a level select 1–12 (changes apply immediately, toast "Designation level updated") and a pencil to rename it.
- Matrix: one column per defined level (levels 1–4 also show their band name Entry / Mid / Senior / Lead), rows *Outcomes*, *Functional goals* and *KPI / Success Measures · Weightage* with a **Total 100%** badge, plus a last **Add level** column.
- While the total is not 100 the badge turns red and **Save** is disabled. **Discard** drops all staged edits.
- **Save** → toast "Framework saved".
- The Framework tab holds content only; every switch is in System Settings.

---

### TC-PG-042 — Add a level column, a function and a designation

**Login as:** Admin (Aanya)
**Steps:**
1. Select a function with a missing level (or a new one). In the **Add level** column type the level number (1–12, free levels are listed) and click **Add**.
2. Fill the new column in the table: role title in the header, the two paragraphs, the KPIs (five default weightages 30/25/20/15/10, total must be 100). Click **Save**.
3. Click **Add function**, type a name, save. Click **Add designation**, type a name, pick the function and a level (integer 1–12), save.

**Expected:**
- The new column is highlighted with a "new" tag until saved; the X in its header drops it. **Save** → toast "Framework saved"; the column becomes a normal level column.
- Toast "Function added": the new function appears in the select (and on the Users tab). Toast "Designation added": the designation appears in the strip with its level (levels 5–12 have no band name) and in the Users tab's designation list.
- Staff whose designation sits at the new level now read **Mapped** in Framework Mapping and see the band on their Project Goals page (TC-PG-013).
- Adding a level that already exists is not offered; a duplicate function or designation name is refused (409).

---

### TC-PG-043 — System Settings: one year, one Save

**Login as:** Admin (Aanya)
**Steps:** Admin Panel → **System Settings**. From top to bottom: the **Quarter roll-out** card (full width), the **Configure year** dropdown with the single **Save CY 26-27 configuration** button, then two columns for that year — **Annual Reviews / Annual Goals** on the left and **Project Goals** on the right — then **Calendar** (and **Developer** when date simulation is enabled). Flip one switch in each column, click Save, read the confirmation, apply.
**Expected:**
- Years are labelled **CY yy-zz** everywhere (the fiscal year and the goal year are the same April-to-April span). The dropdown marks the current year "(Current)"; a year without Project Goals reads "— annual only", a past goal year "— goals open for backfill" or "— goals closed".
- Project Goals switches for the year: **Goal entry open** → TC-PG-014, **Weightages visible to staff** → TC-PG-015, **Additional goals row** with its weightage → TC-PG-016a, for a past year **Year open for backfill** (TC-PG-046), and a **Quarters** table with one row per started quarter and two switch columns: **Open for backfill** (the current quarter shows an "always open" chip instead) → TC-PG-007a and **Ratings visible** → TC-PG-011. There is **no** "self-review window" switch. For a year without a goal year the right column says "No Project Goals year exists for CY yy-zz…".
- Nothing saves on click. The Save button shows the number of staged flips, and the dialog lists every flip tagged **Annual** or **Project Goals** (ON → OFF) with impact lines from the live data, e.g. "3 staff members have not started goals and 1 draft set is still being written…" or "Q3 · CY 26-27: 1 submitted review will show their final rating to staff." **Apply changes** → toast "Configuration saved for CY 26-27."; both columns persist after refresh.
- With no active goal year at all, an amber notice in the right column offers **Make CY 26-27 the active year**.

---

### TC-PG-044 — Quarter roll-out card

**Login as:** Admin (Aanya)
**Steps:** Same section, card **Quarter roll-out · the review window**.
**Expected (UAT seed):**
- "Current review quarter **Q3 · CY 26-27**"; a strip of four tiles: Q1 and Q2 "open · backfill" with their opened date, Q3 "current", Q4 locked "Not started".
- Buttons: **Roll out Q4 · CY 26-27** (primary); **Set manually** select (Q1, Q2, Q4 of CY 26-27 and **Q1 · CY 27-28 (new year)**) with **Set**; **Show roll-out log**. A line under the tiles explains that after Q4 the roll-out starts CY 27-28 all closed while CY 26-27 stays open for backfill.
- Click **Roll out Q4 · CY 26-27**: a dialog "Q3 · CY 26-27 → Q4 · CY 26-27" with **What will change** (Q4 becomes current; earlier quarters stay open for backfill with the pending counts of Q3, e.g. "Q3 · CY 26-27 still has 2 self-reviews and 3 reviews pending"; everyone gets an announcement; the move is logged) and **What won't change** (approved goals; other quarters' submissions; ratings stay hidden until released). Confirm → toast "Current quarter: Q4 · CY 26-27"; the Q4 tile becomes *current*; a **Roll back to Q3 · CY 26-27** button appears; the primary button now reads **Start CY 27-28 · NEW YEAR**.
- Every user's bell shows "Project Goals moved to Q4 · CY 26-27…" (no email). Staff pages now offer Q4 and keep Q1–Q3 open.
- Click **Roll back to Q3 · CY 26-27** → dialog (amber) "Quarters after Q3 · CY 26-27 are closed again. Nothing already submitted is deleted…" → confirm → current is Q3 again, the Q4 tile is locked again, the log shows *rollback* above *rollout*, each with actor and time. Roll back always means one quarter earlier than the current one: the button now offers **Q2 · CY 26-27**; at Q1 it offers Q4 of the previous goal year, or disappears when there is none.
- **Set manually** to Q1 → dialog (amber, backwards) → confirm → Q1 current, Q2/Q3 locked; existing Q3 submissions stay readable on the staff and mentor pages but cannot be edited. Set back to Q3.

---

### TC-PG-045 — Ratings released per quarter

**Login as:** Admin (Aanya)
**Steps:** In the **Project Goals · CY 26-27** column, **Quarters** table, turn on the **Ratings visible** switch of the Q3 row, click **Save CY 26-27 configuration**, apply.
**Expected:** One switch per started quarter (Q1, Q2, Q3). The confirmation says how many submitted Q3 reviews will show their rating. Only Q3's final rating becomes visible to staff (TC-PG-011). A quarter that has not started has no switch.

---

### TC-PG-046 — Year roll-over (Q4 → Q1 of the next year), backfill and closing a year

**Login as:** Admin (Aanya), current quarter set to Q4
**Steps:**
1. Click **Start CY 27-28 · NEW YEAR** (or Set manually → Q1 · CY 27-28).
2. Try to confirm without typing; then type `CY 27-28` and confirm.
3. Later: pick **CY 26-27 — goals open for backfill** in **Configure year**, turn **Year open for backfill** off, Save, apply.

**Expected:**
- The dialog explains that CY 27-28 begins **all closed** (goal entry off until you open it), the framework is carried over, and that CY 26-27 stays open for backfill with its pending counts. It carries an amber block "This starts a new goal year. Type CY 27-28 to confirm."; **Start CY 27-28 · Q1 · CY 27-28** stays disabled until the exact label is typed (the API answers 400 without it).
- After confirming: the topbar reads **CY 27-28 · Q1 · current quarter**; the year dropdown lists **CY 27-28 (Current)** and **CY 26-27 — goals open for backfill**; **Goal entry open** is off for CY 27-28 (open it when the framework is ready); the Framework tab shows the CY 27-28 matrix with the same rows as CY 26-27.
- Staff see "Goal entry is closed for CY 27-28" until you open it, then "Start your CY 27-28 goals". Their **Goal year** dropdown offers **CY 26-27 · open for backfill**: the old set is still there and its started quarters (including Q4) still accept self-reviews. Mentors and Admins get the same **Goal year** dropdown on the queue; the past year's quarters accept reviews.
- Everyone gets the announcement "…CY 27-28 is the new goal year — goal entry opens once the Admin releases it; CY 26-27 stays open for backfill until it is closed."
- After step 3 the CY 26-27 quarters are read-only for everyone ("CY 26-27 is closed…" on any save); the year still shows in the dropdowns as **closed** and stays readable. With the year switch on, individual quarters of the past year can still be closed one by one with their own switches.
- **Roll back to Q4 · CY 26-27** (offered while Q1 · CY 27-28 is current) returns to the old year: CY 26-27 becomes the review year again with its saved switches, CY 27-28 is kept but inactive.

---

### TC-PG-047a — Calendar card and Developer section

**Login as:** Admin (Aanya)
**Expected:** Below the two columns, the **Calendar** card shows four read-only values: **Annual goals & reviews** (e.g. H1 · CY 26-27), **Project Goals** (CY 26-27 · Q3 current), **Year start month**, **Organisation timezone** — plain text, no disabled inputs. There is **no** "Bypass the H1/H2 review-window calendar" switch anywhere. The **Developer** card appears only when the backend allows date simulation and then holds the Simulated today field and its Save simulation button.

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
- **Topbar:** two pills — the Project Goals year (**CY 26-27**) and the current review quarter (**Q3 · current quarter**). No financial-year pill and no "Project · Q…" pill.
- **Staff page and mentor / Admin queue:** a **Goal year** dropdown appears once more than one goal year exists (TC-PG-046).
- **Staff dashboard:** Active cycles card shows Fiscal Year and Goal Review Cycle only; the My Reviews card has no Project Reviews sub-section.
- **Admin dashboard:** no Project Review Completion card and no Project Coverage card; the Active Personnel donut shows Staff / Mentors / Admins.
- **Mentee page:** tabs Annual Summary · Annual Goals · Annual Review (no Projects tab).
- **Admin Panel:** no Projects tab; **Exports** quick downloads are Users · Annual Goals · Annual Reviews only; the combined workbook has three sheets (Users, Annual Goals, Annual Reviews) and the per-employee workbook has Profile, Annual Goals, Annual Reviews.
- Typing `/project-reviews` in the address bar redirects to the dashboard; `/api/v1/project-reviews/...`, `/api/v1/projects` and `/api/v1/export/project-reviews.xlsx` answer 403; `/api/v1/export/projects.xlsx` answers 404.

---

### TC-PG-061 — Topbar year and quarter

**Login as:** any role
**Expected:** The topbar shows **CY 26-27** (amber) and **Q3 · current quarter** (brand). After the Admin rolls out Q4 (TC-PG-044) the second pill reads **Q4 · current quarter** on the next page load; before the first roll-out it reads "No quarter rolled out"; without an active period it reads "No goal year set".

---

## 7.6 Notifications in this module

Bell = in-app notification (Topbar). Email is sent in addition when SMTP is configured (same wording, subject in brackets). Deep links open the set with the quarter pre-selected.

| Event | Recipient | Bell | Email subject |
|---|---|---|---|
| Staff submits goals | Mentor | "<Staff> submitted their CY 26-27 project goals. Confirm the offline agreement and mark them approved." | "<Staff> submitted their CY 26-27 project goals" |
| Mentor/Admin marks approved | Staff | "Your CY 26-27 project goals were marked approved (agreed with <name>). They are locked for the year; quarterly self-reviews run against them." | "Your CY 26-27 project goals are approved" |
| Staff submits a quarter's self-review | Mentor | "<Staff> submitted their Q3 · CY 26-27 self-review. Enter <Miltenyi reviewer>'s comments when they arrive." | "<Staff> submitted their Q3 · CY 26-27 self-review" |
| Mentor/Admin submits a quarter's review | Staff | "<Miltenyi reviewer>'s Q3 · CY 26-27 comments on your project goals are in, entered by <Mentor>." | "Your Q3 · CY 26-27 project goals review is in" |
| Admin unlocks goals or a quarter's review | Staff **and** Mentor | "The Admin unlocked the <CY 26-27 goals / Q3 · CY 26-27 review> on <Staff>'s project goals: <reason>" | "Project goals unlocked: …" |
| Admin rolls a quarter out / sets / rolls back | Every active user (except the Admin who did it) | "Project Goals moved to Q4 · CY 26-27. Self-reviews and Miltenyi reviews for Q4 · CY 26-27 are open; earlier quarters of CY 26-27 stay open for backfill." (year change: "…CY 27-28 is the new goal year…"; roll back: "…Quarters after it are closed again.") | bell only |

Self-notifications are suppressed (an Admin acting as the mentor of record is not pinged about their own action). Nothing is emailed for drafts or acknowledgements.
