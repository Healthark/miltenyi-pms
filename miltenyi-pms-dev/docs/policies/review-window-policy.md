# Review Window Policy — Stakeholder Discussion Table

**Status:** Draft, awaiting stakeholder sign-off.
**Last updated:** 2026-05-21
**Owners:** PMS engineering + HR stakeholders.

## Purpose

Lock down WHEN each review form opens, closes, what dependencies apply, and what happens after a cycle passes. Every row needs a decision before the related lockout logic can ship.

## How to use this document

- Walk top-down through sections 1 → 2 → 3 → 4 in the meeting. Each section covers one review type — finish all its rows before moving on, so dependencies stay clear.
- The **Proposed Default** column is the engineering recommendation. Reading the row and asking "agree or change?" keeps pace brisk.
- The **Stakeholder Answer** column is empty for the meeting; fill during discussion. Use ✅ for "agree as proposed", or write the override.
- Rows marked **NEW** in the Notes column are net-new code work; the rest mostly reuse existing toggles already in System Settings.
- Rows **2.5**, **2.8**, **3.7** are the philosophy questions (couple vs decouple, what to do about non-submitters). Allow extra discussion time on those.

---

## 1. Project Reviews

> Project reviews follow the org's configured cadence (currently **half-yearly** H1/H2 in System Settings; could be switched to quarterly Q1–Q4). The same rules apply regardless of cadence — just substitute "quarter" / "half".

| # | Decision | Proposed Default | Stakeholder Answer | Notes |
|---|---|---|---|---|
| 1.1 | How many days before the cycle (quarter/half) ends should the review form **OPEN** for the PM? | **Current and Previous Quarter always open** | | |
| 1.2 | When does the review **CLOSE** for a given cycle? | **End of FY** containing that cycle (e.g. Q1 of FY26-27 closes 31 Mar 2027) | | Backfill across cycles within the same FY is allowed; cross-FY hard-locks. |
| 1.3 | Can a PM fill an **earlier cycle** of the **same FY** after it has technically ended? | **Yes — until FY rolls over** | | "I forgot to do Q1, can I submit it in Q3?" → yes, same FY. |
| 1.4 | Can a PM fill a cycle from a **previous FY**? | **No — locked at FY rollover** | | Once new FY starts (Apr 1 for April-start orgs), prior-FY reviews lock. |
| 1.5 | Should the **Secondary Evaluator** follow the **same window** as the PM? | **Yes — single window for both** | | Simpler mental model. Currently same code path. |
| 1.6 | Should HR retain the **emergency override** (`cycle_window_override` flag) to unlock a cycle for special cases? | **Yes — keep as escape hatch** | | Already implemented; flag in System Settings. |
| 1.7 | When HR closes a cycle manually mid-window (sets `cycle_window_override = false`), should in-progress drafts be **preserved** or **discarded**? | **Preserved as drafts; submit blocked** | | Defensive — no lost work. |

---

## 2. Annual Goals — Self & Mentor Reviews (H1 / H2)

> Annual goals are submitted at the start of the FY and reviewed twice: once at the H1 mid-point (Sep 30 for April-start orgs), once at H2 / year-end (Mar 31).

| # | Decision | Proposed Default | Stakeholder Answer | Notes |
|---|---|---|---|---|
| 2.1 | How many days before H1 ends should the **H1 Self Review** form OPEN for the Employee? | **30 days before H1 ends** (≈ last month of H1) | | **NEW** system setting `goal_review_lead_days` (default 30). |
| 2.2 | When does the **H1 Self Review CLOSE**? | **End of H1 + 15-day grace** (e.g. 15 Oct for April-start) | | After grace, locked unless HR overrides. |
| 2.3 | When does the **H1 Mentor Review** OPEN? | **Event-driven** — opens the moment the Employee submits their H1 self-review | | Already works this way; confirm OK. |
| 2.4 | When does the **H1 Mentor Review CLOSE**? | **End of H1 + 30-day grace** (e.g. 30 Oct) | | Mentor gets a month from H1-end to evaluate. |
| 2.5 | Should **H2 Self Review be blocked until H1 is COMPLETE** (both self AND mentor done)? | **No — decoupled, H1 can be late while H2 starts** | | Coupling would strand goals in limbo if H1 mentor evaluation is delayed. |
| 2.6 | Can Employee / Mentor still fill **H1 after the H1 window has passed** (e.g. during H2)? | **Yes — until end of FY** | | Late-H1 allowed within same FY. |
| 2.7 | When the FY rolls over (Apr 1), are **ALL** goal reviews from the previous FY hard-locked? | **Yes** | | Mirrors project review rule. HR override available. |
| 2.8 | If an Employee submits H1 self-review but their mentor never writes the H1 mentor review, **does the goal still progress to H2**? | **Yes** | | Employee work isn't blocked by mentor inaction. |

---

## 3. Annual Reviews

> One per Employee per FY. Pipeline: Employee Self → Mentor → Management Calibration → Final Published.

