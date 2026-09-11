# Miltenyi Goals Gap Review

*Gap review · meeting of 2 Sep 2026 · analysis only, no code changed*

What the Sep-2 "Miltenyi PMS changes" meeting asked for, compared point by point with what the PMS does today. Written for Zaahid's review before the UI mock. Every requirement carries who said it and when, what the code does now with file references, the type of gap, options, and the questions still open.

Styled, filterable version: https://claude.ai/code/artifact/22058605-2414-403e-8548-8612375731e4

- **Sources** 27-min transcript (Shreshta Anantha, Gautham S, R M Saivignesh, Aakash Pawar, Zaahid Vohra, Amit Kumar Jha) · 7 "CY 2026 Indicative Goal Themes" PDFs · `docs/Pivot-Plan.md` · the code at HEAD d865440

- **Method** 8 subsystem surveys of the repo, structured extraction of all 7 PDFs from page images, 33 merged requirements, then three adversarial passes (code facts, transcript fidelity, completeness) whose corrections are folded in

- **Updated** 4 Sep 2026 with Zaahid's answers: no instance is live (the build was handed over for UAT and these requirements arrived afterwards), Healthark accounts use healthark.ai, and the seeded Miltenyi logins are placeholders

Gap types: **new** = does not exist · **change** = exists, must change · **conflict** = collides with a current design decision · **decide** = left open in the meeting, blocks design · **none** = no code change · **content** = document or data gap · **▲ your call** = needs a decision before the mock.

## 1. The six decisions that shape everything else

These are the points where the meeting and the current build disagree at the architecture level. Every item in Part 3 hangs off one of them.

### D1 — Unit of evaluation: per employee, not per project

**Today.** One project-review row per employee × project × cycle, written by that project's PM (`backend/app/models/project_review_models.py:60-99`). An employee on three trials gets three cards and possibly three ratings (`frontend/src/pages/ProjectReviews.tsx:141`).

**Meeting.** One goal set per employee covering all trials, reviewed by one person. Gautham: "There will be just one" 00:12:57, "it can just be one" 00:14:08. Shreshta: "they'll all report into one person" 00:15:08; "very rarely does anybody work across teams" 00:15:59.

**Verdict.** The goal set must key on employee × period. The project-scoped row cannot be bent into this without re-keying every queue, counter and export.

### D2 — Who is the in-system reviewer

**Today.** Only `Project.pm_id` can write an evaluation; the PM must have role PM (`backend/app/api/routes/project_routes.py:70-86`) and a Miltenyi email domain (`backend/app/api/routes/admin_routes.py:846-876`). The secondary pool was narrowed to PM or HR_Miltenyi in commit d7e490e as "a Miltenyi-side editorial gate" (`project_routes.py:89-115`). Healthark HR can overwrite any PM-created row but cannot create or submit one (`backend/app/api/routes/project_review_routes.py:1853-1896`). Mentors have no write path. No table records "entered by X on behalf of Y".

**Meeting.** Miltenyi staff will not log in; a Healthark person enters the Miltenyi primary reviewer's inputs and their own. Gautham 00:15:08, 00:20:23; Shreshta: "I will be primary reviewer and Purva might be secondary… input it on their behalf" 00:15:59.

**Verdict.** The PM-as-Miltenyi-login premise of the pivot plan is inverted for this flow. A reviewer of record at employee level, a Healthark actor allowed to write, and provenance fields are all new.

### D3 — Framework shape

**Today.** Six prose axes per function × career level in `role_expectations` (`backend/app/models/role_expectation_models.py:47-53`), mirrored by six PM comment columns and one frontend constant (`frontend/src/constants/gccFramework.ts:46-83`). No KPI list, no weightage, no outcome paragraphs, no admin editing; content is seed-only (`backend/seed_data/gcc.py`) and the seed skips when rows exist (`backend/seed.py:125, 479`).

**Meeting.** Per function × level: a Business & Strategic Outcomes paragraph, a Functional/Operational Excellence Goals paragraph, and 4 to 7 KPI bullets each with a weightage summing to 100 (Gautham 00:05:17; the PDFs).

**Verdict.** New reference tables with a variable-length KPI list. Six fixed columns cannot hold it.

### D4 — Goal-setting has no comment loop

**Today.** The only employee-authored goal flow is Annual Goals: draft → pending_approval → (changes_requested ↔ draft) → approved, approver is the employee's Mentor only, HR cannot approve (`backend/app/models/goal_models.py:8-38`; `backend/app/api/routes/goal_routes.py:1031-1120`); creation is refused without a live mentor (`goal_routes.py:271-296`).

**Meeting.** Gautham: goals are pre-approved offline, entered once, "there's no back and forth" 00:19:35. Saivignesh's "the PM clicks on approve or whatever, the status changes, those get logged" 00:19:35 went unchallenged and was swept into Gautham's "Yes, correct" to the whole flow 00:20:23.

**Verdict.** Do not reuse the approval state machine. Draft → submitted → locked, with an "approved offline, recorded by" stamp, is what was described.

### D5 — Evaluation is per KPI on both sides, with ratings

**Today.** Goal self-reviews and mentor reviews are one paragraph each per half-year, no rating (`backend/app/models/goal_self_review_models.py:76`, `goal_mentor_review_models.py:52`), a deliberate collapse from eight boxes (migration b6e3a9d4c5f7). Project reviews: six PM comments, one 1–5 rating, no employee input (`project_review_models.py:4`).

**Meeting.** After the cycle the employee writes a self-review "in front of each" KPI and gives a rating "project wise"; the reviewer writes comments in the boxes and a final rating (Saivignesh 00:20:23; Gautham "Yes, correct. That's right."). Gautham 00:20:23: "we take in their inputs, update it, and then the secondary reviewer… will update their comments" — two authors per KPI.

**Verdict.** Per-KPI children for self text, transcribed primary comment and Healthark comment; one self rating and one final rating per cycle (the transcript never asks for a rating per KPI or a weighted roll-up). Reuse the 1–5 scale and badge.

### D6 — Cadence is unconfirmed and the calendar does not line up

**Today.** Miltenyi is seeded quarterly with an April fiscal start, so today reads "Q2 FY26-27" (`backend/seed.py:351-368`; `backend/app/core/cycle_utils.py:389-421`). Goal reviews are hard-locked to H1/H2 (`goal_routes.py:99-115`). Nothing enforces "only after the period closes"; project-review creation is pinned to the active cycle (`project_review_routes.py:822`).

**Meeting.** The PDFs are "CY 2026". Saivignesh assumed quarterly evaluation "after the quarter ends" 00:19:35 as a hypothetical; nobody confirmed. Shreshta framed the goal set as "this one round… the first year" 00:03:13, so the set itself is annual.

**Verdict.** Given today is 4 Sep 2026 and Gautham is out the week of 7 Sep, goals enter in October at the earliest and CY 2026 gets exactly one evaluation, after 31 Dec. Quarterly is moot for year one; the period must still be fixed before the data model is, because it is part of the goal set's key.

## 2. The framework Gautham shared, structured

All seven documents were parsed from the page images because plain text extraction misaligns the weightage column. Every level totals 100%. Titles are as printed.

