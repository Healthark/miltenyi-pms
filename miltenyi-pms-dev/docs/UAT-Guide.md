# Miltenyi PMS — UAT Guide

As of 27 September 2026. Living copy (editable, commentable): https://claude.ai/code/artifact/4a8278be-e1b3-4ef1-b2b2-c4ec3179e361

## Accounts and roles

UAT runs on its own database with two logins. Password for both: `password123`, no forced change on first login.

| Login | Name | Role | What they can do |
| --- | --- | --- | --- |
| gautham@healthark.ai | Gautham | Admin (Healthark HR) | Everything: Users, System Settings, Framework, Notify, Exports, every goal and review, management ratings, unlocks |
| shreshta@healthark.ai | Shreshta | Mentor | Her mentees' annual goals and reviews (Team Goals), the Project Goals queue, entering the Miltenyi review on the reviewer's behalf |

No staff exist yet. First UAT step: Admin Panel → Users → add staff with role Staff, a function, a designation (the level decides which goal themes they get) and Shreshta as mentor. Only Healthark people log in; Miltenyi managers never do, their comments are typed in by the mentor.

Who may do what:

- A Staff member can only create annual goals when they have an active mentor.
- Annual goals are approved and reviewed by the mentor of record. The Admin sees everything but does not approve annual goals.
- Project Goals: the mentor records the offline approval and enters the quarterly Miltenyi review. The Admin may also submit a review and can unlock a submitted one.
- Function and designation cannot be changed while the person has a goal set in the active goal year (promotions happen between years).

## The calendar: one goal year, quarters the Admin moves

Everything runs on one goal year, **CY 26-27** (April 2026 to March 2027). Annual goals, annual reviews and the per-year switches belong to the same year; the app labels it CY everywhere.

| Quarter | Rolled out today? | Annual half |
| --- | --- | --- |
| Q1 · CY 26-27 | yes, open for backfill | H1 |
| Q2 · CY 26-27 | yes, open for backfill | H1 |
| Q3 · CY 26-27 | yes, **current** | H2 (current) |
| Q4 · CY 26-27 | no, locked | H2 |

Rules:

- The Admin moves the quarter in System Settings (quarter roll-out card): **Roll out** the next quarter, **Set manually** to any quarter, or **Roll back** one quarter. Every move is logged and announces itself in everyone's bell.
- The **current quarter is the review window**. Earlier quarters of the year stay open for backfill while their switch is on; later quarters are locked.
- The annual H1/H2 cycle follows the quarter: Q1–Q2 are H1, Q3–Q4 are H2. Rolling out Q3 opens H2; rolling back to Q2 closes it again.
- **Q4 → Q1 starts the next goal year** (typed confirmation). The new year starts with every switch closed and the frameworks copied; the old year stays readable and open for backfill until the Admin closes it; annual goals and reviews move to H1 of the new year.
- There is no date simulation. To test another quarter or half, move the quarter.

## Project Goals: set once a year, reviewed every quarter

A staff member has one goal sheet per goal year: one goal per KPI of the framework row for their function and level, with fixed weightages, plus an optional "Additional goals" row. Goals are agreed offline with the Miltenyi reviewer; the app records that agreement. Each quarter the staff member writes a self-review and one rating, then the mentor types in the Miltenyi reviewer's comments and the final rating.

| Action | Who | Allowed when |
| --- | --- | --- |
| Start or edit the goal sheet (draft) | Staff | **Goal entry open** is on for the year and a framework row exists for their function × level |
| Submit goals | Staff | same as above; wording already agreed offline |
| Mark approved (agreed offline) | Mentor of record | the sheet is Submitted; records who agreed and when; goals lock for the year |
| Write and submit the quarter self-review | Staff | goals Approved and the quarter is **writable**: the current quarter, or an earlier one whose **Open for backfill** switch is on (past year: the year's and the quarter's backfill switches) |
| Draft the Miltenyi review | Mentor or Admin | quarter writable; a draft may start before the self-review |
| Submit the Miltenyi review | Mentor (Admin may submit anyway) | after the self-review is in; one final rating, "Given by" Miltenyi reviewer or Healthark; optional Secondary review note. Submitted = final |
| See the final rating | Staff | only after the Admin turns **Ratings visible** on for that quarter |
| Acknowledge the review | Staff | once the review is submitted; a read receipt, not agreement |
| Unlock a submitted review | Admin | any time; the review returns to draft and the acknowledgement is cleared |