| # | Decision | Proposed Default | Stakeholder Answer | Notes |
|---|---|---|---|---|
| 3.1 | How many days before FY ends should the **Annual Self Review** OPEN? | **30 days before FY ends** (≈ last month of FY) | | **NEW** system setting `annual_review_lead_days` (default 30). |
| 3.2 | When does the **Self Review CLOSE**? | **15 days after FY ends** (e.g. 15 Apr) | | Grace period for stragglers. |
| 3.3 | When does the **Mentor Review** OPEN? | **Event-driven** — when Employee submits | | Existing flow. |
| 3.4 | When does the **Mentor Review CLOSE**? | **30 days after FY ends** (e.g. 30 Apr) | | Mentor gets one month from FY end. |
| 3.5 | When does **Management Calibration** OPEN? | **Event-driven** — when Mentor submits | | Existing flow. |
| 3.6 | When does **Management Calibration CLOSE**? | **60 days after FY ends** (e.g. 30 May) | | HR has two months for calibration. |
| 3.7 | What if an Employee **fails to submit a self-review by the close date**? | **HR can manually start a draft on their behalf** (or extend window globally via `annual_reviews_enabled`) | | Needs discussion — auto-create draft? Skip the cycle? Email nag? |
| 3.8 | Can a previous FY's Annual Review be **edited after the calibration closes**? | **No — locked. HR override only.** | | Existing `annual_reviews_enabled` + `cycle_window_override` toggles. |
| 3.9 | Should the **final rating be visible to the Employee** the moment Calibration closes, or only after a separate "Publish" action by HR? | **Auto-visible at Calibration close** (`annual_review_final_rating_visible` already gates this) | | Toggle exists; could stay manual. |

---

## 4. Cross-Cutting Policy

| # | Decision | Proposed Default | Stakeholder Answer | Notes |
|---|---|---|---|---|
| 4.1 | Where do the three **lead-day settings** (`project`, `goal`, `annual`) live? | **System Settings tab, single section "Review Window Policy"** | | HR_MyOrg only. HR_Miltenyi does not touch these. |
| 4.2 | Org-wide `cycle_window_override` vs **per-cycle** override? | **Keep org-wide for now**; revisit if HR keeps needing surgical control | | Current implementation is org-wide; works at scale. |
| 4.3 | Should the **topbar surface a countdown** ("Review window closes in 3 days") when within 7 days of close? | **Yes — amber chip in the top-right** | | Nice-to-have; reduces "I missed it" tickets. |
| 4.4 | When a user is **deactivated mid-cycle**, do their in-flight reviews stay submittable until close, or lock immediately? | **Lock immediately** (consistent with deactivation = "user is gone") | | Drafts preserved for audit; just no further edits. |
| 4.5 | Should **email reminders** fire X days before each review window closes? | **Yes — at T-7 and T-1 days** for each window | | Future scope; not blocking this release. |
| 4.6 | Should `simulated_today` (the date-simulation override) **respect or bypass** all of the above lockouts? | **Respect** — simulating "Mar 25" should make Annual Self Review available, even on real calendar Jan 15 | | Existing intent; confirm. |

---

## Decisions Summary

Once the stakeholder column is filled in for every row, this section becomes the canonical reference for what got built.

> _To be filled after the meeting._

---

## What gets built after the meeting

Depending on what's locked in:

- **3 new System Settings sliders** (`project_review_lead_days`, `goal_review_lead_days`, `annual_review_lead_days`) — proposed defaults 15 / 30 / 30 days.
- **Backend `is_review_window_open()` extension** to read each setting + the cycle's calculated end date and apply per-review-type lead-time.
- **FY-rollover hard-lock** enforcement on prior-FY reviews (currently soft — `cycle_window_override` lets through; we'd add a deeper guard).
- **Topbar countdown chip** (if approved in 4.3).
- **Email reminder cron** (if approved in 4.5 — separate sprint).

---

## Glossary

- **FY** — fiscal year. Spans the months defined by `system_settings.fiscal_start_month` (default 4 = April; April-start orgs run FY26-27 from Apr 2026 → Mar 2027).
- **H1 / H2** — first / second half of the FY. For an April-start org: H1 = Apr–Sep, H2 = Oct–Mar.
- **Q1–Q4** — quarters of the FY. Only used when `cycle_type = quarterly`.
- **Cycle** — generic term for the org's current review period; "H1 FY26-27" or "Q3 FY26-27" depending on cadence.
- **Lead days** — how many days *before* a cycle end the corresponding review form opens.
- **Grace period** — how many days *after* a cycle / FY end the form stays open before hard-lock.
- **`cycle_window_override`** — existing org-wide toggle in System Settings that bypasses date-based locks. Used by HR for demos / catch-ups.
- **`annual_reviews_enabled`** — existing org-wide toggle that pauses all new annual-review submissions.
- **`simulated_today`** — existing dev/QA escape hatch that pins a fake "today" for cycle determination; gated behind `ALLOW_DATE_SIMULATION` env flag.
