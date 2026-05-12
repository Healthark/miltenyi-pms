# QA Test Cases — Module 6: Cross-Cutting UX & Regression

> **Audience:** Manual QA tester, non-technical.
> **Prerequisite:** Modules 1–5 reviewed.
> **Goal:** Catch UX inconsistencies, regression bugs, and edge cases that span the whole app rather than living in one feature module.
> **How to use:** Run these checks LAST, after you've already exercised each feature. You'll often re-visit pages from earlier modules.

---

## 6.1 Responsive layout

Run each of these at three browser widths: **narrow ≈ 600 px** · **medium ≈ 1000 px** · **wide ≈ 1400 px+**. Use Chrome DevTools (F12) → Toggle device toolbar (Ctrl+Shift+M) to switch widths quickly.

### TC-RESP-001 — Sidebar on narrow widths

**Login as:** any role
**Steps:**
1. Open the app at narrow width.

**Expected:**
- Sidebar either collapses into a hamburger icon (revealable on click) OR auto-hides.
- Main content uses the full width.
- No horizontal scrollbar at any width.

---

### TC-RESP-002 — Top navigation on narrow widths

**Steps:**
1. At narrow width, check the top bar.

**Expected:**
- Logo, navigation items, bell, avatar all fit.
- Long items may abbreviate or hide; nothing overflows.

---

### TC-RESP-003 — Tables on narrow widths

**Steps:**
1. Open any table-view page (e.g. All Goals, All Reviews) at narrow width.

**Expected:**
- Either:
  - Table converts to card layout, OR
  - Table scrolls horizontally with a visible scrollbar inside the table area, NOT the page.
- Filter row stacks vertically on narrow widths if needed.

---

### TC-RESP-004 — Modals on narrow widths

**Steps:**
1. Open any modal (goal-create, secondary review, view modal) at narrow width.

**Expected:**
- Modal width adapts; never wider than the viewport.
- Padding inside the modal shrinks proportionally.
- Close X is reachable; ESC closes.

---

### TC-RESP-005 — Forms on narrow widths

**Steps:**
1. Open a multi-field form (Add Goal, Invite User) at narrow width.

**Expected:**
- Multi-column forms collapse to single column.
- Buttons stack or shrink but stay legible.

---

### TC-RESP-006 — Toasts on narrow widths

**Steps:**
1. Trigger a toast (e.g. submit a goal) at narrow width.

**Expected:**
- Toast appears in the same corner as on desktop.
- Toast width adapts; text doesn't overflow.

---

### TC-RESP-007 — HR Dashboard widgets at three widths

**Login as:** HR_MyOrg
**Steps:**
1. Cycle widget layout through: wide (3 cols), medium (2 cols), narrow (1 col).

**Expected:**
- Widgets resize cleanly.
- Charts/text inside widgets do not overflow.

---

## 6.2 Empty / Loading / Error states

### TC-STATE-001 — Empty state on every list

**Steps:**
1. For each list page (My Goals, Team Goals, All Goals, My Reviews, etc.), engineer or filter your way to zero rows.

**Expected each:**
- A friendly empty-state graphic + heading + supporting line.
- No console errors (open F12 → Console while testing).

**UI checks:**
- Empty-state is centered both horizontally and vertically in its container.
- Icon size is consistent across pages (≈ 40 px).
- Tone of voice ("No goals yet" vs "No matching reviews") is correct: distinguish "nothing exists" from "filter matched nothing".

---

### TC-STATE-002 — Loading state on every list

**Steps:**
1. With DevTools → Network throttled to Slow 3G, navigate to each list page.

**Expected each:**
- A skeleton/spinner is shown while loading.
- No flash of empty-state before data loads.
- Loading state matches the shape of the loaded content (no layout shift when data arrives).

---

### TC-STATE-003 — Error state on every list

**Steps:**
1. With DevTools → Network → block the API request OR disconnect from internet, navigate to a list.

**Expected each:**
- A red error banner or toast: "Failed to load. Please try again."
- A **Retry** button (if implemented).
- The app does NOT crash to a blank screen.

---

### TC-STATE-004 — 404 page

**Steps:**
1. Navigate to a random non-existent URL (e.g. `<host>/this-does-not-exist`).

**Expected:**
- A 404 page renders with the app's chrome (header/sidebar) intact.
- A clear message: "Page not found".
- A link or button back to home.

**UI checks:**
- 404 page is centered and proportional.
- Brand colors and typography match the rest of the app.

---

## 6.3 Filters & Sort consistency

### TC-FS-001 — Same filter pattern across pages

**Steps:**
1. Open any 3 list pages (e.g. All Goals, All Reviews — Annual, All Reviews — Project).

**Expected:**
- Filter dropdowns are on the same row, evenly spaced.
- Combobox filters (Employee, Project) behave identically: typeable, debounced, clearable.
- Status filter dropdowns have consistent options/styling.

---

### TC-FS-002 — Sort indicators match