Weightages are informational and appear to staff only while **Weightages visible to staff** is on. The Team Goals and All Goals queues show every sheet's state per quarter and let the Admin filter by function, level and mentor.

## Annual Goals: competency goals with H1 and H2 reviews

Each staff member writes their own annual goals (title, description with bold/italic/lists, optional web link), the mentor approves them, and both sides review them twice a year. Goals are stamped with the active year (CY 26-27).

| Action | Who | Allowed when |
| --- | --- | --- |
| Create, edit, submit a goal | Staff (a mentor or the Admin may create one on a mentee's behalf) | **Edit Access for Annual Goals** is on for the year and the staff member has a mentor |
| Approve or request changes | Mentor of record | goal Submitted; "changes requested" sends it back for editing and resubmission |
| Delete a goal | Staff | only a Draft; it disappears everywhere but the record is kept |
| H1 self-review | Staff | goal Approved and H1 open: from Q1 until the next goal year starts (H1 stays open for backfill during H2) |
| H2 self-review | Staff | goal Approved and H2 open: from the Q3 roll-out until the next goal year starts |
| Mentor review, draft | Mentor | any time the half is open, even before the self-review |
| Mentor review, submit | Mentor | only after the mentee's self-review for that half |
| Staff sees the mentor's review | Staff | only when **Show H1 / H2 Mentor Reviews on Annual Goals** is on for the year; until then they see "submitted, hidden until published" |

Each review records who wrote it. The mentor's Team Goals tab has a **Notify** button per goal for a free-text nudge to the mentee. Once a half is closed (the next goal year has started) nothing can be added for it.

## Annual Reviews and Management Review

One review per person per year, in three stages that always run in this order.

| Stage | Who | Allowed when | Result |
| --- | --- | --- | --- |
| 1. Self-review (text + rating 1–5, drafts allowed) | Staff | **Enable Annual Reviews** is on for the year | review becomes "awaiting mentor" |
| 2. Mentor evaluation (text + rating) | Mentor of record | self-review submitted and **Enable Annual Reviews** on | review becomes "awaiting management" |
| 3. Management rating (calibration) | Admin, on the Management Review page | mentor evaluation submitted and **Enable Management Review** on for the year. Never before the mentor | review Completed |

What staff see: their own rating and text always; the final rating only while **Show Ratings on Annual Reviews** is on for the year. The Admin's All Reviews tab lists every person's stage, and the dashboard counts who has not started. Closing **Enable Annual Reviews** stops new submissions but the Admin can still calibrate while **Enable Management Review** stays on.

## System Settings cheat sheet

Admin Panel → System Settings: the quarter roll-out card on top, one **Configure year** dropdown (CY labels), two columns of switches for that year, one **Save** that opens a confirmation listing every flip with who it affects ("3 staff members have not started goals…"). Nothing changes until **Apply changes**. The Calendar card (year start April, timezone Asia/Kolkata, current cycles) is read-only.

| Switch | Scope | When it is OFF |
| --- | --- | --- |
| Enable Annual Reviews | per year | staff cannot submit self-reviews and mentors cannot submit evaluations; drafts are kept; the bell announces the pause |
| Show Ratings on Annual Reviews | per year | staff do not see the final annual rating |
| Enable Management Review | per year | the Admin cannot enter management ratings (the page shows a closed banner) |
| Edit Access for Annual Goals | per year | staff cannot create or edit annual goals; reviews are unaffected |
| Show H1 / H2 Mentor Reviews on Annual Goals | per year, one per half | staff see "review submitted, hidden until published" instead of the mentor's text |
| Goal entry open | per goal year | staff cannot start or submit a Project Goals sheet; approved sheets and reviews are unaffected |
| Weightages visible to staff | per goal year | KPI weightages are hidden from staff |
| Additional goals row (with its weightage) | per goal year | no free-text extra row on new sheets; submitted sheets keep what they had |
| Year open for backfill | past goal year only | that year's quarters become read-only |
| Open for backfill (per quarter) | earlier quarters of the year | that quarter becomes read-only; the current quarter is always open |
| Ratings visible (per quarter) | per quarter | the final quarterly rating is hidden from staff |

All switches for CY 26-27 are ON in the UAT database except the per-quarter ratings, which are hidden until released. The dashboard's Paused Settings card lists whatever is currently off.

## Notifications, announcements and emails

- **The bell** fires per event: a goal submitted, approved or sent back, a self-review or review submitted, a mentor's nudge, every quarter move, every Admin announcement. It also shows live alerts (drafts not submitted, goals awaiting a mentor's approval) and an Announcements tab for paused switches and a changed cycle.
- **Notify tab** (Admin): one announcement to a group. Filters combine: named people, roles (Staff / Mentor / Admin), functions; nothing selected means everyone except the sender. Channels: in-app, email or both. Bold, italic and lists carry through to the bell and the email. A confirmation shows the recipient count before sending.
- **Daily summary emails**: one email per person on weekdays at 09:00 (Asia/Kolkata), only when something is pending. Mentors get what they owe, grouped by mentee; staff get what is waiting on their mentor, goals sent back, approvals and quarterly reviews to acknowledge. The Notify tab shows the schedule and a **Send today's summaries now** button; a second run on the same day sends nothing.
- **Other emails**: a welcome email with a temporary password when a user is created, password-reset links, and per-event mails for the main lifecycle steps.