| Function | L1 | L2 | L3 | L4 | KPIs per level (weights) |
|---|---|---|---|---|---|
| Biostatistics | Statistical Programmer | Biostatistician | Senior BioStatistician | Lead Biostatistician/Specialist | 5 (30/30/20/10/10) · 5 (25/30/20/15/10) · 5 (25/25/25/15/10) · 5 (30/25/20/15/10) |
| Clinical Data Management | Clinical Data Management Associate | Clinical Data Manager | Senior Clinical Data Manager | Lead - Clinical Data Manager | 5 (20/20/20/25/15) · **6** (20/15/20/15/15/15) · **6** (25/25/15/10/15/10) · 5 (30/25/20/15/10) |
| Clinical Trial Finance | Clinical Finance Analyst | Senior Clinical Finance Analyst | Clinical Finance Manager | Lead Clinical Finance Manager | 5 each (30/25/20/15/10) |
| Clinical Trial Management | Clinical Trial Associate | Clinical Trial Manager | Senior Clinical Trial Manager | Lead - Clinical Trial Manager | 5 (30/25/20/15/10) · **6** (20/20/20/10/20/10) · **4** (30/10/30/30) · **7** (20/15/15/5/15/15/15) |
| Legal | Legal Associate | Legal Counsel | Senior Legal Counsel / Legal Manager | Lead Legal Counsel | 5 each (30/25/20/15/10) |
| Medical Writing | Medical Writing Associate | Medical Writer | Senior Medical Writer | Lead - Medical Writer | 5 each (30/25/20/15/10) |
| Regulatory Affairs | Regulatory Affairs Associate | Senior Regulatory Affairs Associate / Regulatory Affairs Specialist | Regulatory Affairs Manager | Regulatory Affairs Lead | 5 each (30/25/20/15/10) |
| Pharmacovigilance | No document. Seeded with 4 designations and 4 six-axis expectation rows; the stakeholder test seed places 3 employees and 1 PM here (`backend/miltenyi-test-seed.py:232-238, 280-301`). |  |  |  | — |

### What this means for the build

- **Every function has exactly four levels.** That lines up one-to-one with today's `career_level` 1..4 (`backend/app/models/reference_models.py:33-34`), so the existing band is a sound default mapping. In the meeting Gautham first agreed to "four", then said "three three" for biostatistics 00:21:33; the PDF has four.
- **The seeded designation titles were evidently transcribed from the same source.** They match the PDF row titles almost everywhere. Differences: Biostatistics L4 "Lead Biostatistician/Specialist" (PDF) vs "Lead Biostatistician" (seed, `backend/seed_data/gcc.py:56`); Medical Writing L4 "Lead - Medical Writer" vs "Lead Medical Writing" (`gcc.py:77`); the seed has an extra "Data Analyst" at Biostatistics L1 (`gcc.py:53`) that no document covers.
- **KPI count is not "four or five".** It ranges 4 to 7. The UI and schema must render a variable-length ordered list.
- **Many KPI texts already embed numeric targets** ("≥98% TMF completeness", "enrolment within +/- 10%"). Gautham's measurability wish is partly satisfied by the reference text itself.
- **The documents are a moving draft, not a spec.** Tracked-change bars appear on every page; two KPIs are truncated in the source (Regulatory Affairs L4 "Health Authority Engagement and Regulatory", Clinical Trial Associate "Site queries resolved within agreed"); Legal L4's fifth KPI has no bullet. The footer says themes are "directional guidance… to be contextualized by respective function leaders". If function leaders produce team variants, the framework key becomes team × level, not function × level.
- **The file named "Clinical_Trial_Finance_Writing"** contains only Clinical Finance roles and titles itself "Clinical_Trial_Finance". Medical Writing has its own document. Treat the filename as an artefact; confirm with Gautham.

## 3. Point by point — 33 requirements

Each record: what the meeting said (who, when) · what is built today (evidence) · the gap · what changes · options and a recommendation · what is still open · risk and effort. The independent transcript extraction found 64 fine-grained items; merged with the hand-written list they became these 33.

### Cluster A — Does goal-setting exist; one set per employee

*Decisions D1 and D4 live here.*

#### R01 — Enable project goal-setting
*decided · new · risk high · effort XL · ▲ your call*

- **Meeting:** Shreshta 00:00–00:02: today employees "just align to those expectation framework and you're evaluated against those"; for the Miltenyi instance "we will have to enable" employees adding project goals. Scope is this instance only; Shreshta noted Healthark runs separate instances (RWE has two) 00:23:28.
- **Today:** No employee-authored artefact exists in the project-review module; the employee's only surface is a read-only "My Reviews" list (`project_review_routes.py:476-595`; "No self-review" in `project_review_models.py:4`). The pivot plan fixed this on purpose (decision 5, `docs/Pivot-Plan.md:21`). Annual Goals is the only employee-authored goal flow (title, description, attachment URL; `goal_models.py:75-86`), routed to the Mentor.
- **Changes:** A new employee write surface (goal set), new reference data (D3), reviewer wiring (D2), review records (D5), a page or tab, permissions, notifications, exports, QA docs.
- **Options:** See Part 5 (extend Project Reviews / extend Annual Goals / new module). Recommendation: a new Project Goals module keyed on employee × period, reusing UI and gating patterns.
- **Open:** **Does the mentor-driven Annual Goals flow continue in parallel for Miltenyi employees** (two goal-setting exercises a year), or does this replace it for them? Not discussed.

#### R02 — Goals tailored to trial targets
*decided · none · risk low · effort S*

- **Meeting:** Shreshta 00:01:13: employees take the framework and "tweak it and add some KPIs to meet the target of the specific study" (a trial expecting 60% of patients to stay to the end).
- **Today:** No trial-target field anywhere; projects carry only a description (`backend/app/models/project_models.py:40-44`).
- **Gap:** Nothing beyond R05. Under the qualitative ruling the tailoring lives inside the employee's text box. The transcript settles that the KPI is the fixed heading and the employee's text carries the measurable definition: Shreshta "do they need to further define that KPI, like what does timely mean" 00:07:27; Gautham "under this particular KPI there should be a text box" 00:10:20.
- **Options:** KPI text stays read-only reference; the employee's box carries the trial-specific version. Optionally show the employee's active trials as read-only chips from `project_assignments`. Snapshot KPI text and weightage onto the goal set at creation so a later framework edit does not rewrite history.

#### R10 — One goal set per employee, not per trial; one reviewer
*decided · conflict · risk high · effort L · ▲ your call*

- **Meeting:** Saivignesh asked about three trials with two PMs. Gautham "There will be just one" 00:12:57, multi-trial staff write trial-specific content "in the same text box itself" 00:14:08. Shreshta: one regional reporting manager per employee 00:15:08; "what Gautham is saying I think is what we will do" 00:15:59. Who works across trials: Shreshta and Amit (Gautham), the PV team (Gautham), the global-team statisticians and some clinical data managers (Shreshta) 00:14:08.
- **Today:** D1. PM dashboard, HR completion donut and mentee stats all count per project row (`backend/app/api/routes/dashboard_routes.py:175-280, 522-551`; `backend/app/api/routes/mentee_routes.py:155-188, 453-503`). Annual goals are per user with no project FK, but nothing limits one set per FY (indexes are non-unique, `goal_models.py:106-110`).
- **Changes:** New unit (employee × period) with a unique constraint; reviewer assignment moves from the project to the employee; decide the fate of the per-project PM evaluation for this instance.
- **Options:** (a) Run both: keep PM project reviews and add the employee goal set — double evaluation, confusing. (b) The goal-set review becomes the project evaluation for Miltenyi and the PM queue is hidden here — recommended, behind an org feature flag. (c) Attach the set to a "primary project" — artificial.
  If (b): `Project.pm_id` is still required at create (`backend/app/schemas/project_schemas.py:147-150`) so HR must still nominate a PM login to create a trial; PM logins land on a dashboard branch that will read 0/0 (`frontend/src/pages/EmployeeDashboard.tsx:99-128`); the employee widget's count of reviewed project rows reads 0 (`frontend/src/components/dashboard/MyAnnualReviewWidget.tsx:148-182`); the Mentor "Team Review" tab, the mentee Summary tab's per-project rating cards, four export endpoints and the d7e490e secondary narrowing all lose their purpose. Relax `pm_id` to optional and give both widgets a goal-set state.
- **Open:** **Confirm (b) with Saivignesh and Shreshta.** Whether projects survive only as trial context.

### Cluster B — Qualitative this year

#### R03 — Keep goal entry qualitative; structured OKR/SMART flow deferred
*decided · deferred · none · risk low · effort S*