**Steps:**
1. On each sortable column on each page, click the header.

**Expected:**
- Sort indicator (up/down arrow) is in the SAME position on every page.
- Only the active column shows an indicator.
- Clicking the same header twice reverses sort.

---

### TC-FS-003 — Clearing filters

**Steps:**
1. Apply 3+ filters.
2. Use a "Clear all" or set each back to "All" manually.

**Expected:**
- Table fully resets to original state.
- Search box clears (if it's a shared "filter row").

---

### TC-FS-004 — Filters persist on tab switch (or reset)

**Steps:**
1. Apply filters on All Goals tab.
2. Switch to All Reviews tab and back.

**Expected:** Verify with the product team — either filters persist (preferred) or reset (acceptable). Whichever it is, it should be CONSISTENT across all tab pairs.

---

## 6.4 Toasts / Snackbars / Confirm modals

### TC-TOAST-001 — Success toast style

**Steps:**
1. Trigger several success actions: save a goal, submit a review, deactivate a user.

**Expected each:**
- Toast appears in the same corner.
- Green/teal color.
- Auto-dismisses after a few seconds.

---

### TC-TOAST-002 — Error toast style

**Steps:**
1. Trigger several errors: submit invalid input, hit a 500, etc.

**Expected each:**
- Red color.
- Appears in the same corner as success toasts.

---

### TC-TOAST-003 — Snackbar for batch operations

**Steps:**
1. Use Bulk Approve on goals with at least one failure (e.g. an already-approved item slipped in).

**Expected:**
- A snackbar lists the failures with reasons.
- Successful approvals are reported in a green snackbar separately or as a count.

---

### TC-CONFIRM-001 — Confirmation dialog style

**Steps:**
1. Trigger several confirm dialogs: submit a goal, deactivate a user, finalize a review.

**Expected each:**
- Dialog is centered.
- Primary action button uses the appropriate color: destructive = red, normal = brand.
- Cancel button is to the left of the primary.
- ESC closes the dialog (treated as Cancel).

---

### TC-CONFIRM-002 — Destructive confirms have explicit copy

**Steps:**
1. Trigger a destructive confirm (deactivate a user).

**Expected:** Body text spells out the consequence: "This will revoke their access immediately. They can be reactivated later."

---

## 6.5 Date / FY formatting

### TC-DATE-001 — FY label consistency

**Steps:**
1. Across all pages, look at FY labels: dashboards, filters, tables, modal headers.

**Expected:** Every FY label uses the same format. The product convention is **"FY26-27"** (short) or **"FY 2026–27"** (long). Whichever is used must be consistent within each context (e.g. all dropdowns use the long form; all badges use the short form).

---

### TC-DATE-002 — Date timestamp consistency

**Steps:**
1. Across pages with timestamps (audit log, "submitted at", "approved on"), confirm the format.

**Expected:**
- Either absolute ("12 May 2026, 14:30") or relative ("2 hours ago"), but consistent within similar contexts.

---

### TC-DATE-003 — Half label consistency

**Steps:**
1. On goals with self-reviews, the half label appears as "H1" or "H1 FY 2026–27" depending on context.

**Expected:** Within the same surface, label format is consistent.

---

## 6.6 Permission denied (403) surfaces

### TC-403-001 — Staff hitting HR URL

**Login as:** Staff
**Steps:**
1. Navigate to `<host>/admin/users` directly in the address bar.

**Expected:**
- A clean 403 / "You don't have access" page renders WITH the app's chrome (sidebar, header).
- A link back to home.
- No stack trace, no blank screen.

---

### TC-403-002 — Mentor hitting Staff-only API

**Login as:** Mentor
**Steps:**
1. Try a URL that's Staff-only (e.g. a personal-goal-creation page).

**Expected:** Same as TC-403-001 — clean, friendly, branded.

---

### TC-403-003 — Logged-out user hitting any internal URL

**Login as:** _not logged in_
**Steps:**
1. Paste an internal URL (e.g. `<host>/annual-goals`) without logging in.

**Expected:** Redirected to `/login` with the original URL preserved as a redirect param (so post-login you land where you intended).

---

### TC-403-004 — Deactivated user URLs

**Pre-condition:** A user was deactivated mid-session.
**Steps:**
1. After the deactivation, that user hits any URL.

**Expected:** Redirected to `/login?reason=deactivated` (Module 1 TC-AUTH-012).

---

## 6.7 Browser & device compatibility

### TC-BROW-001 — Test on Chrome

**Steps:** Run a happy-path sweep (login → open My Goals → open Annual Reviews → open Project Reviews → logout).

**Expected:** All flows work; no console errors.

---

### TC-BROW-002 — Test on Firefox

**Steps:** Same happy-path sweep on Firefox.

**Expected:** Identical behavior to Chrome.

---

### TC-BROW-003 — Test on Edge

**Steps:** Same on Edge.

**Expected:** Identical behavior.

---

### TC-BROW-004 — Test on Safari (if available)

**Steps:** Same on Safari (Mac).

**Expected:** Identical behavior. Look out for date input differences and modal animation quirks.

---

### TC-BROW-005 — Mobile viewport (iPhone-sized)

**Steps:** Toggle DevTools mobile emulation (iPhone 12 viewport).

**Expected:**
- App is fully usable; nothing overflows.
- Touch-tap targets are at least 44 px tall.

---

## 6.8 Keyboard & accessibility

### TC-A11Y-001 — Tab order

**Steps:**
1. On Login → tab through fields → reach Sign In → reach Forgot Password.

**Expected:** Order is logical (Email → Password → Sign In → Forgot Password).

---

### TC-A11Y-002 — Modal focus trap

**Steps:**
1. Open any modal.
2. Press Tab repeatedly.

**Expected:** Focus cycles inside the modal; does not escape to the page underneath.

---

### TC-A11Y-003 — ESC closes modals

**Steps:**
1. Open every modal type (goal create, review detail, confirmation, profile).
2. Press ESC.

**Expected:** Each closes.

---

### TC-A11Y-004 — Click outside closes modals

**Steps:**
1. Open every modal.
2. Click on the dark backdrop outside the modal.

**Expected:**
- Read-only / view modals: close.
- Form modals: may either close OR require explicit Cancel/Save (to prevent data loss). Verify each modal's behavior with the product team — but it should be CONSISTENT across all form modals.

---

### TC-A11Y-005 — Visible focus indicator

**Steps:**
1. Tab through any page.

**Expected:** Each focused element shows a visible outline (blue ring or similar). No element is invisible to keyboard users.

---

## 6.9 Console & network hygiene

### TC-LOG-001 — No console errors on happy paths

**Steps:**
1. Open DevTools → Console.
2. Walk through every major flow.

**Expected:** No red error messages. Yellow warnings are acceptable but worth noting if many.

---

### TC-LOG-002 — No 4xx/5xx on happy paths

**Steps:**
1. Open DevTools → Network.
2. Walk through happy paths.

**Expected:** All API responses are 2xx. 401s are acceptable only after session expiry.

---

### TC-LOG-003 — Sensitive data not leaked in URLs

**Steps:**
1. Check URLs across all pages.

**Expected:**
- No email addresses, names, tokens, or IDs in query strings unless functional.
- Especially: no auth tokens in URLs.

---

## 6.10 Final regression sweep — happy-path roundtrip

Do this sweep **after** every release. It's the smoke test for "the app still works end-to-end."

**Login as:** HR_MyOrg
1. Open HR Dashboard → all 7 widgets load.
2. Open Users → invite a test user.
3. Open Settings → toggle a setting → save → refresh → setting persists.
4. Logout.

**Login as:** Staff (the test user OR an existing test Staff)
1. Open My Goals → create a goal → submit for approval.
2. Open Annual Reviews → start self-review → save draft → continue → submit.
3. Logout.

**Login as:** Mentor (mentor of that Staff)
1. Open Team Goals → approve the goal.
2. Open Team Reviews (Annual) → finish the mentor stage.
3. Logout.

**Login as:** HR_MyOrg
1. Open All Goals → confirm the goal appears.
2. Open All Reviews → confirm the review appears.
3. Open HR Dashboard → confirm funnel counts updated.
4. Export Users → file downloads cleanly.
5. Open Audit Log → confirm the export action is logged.

If every step in this sweep passes, the release is functional. Then run the focused module test cases for deeper coverage.

---

## 6.11 Bug-reporting workflow (reminder)

Use the template from Module 1 §1.8 for every finding. Always include:

- Module + Test Case ID
- Browser + version + window width
- Steps to reproduce
- Expected vs Actual
- Screenshot
- DevTools console errors (F12 → Console)
- DevTools network errors (F12 → Network → look for red rows)

---

**End of Module 6.**

---

## All-modules index

| Module | Topic | File |
|---|---|---|
| 1 | Foundational / cross-cutting (auth, RBAC, profile, notifications, settings, admin) | `QA-Test-Cases-01-Foundational.md` |
| 2 | Annual Goals (My / Team / All Goals, Self & Mentor Review) | `QA-Test-Cases-02-AnnualGoals.md` |
| 3 | Annual Reviews (My / Mentor / Management / All Reviews) | `QA-Test-Cases-03-AnnualReviews.md` |
| 4 | Project Reviews (PM Eval, Secondary, Team Reviews, All Reviews) | `QA-Test-Cases-04-ProjectReviews.md` |
| 5 | HR-only (Dashboard, Exports, Audit Log) | `QA-Test-Cases-05-HR.md` |
| 6 | Cross-cutting UX & Regression (responsive, states, filters, toasts, 403, sweep) | `QA-Test-Cases-06-CrossCuttingUX.md` |

Total: 6 modules · ~200 test cases · ready for QA hand-off.