Emails only leave the server when SMTP is configured for that environment. Without it the app works normally, the Notify tab says "Email not configured", and the Admin sees a new user's temporary password on screen instead.

## Admin Panel

| Tab | What the Admin does there | Rules to know |
| --- | --- | --- |
| Users | Add, edit, deactivate, reactivate; set role, function, designation, mentor and the Miltenyi reviewer's name | Employee codes are assigned automatically. Deactivation blocks login at once and locks in-flight reviews; the person's mentees show as a coverage gap on the dashboard until re-paired. Reactivation keeps the old password |
| Framework Mapping | Function, designation (level), mentor and Miltenyi reviewer per person | Function and designation are locked while the person has a goal sheet in the active goal year (409); change them between years |
| Framework | The goal themes per function × level: title, two paragraphs, KPIs with weightages totalling 100; add functions, designations and levels | Staged Save. A function without rows (Pharmacovigilance today) shows its staff "no framework yet" until rows are added |
| Exports | Excel files: users, goals, annual reviews, everything | Every export is written to an append-only audit log |
| System Settings | Quarter roll-out, per-year switches, Calendar | See the cheat sheet above |
| Notify | Announcements and the daily summary emails | See above |

The Admin dashboard shows the cycles, Project Goals progress per quarter, annual review and goal approval progress for the selected year, pending actions (unsubmitted reviews, paused settings), headcount and mentor coverage.

## Not in this build

- Per-project reviews and Projects are retired; Project Goals replaced them.
- Annual goals have no key results or checklist under a goal; approved annual goals cannot be thrown back to draft; no bulk approval.
- Year switches apply to everyone; there are no per-person exceptions.
- The management stage records a rating only, no comment; there is no HR review tracker beyond the dashboard and the daily summary email.
- Staff cannot export their own goals; exports are Admin-only.
- No date simulation: to reach another quarter or half, move the quarter in System Settings.
- Emails depend on SMTP being configured for the UAT server; without it, in-app behaviour is complete but no mail goes out.

## How to report a finding

One message per finding, with:

1. The login used and its role.
2. The page, and the year, quarter and half shown in the top bar at the time.
3. The steps, what you expected, what happened, and a screenshot.
4. If a switch might matter, its state in System Settings (for example "Goal entry open was off").

Suggested order for a first pass: add two staff members under Shreshta, have one enter and submit Project Goals and annual goals, approve them as Shreshta, run a Q3 self-review and Miltenyi review, release the Q3 rating, then roll Q4 out and watch what changes.