- **Meeting:** Saivignesh proposed OKR/SMART fields 00:02:12. Shreshta 00:03:13: keep it qualitative and open-ended because "we are yet to do this one round… we are not sure what level of detail they're expecting"; revisit next year.
- **Today:** Free text everywhere; structured goal criteria were retired in June (migration b8c19fa3d420).
- **Options:** One textarea per KPI with a generous cap (today's caps are 3000 chars frontend / 5000 backend on PM comments, `frontend/src/components/project-reviews/EvalModal.tsx:35`, `backend/app/schemas/project_review_schemas.py:46-51`; reconcile them) and placeholder guidance such as "state what timely and accurate mean for your trial". Multi-trial employees write longer text, so avoid a tight cap. Do not resurrect criteria.

#### R09 — Measurability — never addressed as a system feature
*not addressed · none now*

- **Meeting:** Gautham 00:07:27: "it should be measurable as well… we expect 90% accuracy". Nobody responded to the measurability point itself; Shreshta's "qualitative" ruling 00:03:13 predates it and was aimed at Saivignesh's fields, and her later intervention 00:10:20–00:12:57 is solely about weightage.
- **Today:** Nothing.
- **Options:** Put per-KPI records in a child table now so a future target / measure / achieved column set is an additive migration. The reference KPI text already carries thresholds. Say in the mock review that measurability is content guidance this year so Gautham hears it explicitly.

### Cluster C — Framework shape and display

*Decision D3 lives here.*

#### R04 — Display the framework per role and per level
*decided · change · risk low · effort M*

- **Meeting:** Shreshta 00:03:13–00:03:58: a framework per role and, within each role, per level; the UI shows the one that applies.
- **Today:** The resolution exists and is reusable: user → `function_id` + `designation.career_level` → `role_expectations` row (`backend/app/api/routes/user_routes.py:109-164`); rendered by `RoleExpectationsModal` on Annual Goals, `ExpectationPanel` on the PM form, `ExpectationToggle` on the employee's read view. The content is the six axes.
- **Options:** Keep the resolution path, add the per-employee override (R15), serve the new framework payload.

#### R06 — New framework shape with weighted KPIs
*decided · new · risk medium · effort M · ▲ your call*

- **Meeting:** Gautham's screen share 00:05:17: outcomes, goals, KPIs, each KPI with a weightage summing to 100%. Actual values come from the PDFs (Part 2), not the spoken example.
- **Today:** D3. The six-axis keys are referenced in 15 files; no admin write route exists for functions, designations or expectations (only `GET /admin/functions`, `GET /admin/designations`, `admin_routes.py:1858, 1883`); no year or version column. The May stakeholder question bank asserts "HR_Miltenyi can add new entries via the admin panel" (§C.2) — the code contradicts it.
- **Changes:** `framework_levels` (org, function, level 1..4, title, business_outcomes, functional_goals, period) and `framework_kpis` (level, seq, text, weightage_pct); an idempotent importer keyed (function, level, period, seq) with a sum-to-100 assertion — explicitly not the count()==0 guard of the seed; the resolver picks the row matching the goal set's period, never "latest"; a published row is immutable and edits create a new period row. CY 2026 reviews will be entered in Jan 2027 while CY 2027 is imported, so two periods are live at once.
- **Options:** (a) New tables beside `role_expectations` — recommended, the six axes still feed the PM form and the mentor goal-review rail until R10 is settled. (b) Replace `role_expectations` — forces the project-review question now. (c) JSON column — no reference data uses JSON today; weak validation.
- **Open:** **Who edits the framework next year**: engineering import or an HR_MyOrg screen? (§C.3 of the May question bank already proposed HR_MyOrg via settings.) Whether function leaders will "contextualize" per team (Part 2).

#### R07 — Outcomes and Functional goals shown above the KPI boxes
*decided · new ui · risk low · effort S*

- **Meeting:** Shreshta raised it 00:16:53; Gautham made it conditional ("if we have an option… if not, we can send across this particular file") 00:16:53–00:17:56; Saivignesh closed it: "Let's have it in that. We will show it." 00:17:56. Agreed order: strategic outcomes → functional/operational excellence goals → KPI boxes.
- **Today:** Reference text is a collapsible accordion per axis (`ExpectationPanel.tsx:12-54`); nothing renders a header block.
- **Options:** A header card with the level title, both paragraphs (collapsible after first read), then KPI cards in document order.

#### R16 — Levels per role
*decided in principle · change · risk low · effort S*

- **Meeting:** Shreshta "like four levels"; Gautham "Correct. Correct." then "three three"; Shreshta "Whatever that count was three or four" 00:21:33.
- **Today:** `career_level` 1..4 labelled Entry/Mid/Senior/Lead (`backend/seed_data/gcc.py:30-35`).
- **Gap:** All seven documents have four levels with function-specific titles. Show the framework row title ("Senior BioStatistician"), not the generic band label, to employees.
- **Open:** Two L4 title spellings and the extra "Data Analyst" (Part 2) — confirm which list is canonical.

#### R17 — The "seven categories" remark
*ambiguous · none*

- **Meeting:** Saivignesh 00:03:58 described the current framework as having "seven items, seven categories".
- **Today:** Six GCC axes (`gccFramework.ts:46-83`). Before migration f7c4a9e2b5d1 there were eight (seven Healthark competencies plus Firm Growth added by f4a5b8c1d2e9). He was likely recalling the Healthark instance's original seven. Stale "seven"/"eight" strings remain (`ProjectReviewDetailModal.tsx:133`; `docs/QA-Test-Cases-04-ProjectReviews.md:38`).
- **Options:** Clarify in the mock that the form is KPI-driven (4–7 boxes), not a fixed axis count.

#### R27 — Number of KPI boxes varies
*decided · change · risk low · effort M*

- **Meeting:** Gautham counted "1 2 3 four and five text boxes" 00:16:53; the documents range 4–7.
- **Today:** The PM form and payload hard-require exactly six comments (`PMEvaluationSubmit`, `project_review_schemas.py:39-51`; `EvalModal.tsx:114-117, 235-269`); exports have six fixed columns (`backend/app/services/exporters.py:502-507, 574-579`).
- **Changes:** Data-driven rendering over the employee's KPI list. Export in long format: one row per (employee, period, KPI, cycle) with KPI text and weight snapshot, goal text, self text, set-level self rating, primary comment, Healthark comment, final rating, primary reviewer name, entered by/at; plus a "Goal Sets" summary sheet; add to `/all.xlsx` and `/employee/{id}.xlsx`; decide whether `/miltenyi.xlsx` (HR_Miltenyi) carries it at all.

### Cluster D — Per-KPI boxes and the evaluation flow

*Decision D5 lives here.*

#### R05 — One text box per KPI, KPI text above, boxes start empty
*decided · new · risk medium · effort M · ▲ your call*

- **Meeting:** Shreshta first proposed it: "for each line item in the framework we should give them… a text box where they can as per that framework tweak and add their goal" 00:03:58. Saivignesh offered the alternative of a one-time framework popup plus n free-form goals; Gautham chose "Four separate boxes. Yes." 00:10:20, with the KPI text above each box for reference 00:16:53 and "configurable empty text boxes" pre-populated with the success metrics (Saivignesh, Gautham "exactly") 00:18:40.
- **Today:** No per-KPI input anywhere. The closest UI shape is the PM form: one textarea per axis with the reference accordion above (`EvalModal.tsx:235-269`) — right shape, wrong author. The goal side is a single title and description.
- **Changes:** `project_goal_items` (set, kpi, kpi text and weight snapshot, goal_text); an employee form iterating the KPI list; autosave (the pattern exists only in the annual-review `EvalForm.tsx:9-17`, not in the goal or PM modals); an `updated_at` precondition on saves because every PATCH today is last-write-wins.
- **Options:** Mock: KPI card = KPI text (+ weight chip toggleable per R08) + textarea + counter; Save draft / Submit. **All KPI boxes required to submit** (R28), drafts may have blanks, one optional "Additional goals" box for Shreshta or Gautham to strike (R29).

#### R13 — Evaluation: per-KPI self-review + rating, per-KPI reviewer comments + final rating
*decided · new · risk medium · effort L · ▲ your call*

- **Meeting:** Saivignesh's summary 00:20:23: self-review in a box in front of each KPI, then a rating "project wise"; then the reviewer gives "qualitative review in the boxes that are there and the… final rating, that ends the flow"; Gautham "Yes, correct. That's right." Gautham 00:19:35: back-and-forth exists "only… after the self evaluation" — read against his own next sentence and the flow summary he confirmed, this is the self-review → reviewer-comments pair, not an in-system thread; any exchange with the Miltenyi side is offline by construction. Gautham 00:20:23: "we take in their inputs, update it, and then the secondary reviewer who will be from Healthark will update their comments."
- **Today:** Goal self-review: one paragraph per half, no rating, draft/submit one-shot, unique per (goal, half) (`goal_self_review_models.py:51-96`); mentor review the same shape. Project review: six PM comments, one `performance_group` 1–5, impact statement, no employee input; secondary: impact only (`project_review_models.py:114-147`). Rating scale: 1 = beyond expectations, 5 = did not achieve (`EvalModal.tsx:196-214`; `frontend/src/components/reviews/PerformanceRatingSelect.tsx:7-13`). Precedent for a Healthark actor writing a rating with a per-row publish gate: the annual-review management rating (`backend/app/models/annual_review_models.py:88-90`; `backend/app/api/routes/annual_review_routes.py:1788-1789`). Every existing reviewer step is event-gated on the employee's submission (`goal_routes.py:1499-1508`).
- **Changes:** Per cycle per set: self text per KPI + one self rating; per KPI a transcribed Miltenyi comment and a Healthark comment; one final rating; draft/submit both sides; reviewer sees the self-review while writing (three-column pattern in `GoalMentorReviewModal.tsx:205-345`); employee sees comments and rating behind a visibility gate (pattern `project_ratings_visible`, but keyed on the set's period, not the FY). A "reviewer may proceed after date X / HR override" so one absent employee cannot block the Miltenyi input from being recorded.
- **Open:** **Which of the two ratings is "final" — the Miltenyi manager's transcribed one or Healthark's own?** Does Healthark's comment go to the employee? Does the reviewer (and the packet sent to Miltenyi) see the employee's self-rating before the final rating is given? Does the employee acknowledge with a click at the end?

#### R25 — Reuse the yearly-goals flow mechanics
*tentative · pattern reuse*

- **Meeting:** Saivignesh 00:18:40 "we have that flow done for yearly. So we will bring it here" — said in response to Gautham's "we'll have to log in comments"; Gautham then removed the approval loop himself 00:19:35 after Shreshta clarified what Saivignesh meant.
- **Today:** Reusable as patterns: draft/submit one-shot with a unique index, `is_review_window_open` (`cycle_utils.py:220-263`), per-FY toggles, `notify()`, badges and selects, `Goal.manager_id` as a reviewer-of-record snapshot taken at creation (`goal_models.py:73`). Not reusable as-is: mentor-only approver, live-mentor requirement, H1/H2 lock, single paragraph, no rating, funnel dashboards keyed on approval states.
- **Options:** Copy the patterns into the new module; do not attach project goals to the `goals` table.

#### R26 — Use the existing rating format
*tentative · reuse · ▲ your call*

- **Meeting:** Saivignesh 00:20:23: "I will take whatever rating format you are using"; unopposed.
- **Today:** 1–5 with 1 = best on both project reviews and annual reviews; `PerformanceRatingBadge` handles string or number.
- **Open:** **1-is-best is the opposite of how the framework thinks about weightage earned** ("if they meet the criteria then the weightage can be 30%", Gautham 00:07:27). Confirm orientation with Gautham and Shreshta before the mock shows it; keep one scale across annual and project surfaces.

#### R28 · R29 — Every KPI must have a goal — and may employees add goals beyond the framework?
*R28 decided · R29 ambiguous · decide · ▲ your call*

- **Meeting:** Saivignesh "goal has to cover all the items within the expectation framework", Shreshta "Correct" 00:03:58; Saivignesh "Each KPI should have a goal corresponding in front of them", Gautham "Correct" — and in the same breath "This is a reference framework of course" 00:08:19. Coverage of every KPI is settled in principle; whether employees may add goals beyond the listed KPIs was never raised.
- **Today:** The PM form blocks submit until all six boxes are filled (`EvalModal.tsx:114-117`). The documents call the themes "not exhaustive".
- **Options:** Mock: all KPI boxes required to submit, blanks allowed in drafts, one optional "Additional goals" box. **Ask whether the extra box survives.**

### Cluster E — Weightages

#### R08 — Weightages are never employee input; display to employees TBD
*decided · display deferred · new (read-only) · risk low · effort S · ▲ your call*

- **Meeting:** Gautham proposed a per-person split (15/15 vs 20/10) submitted by the employee and approved by the manager 00:08:19–00:11:07. Shreshta overruled: "how can we let the employee decide the weightage"; weights are consistent and "for now has come from [Miltenyi]… we're going to go with this weightage overall"; "definitely we should not be asking it from them in the PMS" 00:11:07–00:12:03. Gautham: "Okay. Okay. Understood. Yep." 00:12:57. Whether to show weights to employees: "you and I can discuss offline" (Shreshta to Gautham) 00:12:03.
- **Today:** No weightage anywhere (verified by grep). Visibility gating exists as a pattern: per-FY `project_ratings_visible` and `annual_review_final_rating_visible` (`backend/app/models/system_settings_year_override_models.py:52-61`; redaction in `project_review_routes.py:169-220`).
- **Changes:** `weightage_pct` on the KPI row; a "weightages visible" toggle keyed on the set's period so the decision can flip without a deploy. No input control ever. No weighted score in v1 (not requested).
- **Open:** **The display decision itself** (Shreshta + Gautham). Whether a computed weighted score is ever wanted.

#### R21 — Weightages and mappings are Healthark-maintained configuration
*decided · change · risk low · effort M*

- **Meeting:** Saivignesh 00:09:21–00:10:20: "we will configure in the back, we will take care of the mappings… maintain it in the configuration". Shreshta "the weightages will come from us" 00:10:20 — "us" meaning not the employees; the values themselves come from Miltenyi 00:12:03.
- **Today:** Reference data is seed-only; reseeding is a no-op while rows exist (`backend/seed.py:125, 479`). The per-assignment overrides `assignment_role` and `function_id` (`project_models.py:114-118`) are the only "mapping differs from the HR record" mechanism, and not a level.
- **Options:** An importer for the CY 2026 framework (the structured extraction already exists), a read-only HR_MyOrg viewer, full editing later.

#### R22 — Trial-specific weightage variation stays at stakeholder level
*decided principle · none*

- **Meeting:** Shreshta 00:12:03, "Sandra" example: a trial lead might want timeliness over accuracy, "but that… we will have to do at a stakeholder level".
- **Options:** Keep weightage on the framework KPI row; a per-project override table is possible later because projects exist. Do not build.

#### R23 — Offline employee–manager discussion covers goals, not weightage
*decided · none*

- **Meeting:** Shreshta 00:11:07–00:12:03: "they will discuss the goals. They're not going to discuss the weightage."
- **Options:** Entry is a one-time transcription after an offline agreement; Save draft + Submit is enough. No negotiation UI.

### Cluster F — Reviewers, approval, proxy entry

*Decisions D2 and D4 live here.*

#### R11 — Miltenyi primary reviewer offline; Healthark secondary enters
*decided · conflict · risk high · effort L · ▲ your call*

- **Meeting:** Gautham 00:15:08: "we can't have someone from Miltenyi do that… collect inputs from the primary reviewer and then have them updated on the system from our side"; 00:20:23: "the primary reviewer will be someone from Miltenyi… the secondary reviewer who will be from Healthark will update their comments… someone from Miltenyi cannot have the access to the system". Shreshta 00:15:59: socialising the tool with ~15 Miltenyi stakeholders is too much effort "for now"; "maybe I will be primary reviewer and Purva might be secondary reviewer or something like that".
- **Today:** D2. Plus: the pivot plan and seed model the PM as a Miltenyi login who works a queue (`docs/Pivot-Plan.md:7, 33`; seeded `stefan@miltenyi.com` etc.); the only on-behalf path is goal creation with `?user_id=`, open to Mentor and HR_MyOrg, recording nothing about the actor (`goal_routes.py:252-269`); "Evaluated by …" shows `reviewer_name` to the employee (`ReviewDetailPanel.tsx:149-153`), which would name the typist; notification copy says "Your PM submitted…" (`project_review_routes.py:938`). The Healthark domain is hard-coded to `healthark.ai` (`admin_routes.py:760`; `frontend/src/utils/text.ts:20`); Zaahid confirmed Healthark accounts use that domain, so no rule change is needed. Post-submission edits have no history anywhere (`PUT /{review_id}` overwrites forever, `project_review_routes.py:1853-1917`).
- **Changes:** (1) Reviewer of record per employee: `users.project_reviewer_id` (nullable, Healthark user) plus the Miltenyi reporting manager's name stored on the user so HR knows whom to chase and the review pre-fills it. (2) Permission for that Healthark user to write. (3) Provenance on the review: `primary_reviewer_name`, per-KPI `primary_comment` and `secondary_comment`, `entered_by_id`, `entered_at`, `source_received_at`, optional `source_attachment_url` (the `goals.attachment_url` convention), and an append-only change log of submit/edit/unlock with before/after text (pattern `backend/app/models/mentor_reassignment_log_models.py:33-123`). (4) Employee-facing attribution names the Miltenyi reviewer. (5) Deactivation cascade for the new FKs like `pm_id`/`mentor_id` get (`admin_routes.py:1824-1847`). (6) The domain rule for whoever holds the slot.
- **Options:** (a) New role "Reviewer" — cleanest, but role checks are scattered across ~12 route files (`docs/risks/risk-register.md:123`). (b) Give Purva/Shreshta HR_MyOrg — least code, but it is a privilege escalation to full super-admin (users, settings, exports, all annual reviews). (c) Reuse Mentor — rejected: mentors are the Healthark annual-goal reviewers, only three exist. (d) Least privilege: an ordinary account plus a relational check on `users.project_reviewer_id`, exactly how `Project.pm_id` gates the PM today, no new role. (e) Create Miltenyi PMs as non-login users for attribution — keeps `pm_id` meaningful but the queue and dashboards assume they log in. Recommendation: (d), with the external name field; the FK keeps R24 open.
- **Decided:** **7 Sep (Zaahid, after the wireframe review):** the Healthark reviewer of record is the employee's existing **Mentor**. No new reviewer field or role: the mentor enters the Miltenyi reviewer's inputs and gives the final rating, and the mapping table shows "Reviewer (Mentor)". This narrows option (d) above to "grant Mentors write access on project-goal reviews for their own mentees", the same relational check the mentor goal-review already uses (`goal_routes.py:1492`). Settled on 4 Sep: the domain is healthark.ai, and the seeded Miltenyi PM and HR_Miltenyi logins are placeholders.
- **Open:** Shreshta and Amit are also employees with goal sets — who mentors and therefore reviews them, and a "cannot review yourself" rule. Mentors were until now barred from project reviews by design (`docs/Pivot-Plan.md:32`); that decision needs a revision note.

#### R12 — No goal-setting back-and-forth; status flip logged
*decided · approve-click tentative · change · risk low · effort S · ▲ your call*

- **Meeting:** D4. Gautham removed the loop 00:19:35; Saivignesh's approve-click and status logging 00:19:35 is weakly affirmed by Gautham's "Yes, correct" to the whole summary 00:20:23.
- **Today:** D4. Project reviews have no approval concept. No surface in the app has an unlock (the annual "Completed" unlock is undecided in QA-03).
- **Options:** States draft → submitted → approved (locked). "Mark approved (agreed offline)" clicked by the reviewer of record or HR stamps `approved_at`, `approved_by_id`, optional `approved_offline_by`; no feedback field. Unlock rules to write down, not hand-wave: HR_MyOrg only, reason required, logged, employee notified, reviewer drafts preserved.
- **Open:** **Is the approve-click wanted at all, or is "submitted" enough? May the employee edit after lock without HR?**

#### R19 — Comment logging at the goal stage
*ambiguous · decide*

- **Meeting:** Gautham 00:18:40 "we'll have to log in comments for those goals", then 00:19:35 "no back and forth… approved externally offline".
- **Options:** No comment field at goal stage in v1; at most an HR-only internal note. Confirm during the mock review.

#### R24 — Possible future Miltenyi reviewer access
*deferred · none now*

- **Meeting:** Shreshta 00:15:08, 00:15:59: "even if we open up the system to them we will get feedback from one person"; not now because 15 stakeholders' sign-off is too much effort.
- **Options:** Keep the reviewer as a user FK plus an external name so a Miltenyi login can be assigned later; the domain rule already admits `@miltenyi.com` for PM and HR_Miltenyi.

### Cluster G — Cadence

*Decision D6 lives here.*

#### R14 — Cadence and period label
*tentative · decide · risk medium · effort M · ▲ your call*

- **Meeting:** Saivignesh 00:19:35 "suppose like… quarterly, you are maybe doing the evaluation after the quarter ends" — a hypothetical, unchallenged, unconfirmed. Shreshta: the goal set is annual ("this one round… the first year") 00:03:13. The documents are CY 2026.
- **Today:** D6. Q1–Q4 plumbing exists in enums and utilities (`goal_models.py:30-38`; `cycle_utils.py:130-157, 220-263`) but new Q submissions are rejected for goals. `fiscal_start_month=1` is mathematically supported yet every label still renders "FY26-27" (`cycle_utils.py:414-421`), and `get_goal_cycle_name` is called without the org's fiscal start (`goal_routes.py:310`), so a January-start org would mis-stamp Jan–Mar goals. Per-FY gates are keyed by `fy_label` ("FY26-27", `system_settings_year_override_models.py:47`), so a "CY 2026" set has no row to hang flags on. The review-window matrix plans "current + previous quarter open" for project reviews but it is not built (`docs/policies/review-window-policy.md:27-33`). `cycle_window_override` (seeded true) and `simulated_today` (needs `ALLOW_DATE_SIMULATION`) exist for walking a demo across periods. Timezone defaults to UTC and neither seed sets it, so any period-end gate flips at UTC midnight.
- **Options:** Concrete proposal: a free-text `period_label` on the set ("CY 2026") rather than touching `fiscal_start_month`; evaluation cycles derived from org `cycle_type`, but year one has exactly one evaluation; self-review window for cycle C opens at C.end+1 (a new variant of `is_review_window_open`), reviewer window opens on self-review submit or C.end+N days, closes only by HR flag; honour `cycle_window_override` for demos; new visibility and edit flags keyed on the set's period.
- **Open:** **Is CY 2026 a single-evaluation pilot and CY 2027 the first quarterly year?** Calendar year or April fiscal year for the label?

### Cluster H — Mapping and coverage

#### R15 — Employee-level mapping to a framework level
*decided · new · risk medium · effort M · ▲ your call*

- **Meeting:** Gautham: "based on their designations" 00:21:33. Shreshta 00:22:38: "the mapping will have to happen at an employee level… you can't just say for all the senior consultants we'll do this"; 00:23:28 the mechanism: "for each of the teams, the designations are different… here we will map each of those designations to one of these roles". ~30–40 employees (Saivignesh, Shreshta "exactly"). Gautham produces the list, Purva or Sudeep review it, then Sai's team; Saivignesh 00:24:37: "I will do the mapping here."
- **Today:** Level is derived from `designations.career_level`; designations are org-unique by name and carry no function link (`reference_models.py:19-41`); no per-user override; both HR roles can change a user's function and designation in `UserModal` (`admin_routes.py:1471-1493`); `/role-expectations` buckets titles by level only, function-agnostic (`project_review_routes.py:773-777`). `function_id`/`designation_id` are nullable, so an employee without them resolves to "Role expectation not defined" (`user_routes.py:106, 128-142`). The real Miltenyi team title has no home: `designation_id` points at the 35 GCC titles.
- **Options:** (a) Nullable `users.framework_level`, function from the user. (b) Full FK `users.framework_level_id` to the framework row (function + level) — handles an employee mapped to another function's framework; recommended, with designation-derived fallback. (c) Per-team designation rows — fights the unique-name constraint and changes displayed titles. Plus: a free-text "Miltenyi title" field, a one-off import of Gautham's list, "Framework level" in the Users table and export, an "unmapped / no framework" bucket with a preflight count, and a snapshot onto each goal set so promotions do not rewrite history. Exclude the new field from HR_Miltenyi's editable set.
- **Open:** **Mid-year promotion or function change**: with one set per employee per period, does HR re-base (unlock, re-snapshot the new level's KPIs, keep old text) or does the employee finish the year on the old framework? Indian promotions typically land in April, mid-CY. Delivery date of Gautham's list given his absence the week of 7 Sep.

#### R20 — Function coverage
*ambiguous · content · ▲ your call*

- **Meeting:** Gautham names the PV team as multi-trial 00:14:08.
- **Fact:** Eight seeded functions, seven documents; Pharmacovigilance has none (Part 2). Employees whose function has no framework would have nothing to write against.
- **Options:** Ask Gautham for a PV document or confirm PV is out of scope for cycle one; have Purva/Sudeep mark unmapped employees so the seed carries an explicit "excluded from CY 2026" flag; confirm the eight seeded functions are Miltenyi's actual list; freeze v1 of the seven documents (truncated KPIs and tracked changes in Part 2) before seeding.

### Cluster I — Process and context

#### R18 — UI mock first, no backend
*decided · process · ▲ your call*

- **Meeting:** Shreshta asked for a plan or UI discussion before implementation 00:24:37; Saivignesh: "let's do some intro kind of a build visually how it is looking. Let's not do the back end" 00:25:36. Zaahid is the named point of contact: Gautham available the week of 2 Sep, out of office the following week, then Shreshta or Amit 00:25:36. Shreshta adds Gautham to the PMS group.
- **Options:** "Mock" here means the visual prototype Saivignesh asked for: the new screens drawn with sample data and no backend, so Shreshta and Gautham can react to how it looks and the flow questions get settled against it. See Part 9. Decide whether it lives inside the existing React app as real pages with hard-coded data (reusable once the backend exists) or as a standalone clickable page (faster to share, thrown away afterwards).

#### R30 · R31 — Open flow questions deferred to the mock review; coordination via the PMS group
*deferred · action · none*

- **Meeting:** Saivignesh 00:25:36: flow questions "might come during the implementation"; Shreshta "that is okay". Part 8 lists them so they are not rediscovered.

#### R32 — "Implementation is simple" (Aakash)
*context · expectation · ▲ your call*

- **Meeting:** Aakash 00:24:37: "I feel the implementation is simple"; Saivignesh "Simple."
- **Fact:** At the UI level, yes. Underneath, D1, D2 and D3 are structural, and two pieces exist in no form today: the per-employee reviewer packet the offline round-trip needs (nothing prints or exports a single employee's goal set; `/export/employee/{id}.xlsx` has no goal-set sheet, `export_routes.py:403-495`) and the surfacing of the goal-set review to the mentor's annual-review drawer and HR calibration (`EvalDrawer.tsx:1-5` exists to show project ratings beside the annual evaluation; `ManagementReview.tsx` has no project data). **Say so before estimates are given.**

#### R33 — Healthark runs multiple instances
*context · note*

- **Fact:** The pivot plan states this codebase is the Miltenyi-hosted instance with separate Healthark hosting (`docs/Pivot-Plan.md:11-16`), and Zaahid confirmed it is a Miltenyi-only UAT build with no live instance. The per-organisation feature list (`organizations.enabled_features`) is wired into session claims and the frontend (`backend/app/api/routes/auth_routes.py:59`; `frontend/src/contexts/AuthProvider.tsx:156`) but no backend route checks it. Decision 4 Sep: single organisation only, structure kept, every Miltenyi feature listed under the flag, and a server-side check added. Small v1 item.

## 4. Tensions inside the meeting itself

1. **Per-person weightage (Gautham) vs fixed weights (Shreshta).** Resolved for Shreshta 00:12:03. Gautham's separate measurability point 00:07:27 was never answered by anyone. His document still carries numeric thresholds and he will read them as targets. The mock must show no weight input.
2. **"Project goals" as a name vs one set across all trials.** The artefact is a per-employee annual goal set evaluated from the project side. Calling it "Project Goals" in the UI invites "which project?".
3. **No back-and-forth vs "PM clicks approve, status logged" vs "log comments for those goals".** Three positions within 00:18:40–00:19:35. Only "no comment loop" was explicit.
4. **Primary reviewer is Miltenyi vs Miltenyi has no access vs "I will be primary reviewer" (Shreshta, who is Healthark).** Either Shreshta acts as the Miltenyi side's delegate, or "primary" means the person collecting Miltenyi input. The system needs one named reviewer of record and one named source, and two comment columns per KPI.
5. **Quarterly evaluation vs CY 2026 themes vs April fiscal year.** Nobody reconciled these, and the calendar makes year one a single evaluation anyway.
6. **Designation-based (Gautham) vs employee-level (Shreshta) mapping.** Reconciled by Shreshta herself 00:23:28: team-specific designations map to framework roles, which is per-employee in effect for 30–40 people. Gautham's list will still be expressed as designations; someone converts.
7. **Three levels (Gautham, after first agreeing to four) vs four in every document.**
8. **"Seven categories" vs six axes vs 4–7 KPIs.**
9. **"Reference framework" vs "each KPI must have a goal".**
10. **"Reuse the yearly flow" vs removing the approval loop that defines it.**
11. **"Implementation is simple" vs the structural conflicts above and the two missing pieces (packet, calibration surfacing).**

**Pushed offline, with owners:** weightage display (Shreshta + Gautham); the employee → level list (Gautham, reviewed by Purva or Sudeep, to Sai's team, entered by Saivignesh); adding Gautham to the PMS group (Shreshta).

## 5. Architecture options

|  | A · Extend Project Reviews | B · Extend Annual Goals | C · New Project Goals module |
|---|---|---|---|
| **Thesis** | Add a goal-setting stage and self-review to `ProjectReview`; replace six axis columns with per-KPI records | `goal_type = project` goals with per-KPI children; reuse self/mentor review and gates; swap Mentor for a reviewer FK | New tables for framework, mapping, goal sets, items, per-cycle reviews; own routes and page; reuse UI components and patterns |
| **D1 per employee** | No — unit is per project; every queue, counter and export keyed on project | Yes — goals are per user | Yes |
| **D2 Healthark reviewer, provenance** | Partly — PM-only writer, Miltenyi-only secondary pool; role and domain surgery | Partly — approver is Mentor-only; creation needs a live mentor | Yes — reviewer FK, external name and change log designed in |
| **D3 KPI framework** | Rip the six-column coupling across 15 files and 4 export endpoints | Neutral | Yes (additive) |
| **D4 no comment loop** | Yes (no approval today) | No — pending/changes_requested loop and funnels are the module's spine | Yes |
| **D5 per KPI, ratings** | Reviewer side close; employee side entirely new | Both sides single paragraph, no rating | Yes |
| **D6 cadence** | Follows `cycle_type` | Hard-locked H1/H2 | Choose; period label on the set |
| **Reuse** | Queue, draft/submit, rating redaction, notifications, exports | Draft/submit one-shot, window gate, per-FY toggles, badges | Same components and patterns, copied not shared |
| **Breaks or retires** | The project-review data model and all its consumers | Goal funnels, stalled goals, mentor pending counts, 4 of 7 goal notifications; two goal kinds on one page | Must hide the PM queue for this instance to avoid double evaluation |
| **Migration risk** | High — destructive column swap (precedent f7c4a9e2b5d1) | Medium — state-machine changes leak into dashboards | Low. Additive DDL, and Zaahid confirmed no instance is live: the build was handed over for UAT only and these requirements arrived afterwards, so the UAT database can be wiped and reseeded. The earlier uncommitted f7c4a9e2b5d1 index fix is a local SQLite convenience, not a deployment blocker |
| **Effort** | L–XL | L | L–XL (most new code, least entanglement) |

> **Recommendation: C**, with four companions. (1) Hide the PM project-review queue for the Miltenyi org once the module ships and keep historical rows readable. (2) Leave `role_expectations` untouched until then. (3) Reuse `EvalModal`'s per-item form shape, `ExpectationPanel`, `PerformanceRatingSelect`/`Badge`, the draft/submit/one-shot pattern with a unique index, `is_review_window_open`, per-period toggles, `notify()`, and the annual-review management-rating publish gate as the model for the final rating. (4) Add the two missing pieces to scope: a per-employee reviewer packet export and the goal-set review on the mentee Summary tab and calibration grid.

### Data sketch for the mock discussion

```
framework_levels        org · function_id · level 1..4 · title · business_outcomes · functional_goals · period_label
                        unique (org, function, level, period)   — immutable once published; new period = new rows
framework_kpis          level_id · seq · text · weightage_pct   — sum-to-100 asserted at import
users                   + framework_level_id (nullable override, fallback = designation.career_level)
                        + miltenyi_title (free text) · + project_reviewer_id (Healthark user) · + miltenyi_reviewer_name
project_goal_sets       org · user_id · period_label · framework_level_id (snapshot) · status draft|submitted|approved
                        approved_at · approved_by_id · approved_offline_by   unique (org, user, period)
project_goal_items      set_id · kpi_id · kpi_text (snapshot) · weightage (snapshot) · goal_text
project_goal_reviews    set_id · cycle · self_rating · self_submitted_at · reviewer_id · entered_by_id · entered_at
                        primary_reviewer_name · source_received_at · source_attachment_url · final_rating
                        reviewer_submitted_at · draft flags      unique (set, cycle)
project_goal_review_items  review_id · item_id · self_text · primary_comment · secondary_comment
project_goal_change_log    entity · entity_id · actor_id · action submit|edit|unlock · before · after · at · reason
```

## 6. What nobody said that the build needs

Items no participant raised, surfaced by reading the code and the flow end to end. Severity is for the build, not for the meeting.

- **The offline round-trip needs an artefact** (high) — The Miltenyi reviewer never logs in, so Healthark must hand them the employee's goal set and self-review and receive comments back, outside the system. Nothing prints or exports a single employee's goal set. Without a per-employee "reviewer packet" (PDF or sheet, or share by email) the flow stalls at the review step. Decide whether the packet includes the self-rating.
- **Two Healthark authors on one review** (high) — Gautham 00:20:23: transcribe the Miltenyi inputs, then the Healthark secondary adds their own comments. Per KPI that is two comment columns and a decision on whose rating is "final". If Shreshta and Purva both log in, two writers on one record: draft visibility, ordering, who submits.
- **Edits have no history; on-behalf entry makes that a liability** (high) — Reviews can be overwritten forever with only a bell notification (`project_review_routes.py:1853-1917`); goal feedback keeps only the latest text. When a Healthark typist alters a Miltenyi manager's words after the employee has read them, "entered by/at" is not enough. Append-only change log (pattern `mentor_reassignment_log_models.py`).
- **Mentor and HR calibration lose the project signal** (high) — `EvalDrawer` exists so the mentor reads project ratings beside the annual evaluation; the mentee Summary tab shows a rating card per project; `ManagementReview.tsx` has no project data. If the PM queue is retired, the Miltenyi rating reaches neither the mentor nor calibration unless the goal-set review is surfaced there.
- **Framework content is a moving draft** (high) — Tracked-change bars, two truncated KPIs, one unbulleted KPI, and a footer expecting function leaders to "contextualize". Get Gautham to freeze v1 before seeding; design `framework_levels` so a team variant can be added without a migration.
- **Calendar reality** (high) — Goals enter in October at the earliest; CY 2026 gets one evaluation, in January 2027, exactly when a CY 2027 framework would be imported. Year one is a pilot with one cycle; the states strip in the mock should say so.
- **Feature flag is frontend-only** (v1 item) — Each organisation row carries a list of enabled features (`enabled_features`) that the browser uses to hide menu items and routes; no server endpoint checks it, so anything hidden can still be called by URL. Zaahid confirmed: single organisation, structure kept, all Miltenyi features listed under the flag, and a server-side check to be added. Small, but it touches every new endpoint.
- **Least privilege for the Healthark reviewer** (medium) — Granting HR_MyOrg to enter reviews gives full super-admin. A relational check on `users.project_reviewer_id` (how `pm_id` works today) needs no new role and no escalation.
- **Healthark domain hard-coded to healthark.ai** (resolved) — `_HEALTHARK_DOMAIN` (`admin_routes.py:760`) is the only domain for HR_MyOrg and Mentor. Zaahid confirmed Shreshta, Purva and Sudeep use healthark.ai, so reviewer accounts can be created without touching the constant.
- **Reviewer deadlock** (medium) — Every reviewer step today is event-gated on the employee's submission. Copying that means one absent employee blocks the Miltenyi input from ever being recorded. Need a date or HR override and a visible "self-review missing" marker.
- **Shreshta and Amit are employees in this population** (medium) — Gautham 00:14:08. If Shreshta is reviewer of record and also holds a goal set: who reviews her, a "cannot review yourself" rule (today's `project_review_routes.py:853-857` has a counterpart), and one account cannot be both a Miltenyi-domain Employee and a Healthark-domain reviewer.
- **Miltenyi-side logins under "Miltenyi cannot access"** (resolved) — Both seeds create live HR_Miltenyi and PM logins. Zaahid confirmed they are placeholders: drop them from the seed or deactivate them, and keep the new mapping field out of HR_Miltenyi's editable set in case the role is ever used.
- **Per-period gates** (medium) — Override rows are keyed "FY26-27"; a "CY 2026" set has no row for its visibility and edit flags. Key the new flags by the set's own period label.
- **No scheduler** (medium) — No APScheduler, Celery or cron; every notification is user-triggered and email is off without SMTP credentials. "After the quarter ends" reminders and "Miltenyi input overdue" chasers cannot be automatic. An HR pending-actions list (existing `PendingActionsCard` pattern) and a named owner for the manual chase.
- **Unlock, corrections, concurrency** (medium) — No surface has an unlock; no PATCH has an `updated_at` precondition. Write the unlock rules (HR_MyOrg only, reason, logged, notified, reviewer drafts preserved) and return 409 on stale saves.
- **Employees who cannot enter a set** (medium) — PV, employees with no function, new hires after the entry gate closes (same defect as `annual_goals_edit_enabled` today, no per-employee exception), employees on zero projects (nav is project-independent but `/mine` is assignment-driven). The mapping screen needs an "unmapped" bucket and a preflight count.
- **New FK cascades** (medium) — `project_reviewer_id` and `framework_level_id` need the deactivation and role-change handling that `pm_id`, `mentor_id` and `secondary_evaluator_id` already get, or a departed reviewer leaves 30 employees dangling with no "orphaned" bucket.
- **Security rules not to copy** (medium) — `GET /project-reviews/{id}` grants read to anyone assigned to the same project (`project_review_routes.py:1966-1970`). A goal set contains self-assessments: owner, reviewer of record, HR, and mentor read-only. Only two backend tests exist; a permission-matrix test for the new module is cheap insurance.
- **Notification events to enumerate** (low) — Set submitted → reviewer + HR; approved/locked and unlocked → employee; self-review submitted → reviewer + HR; review entered (copy names the Miltenyi reviewer) → employee; review edited → employee; mapping changed → employee/HR. `notify()` self-suppresses when sender equals recipient; existing `?goal_id=` deep links are not consumed by the page — give the new module working deep links from day one.
- **Miltenyi names and comments stored in Healthark's system** (low) — Up to 15 Miltenyi managers' names and words will be transcribed into a system they never see. Not a code item; Shreshta should confirm Miltenyi is comfortable before names are stored.

## 7. Blast radius and rot found on the way

- **If the PM queue is hidden for Miltenyi:** PM dashboard tile `ProjectReviewsStatusCard`, HR `ProjectReviewCompletionCard`, mentee Projects tab rows and placeholders, the Mentor "Team Review" tab, the mentee Summary tab's project rating cards, the backend `/management` endpoint (live, HR-only; its frontend `ManagementTab` is already unmounted), four project-review export endpoints, notification copy "Your PM submitted…", `pm_id` required at project creation, and pivot-plan decisions 5 and lines 13/21/50 needing a revision note.
- **Rot to fix regardless:** `MenteeAnnualSummaryTab.tsx:288-306` still indexes the pre-GCC comment keys so PM narrative never renders; `mentee_routes.py:172-182, 485` leak the raw rating past the visibility gate; `project-review.service.ts:18-25` has a stale rating type and omits the "draft" status; `/role-expectations` buckets titles function-agnostically; `MenteeProjectsTab.tsx:503-512` matches titles without function; `ManagementTab`'s cycle regex does not match "Q1 FY26-27"; `get_goal_cycle_name` ignores the org fiscal start.
- **Docs:** all six QA test-case files predate the Employee rename, the GCC framework, the criteria removal and the per-FY toggles, and they describe exactly the two things the meeting removes (mentor approval loop; PM-authored per-project review). Regenerate before writing cases for the new module. The May stakeholder question bank (§C.2/C.3/F.3/F.4) already asked Miltenyi HR for canonical functions, designations and expectations content; this meeting partly answers it and partly supersedes it.
- **Seed:** the stakeholder demo seed places employees in Pharmacovigilance, which has no framework document, and sets no timezone.

## 8. Open questions by owner

Items the transcript already answers were removed: the "back and forth after self-evaluation" is the self-review → reviewer-comments pair, not a thread; every KPI gets a goal box; the KPI heading is fixed and the employee's text carries the measurable definition; the goal set is annual.

### Zaahid — Answered, or only you can answer

1. **Answered 4 Sep:** no instance is live; the build was handed over for UAT and these requirements came afterwards. Retiring the PM queue touches no real data; the UAT database can be wiped and reseeded.
2. **Answered 4 Sep:** Shreshta, Purva and Sudeep use healthark.ai. No change to the domain rule.
3. **Answered 4 Sep:** the seeded HR_Miltenyi and PM logins are placeholders. Drop or deactivate them.
4. **Answered 4 Sep:** a single organisation only; multi-org was a former requirement. The database structure stays, every Miltenyi feature is listed under `enabled_features`, and a server-side check will be added. So a `require_feature` guard is small v1 scope, not a question.
5. **Answered 4 Sep:** the visual prototype is a set of standalone clickable pages styled like the React app, in `wireframes_new/`, to be referenced after sign-off when building.

### Shreshta

6. Given goals enter in October and CY 2026 ends in December: is CY 2026 a single-evaluation pilot and CY 2027 the first quarterly year? Calendar year or April fiscal year for the label?
7. Weightage display to employees (with Gautham).
8. **Answered 7 Sep (Zaahid):** the reviewer of record is the employee's Mentor; the Miltenyi source is a name recorded per employee in the mapping table. Still to confirm with Shreshta whether "I will be primary reviewer" meant she acts as that Miltenyi source for some employees.
9. Is the final rating the Miltenyi manager's transcribed one or Healthark's own, and does Healthark's secondary comment go to the employee?
10. How does the goal set and self-review reach the Miltenyi manager — is an exportable per-employee packet acceptable, and does it include the self-rating?
11. Do Miltenyi employees continue mentor-driven Annual Goals and Annual Reviews in parallel?
12. Is an in-system approve/lock click wanted after offline approval, and may the employee edit after it? Does the employee acknowledge the final review with a click?
13. May employees add goals beyond the framework KPIs?
14. Who reviews you and Amit, since you both hold goal sets and you are reviewer of record?
15. Is Miltenyi comfortable with its managers' names and comments being stored in Healthark's hosted system?

### Gautham

16. Pharmacovigilance framework document, or PV out of scope for cycle one.
17. Freeze v1 of the seven documents: RA L4 KPI 4 and Clinical Trial Associate KPI 5 wording (truncated), Legal L4's fifth KPI, and the tracked changes in Finance, Biostatistics and RA.
18. Will function leaders "contextualize" the themes per team? If yes the framework needs a team dimension.
19. Confirm four levels per function, the canonical L4 titles, and whether "Data Analyst" exists.
20. The employee → framework-level list (30–40 rows) with each employee's Miltenyi reporting manager, reviewed by Purva or Sudeep — expected date given the week of 7 Sep.
21. Rating scale orientation (1 = best today) versus "weightage earned".
22. When an employee is promoted mid-year, do they finish on the old level's KPIs or re-base?
23. Confirm the Finance document has no Medical Writing content by design.

### Saivignesh

24. Module home (Part 5) and whether the PM project-review queue is retired for this instance; does `Project.pm_id` become optional?
25. Least privilege for the Healthark reviewer: new role, relational check on `project_reviewer_id`, or HR_MyOrg for Purva?
26. Is a change log for on-behalf entries in v1 scope, or is entered-by/at enough for the pilot?
27. Mapping maintenance: import script now, admin UI later? Who owns the manual chase with no scheduler?

### Purva · Sudeep

28. Review the level list against real Miltenyi titles and mark employees with no framework (PV, unmapped) so the seed can carry an explicit "excluded from CY 2026" flag.

### Amit

29. Act as the multi-trial persona for the mock's sample data (goal text spanning trials, one reviewer) and as content fallback during Gautham's week out.

## 9. What to put in the mock (the visual prototype) so the flow discussion is productive

Built on 4 Sep as clickable pages in `wireframes_new/` (open `wireframes_new/index.html`). The checklist below is what they contain.

- Real framework text from Biostatistics (the function Gautham showed) at two levels, plus Clinical Trial Management L3 and L4 so the variable KPI count (4 and 7 boxes) is visible.
- The weight chip in both states.
- A states strip that matches year one: Draft → Submitted → Approved (agreed offline) → Self-review submitted → Reviewed. One evaluation, labelled "CY 2026".
- The reviewer screen with "Miltenyi reviewer: ___", per KPI a transcribed comment and a Healthark comment, "Entered by: Purva", "Received on / source", and one final rating, so R11 and R13 are argued against something concrete.
- The employee's read view after review: per-KPI comments, final rating behind the visibility toggle, an acknowledge button to be struck or kept.
- The HR mapping table: employee, real Miltenyi title, mapped framework level, override flag, reviewer of record, an "unmapped" row for PV.
- A "Send packet" button on the reviewer screen, even if it does nothing yet, so the offline round-trip is discussed.
- A footnote: measurability is content guidance this year; weights are read-only; the seven documents must be frozen before seeding.

*Produced 4 Sep 2026 from the meeting transcript, the seven framework PDFs, the pivot plan and the code at HEAD d865440. Eight subsystem surveys with file references sit alongside this analysis; three adversarial passes (code accuracy, transcript fidelity, completeness) reviewed the draft and their corrections are applied here. Updated the same day with Zaahid's answers. No code in the repository was modified; a Markdown copy of this review lives at `docs/meetings/2026-09-02-miltenyi-goals-gap-review.md`.*
