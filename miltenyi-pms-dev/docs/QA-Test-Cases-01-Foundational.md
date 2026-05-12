# QA Test Cases — Module 1: Foundational & Cross-Cutting

> **Audience:** Manual QA tester, non-technical.
> **Scope of this document:** the parts of the app that touch every other module — Login & Session, Role Access, Profile, Notifications, System Settings, and User Admin.
> **Prerequisite:** you have the hosted application URL and a set of test accounts (Staff, Mentor, PM, HR_MyOrg, HR_Miltenyi). Use the credentials provided to you separately.

---

## How to use this document

1. Walk through each test case (TC) in order.
2. **Login as** tells you which test account to use.
3. **Steps** are numbered. Do exactly what each step says.
4. **Expected** describes what should happen. If anything is different, mark the test FAIL and screenshot it.
5. **UI checks on this screen** are visual checks for the *same* screen the test took you to. Don't skip them — they catch layout bugs that functional steps miss.
6. Use a notebook or spreadsheet to record: **Test ID · Pass/Fail · Notes · Screenshot link**.

### What "UI feels off" means

Open every screen and ask these six questions. If the answer to any is *yes*, flag it as a UI bug:

- Is any text cut off, overlapping, or running into another element?
- Are buttons / input boxes wider or narrower than the others around them without a reason?
- Is anything misaligned (e.g. a column header sits to the right of its cell content)?
- Does spacing look uneven — too tight in one place, too loose in another?
- Does anything look stretched or squashed on a wider/narrower window?
- Are colors inconsistent with the rest of the app (e.g. one button is teal, another doing the same job is gray)?

Resize the browser window to test 3 widths each time: **narrow (≈ 600 px wide), medium (≈ 1000 px), wide (≈ 1400 px+)**. Most layout bugs only show up at one width.

---

## 1.1 Authentication — Login, Logout, Password Reset, Session

### TC-AUTH-001 — Login with valid credentials

**Login as:** _not logged in (open in fresh incognito window)_
**Steps:**
1. Open the hosted app URL.
2. You should land on the Login page automatically.
3. Type a valid Staff email in the **Email** box.
4. Type the matching password in the **Password** box.
5. Click **Sign In**.

**Expected:**
- You are taken to the home page (Dashboard or My Goals, depending on role).
- Your name and avatar appear in the top-right corner.
- No error banner is visible.

**UI checks on this screen (login page):**
- The login card is horizontally and vertically centered on the page.
- The company logo is visible above the form.
- Email and Password input boxes are the same width.
- The **Sign In** button is the same width as the input boxes (full-width).
- Tab key moves focus Email → Password → Sign In in that order.
- On a narrow window (≈ 600 px), the card does not overflow horizontally; no horizontal scrollbar appears.

---

### TC-AUTH-002 — Login fails with wrong password

**Login as:** _not logged in_
**Steps:**
1. Open the Login page.
2. Type a valid email.
3. Type an obviously wrong password (e.g. `wrongpassword123`).
4. Click **Sign In**.

**Expected:**
- A red error message appears below or above the form.
- The message says something like "Invalid email or password" — it should **not** reveal whether the email exists.
- You stay on the Login page; you are NOT taken to the home page.

**UI checks:**
- Error banner does not push the form out of vertical center.
- Banner text wraps cleanly; never extends past the card edge.
- Input boxes are NOT cleared (your typed email should still be there so you can fix the password without retyping).

---

### TC-AUTH-003 — Login fails with non-existent email

**Login as:** _not logged in_
**Steps:**
1. Type an email that doesn't exist (e.g. `nobody@nowhere.test`).
2. Type any password.
3. Click **Sign In**.

**Expected:** Same generic error as TC-AUTH-002. The app must NOT say "email not found" — that would let attackers fish for valid emails.

---

### TC-AUTH-004 — Login with empty fields

**Login as:** _not logged in_
**Steps:**
1. Leave both Email and Password empty.
2. Click **Sign In**.

**Expected:**
- The form does not submit.
- The browser's "Please fill out this field" hint, or an inline error, appears next to each empty field.

**UI checks:**
- The required-field indicator (asterisk or red border) is consistent on both fields.

---

### TC-AUTH-005 — Login as a deactivated user

**Login as:** _a deactivated test account (ask HR_MyOrg to deactivate one, or use a pre-prepared one)_
**Steps:**
1. Type the deactivated account's email and password.
2. Click **Sign In**.

**Expected:**
- A specific message appears: "Your account has been deactivated. Contact your administrator."
- The amber/yellow color banner is used (not the red error banner).
- You stay on the Login page.

---

### TC-AUTH-006 — "Forgot password?" link visible

**Login as:** _not logged in_
**Steps:**
1. On the Login page, look below or beside the password field.

**Expected:**
- A **Forgot password?** link is visible and clickable.

**UI checks:**
- Link text color contrasts with the background (you can read it).
- Cursor changes to a pointing hand on hover.

---

### TC-AUTH-007 — Password reset request

**Login as:** _not logged in_
**Steps:**
1. Click **Forgot password?**.
2. You should land on a reset-request page with a single Email field.
3. Type a valid registered email.
4. Click **Send Reset Link** (or whatever the button says).

**Expected:**
- A confirmation message appears: "Check your email for the reset link."
- The form clears or disables.
- No error is shown.

---

### TC-AUTH-008 — Password reset link works

**Login as:** _not logged in_
**Steps:**
1. Open the email inbox of the account from TC-AUTH-007.
2. Find the reset email and click the link.
3. You should land on a "Set new password" page.
4. Type a new password (meeting the rules shown on the page).
5. Confirm the password in the second field.
6. Click **Reset Password** (or equivalent).

**Expected:**
- A success message appears.
- You're redirected to Login.
- You can sign in with the new password.

**UI checks:**
- Password strength indicator (if present) updates as you type.
- The two password fields are the same width and stacked vertically.

---

### TC-AUTH-009 — Logout from the top-right menu

**Login as:** Staff
**Steps:**
1. After login, click on your name/avatar in the top-right corner.
2. A dropdown menu should appear.
3. Click **Sign Out** (or **Logout**).

**Expected:**
- You are redirected to the Login page.
- A success toast may say "Signed out" (optional).
- Clicking the browser **Back** button does NOT return you into the app — it stays on Login or re-prompts.

**UI checks:**
- Dropdown appears below the avatar, doesn't get clipped by the page edge.
- Menu items have consistent padding and font size.

---

### TC-AUTH-010 — Session expires after 30 minutes of inactivity

**Login as:** Staff
**Steps:**
1. Sign in successfully.
2. Open the app and don't do anything for **at least 31 minutes** (don't click, don't navigate — leave the tab open and untouched).
3. After 31 minutes, click anything that loads data (e.g. open another tab in the app).

**Expected:**
- You are redirected to `/login?reason=expired`.
- A small info banner reads: **"Your session expired due to inactivity. Please sign in again."**
- The banner sits above the login form, not overlapping it.

**UI checks:**
- The banner uses an information style (blue/gray), NOT red.
- Banner has padding inside; text is readable.

---

### TC-AUTH-011 — Session stays alive while you're using the app

**Login as:** Staff
**Steps:**
1. Sign in.
2. For the next 35 minutes, click around the app every 2–3 minutes — navigate between pages, open lists, etc.
3. After 35 minutes of active use, try opening a fresh page.

**Expected:** You stay signed in — no redirect to Login. The 30-min timer is **inactivity-based**, not absolute. As long as you're clicking around, the session keeps renewing.

---

### TC-AUTH-012 — Deactivated mid-session shows the deactivation banner

**Login as:** Staff (in browser A)
**Steps:**
1. While logged in as the Staff user in browser A, ask HR_MyOrg (in browser B) to deactivate that Staff user via Admin → Users.
2. In browser A, click anything that loads data (navigate to a different page).

**Expected:**
- Browser A redirects to `/login?reason=deactivated`.
- An amber banner reads: **"Your account has been deactivated. Contact your administrator if you believe this is a mistake."**

**UI checks:**
- Banner uses amber/yellow color (distinct from the blue "expired" banner).

---

### TC-AUTH-013 — Logging out has no banner

**Login as:** Staff
**Steps:**
1. Sign in.
2. From the top-right menu, click **Sign Out**.

**Expected:**
- You land on `/login` with NO query string and NO banner above the form.
- (Compare to TC-AUTH-010: only inactivity adds the banner. Manual logout is clean.)

---

### TC-AUTH-014 — Login page resizes correctly

**Login as:** _not logged in_
**Steps:**
1. Open the Login page in a wide browser window.
2. Slowly drag the window narrower until it's about phone-width (≈ 400 px).

**Expected:**
- The login card stays centered.
- Form fields shrink to fit but never overflow horizontally.
- No horizontal scrollbar appears at any width.
- Logo, title, fields, and Sign In button remain readable and tappable.

---

## 1.2 Authorization & Role Gating

### TC-RBAC-001 — Staff sees Staff tabs only

**Login as:** Staff
**Steps:**
1. Open the sidebar / top-nav.
2. Walk through each menu item.

**Expected (sidebar should contain ONLY):**
- Dashboard
- Annual Goals
- Annual Reviews
- Project Reviews (only if the staff is on at least one project)
- Profile

**NOT visible to Staff:**
- HR Dashboard
- Settings
- Users / Admin
- Exports

**UI checks:**
- Sidebar items are evenly spaced; no orphan separators or gaps.
- The currently active page is visually highlighted.
- Sidebar icons and labels are aligned (text not drifting up/down from its icon).

---

### TC-RBAC-002 — Mentor sees Team Goals + Team Reviews

**Login as:** Mentor
**Steps:**
1. Open Annual Goals — confirm only **Team Goals** tab is visible (no My Goals).
2. Open Annual Reviews — confirm Mentor sees the **Team Reviews** tab (or equivalent for mentors).

**Expected:** Mentor's primary tabs reflect they review others, not themselves. No "My Goals" or "My Reviews" tabs (unless the mentor is also a staff, which depends on the test data).

---

### TC-RBAC-003 — PM sees PM-specific entry points

**Login as:** PM (project manager)
**Steps:**
1. Open Project Reviews.

**Expected:**
- PM sees the **PM Evaluation** tab (pending project reviews assigned to them).
- PM can open and write reviews for their assigned projects.
- PM does NOT see HR-only tabs like "All Reviews" or "Export".

---

### TC-RBAC-004 — HR_MyOrg sees admin features

**Login as:** HR_MyOrg
**Steps:**
1. Confirm sidebar shows: **HR Dashboard**, **Annual Goals (All Goals tab)**, **Annual Reviews (All Reviews tab)**, **Project Reviews (All Reviews tab)**, **Settings**, **Users**.
2. Confirm exports and dashboard widgets render.

**Expected:** All HR-specific tabs and widgets are visible. No "My Goals" / "My Reviews" for HR_MyOrg unless test data has them as a staff too.

---

### TC-RBAC-005 — Direct URL access to forbidden pages

**Login as:** Staff
**Steps:**
1. While logged in as Staff, paste the URL of an HR-only page (e.g. `<host>/settings` or `<host>/admin/users`) into the address bar.

**Expected:**
- You get either:
  - A "403 Forbidden" / "You don't have access" page, OR
  - You are redirected back to your home page.
- The app does NOT crash or show a blank white screen.

**UI checks:**
- If a 403 page renders, it has consistent header/sidebar — it's not a stripped-down browser-default error.

---

### TC-RBAC-006 — Inactive features show locked banner, not 404

**Login as:** Staff
**Steps:**
1. If `annual_goals_edit_enabled` is currently FALSE, open Annual Goals → My Goals.

**Expected:**
- The page still loads.
- A banner reads "Goal submissions are currently closed."
- The **Add Goal** button is NOT present (or is disabled).

---

## 1.3 Profile

### TC-PROFILE-001 — View your own profile

**Login as:** Staff
**Steps:**
1. Click your avatar in the top-right → **Profile** (or open the Profile page from the sidebar).

**Expected:**
- Your name, email, role, function, designation, and mentor (if any) are displayed.
- Your avatar (or initials placeholder) is shown.

**UI checks:**
- Sections are aligned in a clean two-column or stacked layout.
- Label text (e.g. "Email") is muted / smaller; the value is darker / larger.
- The page does not have excessive blank space at the bottom.

---

### TC-PROFILE-002 — Profile shows assigned mentor

**Login as:** Staff who has a mentor assigned
**Steps:**
1. Open Profile.

**Expected:** A "Mentor" field shows the mentor's full name. It is NOT empty and does NOT say "No Mentor".

---

### TC-PROFILE-003 — Profile shows "No mentor assigned" gracefully

**Login as:** Staff who does NOT have a mentor (use a test account without a mentor)
**Steps:**
1. Open Profile.

**Expected:**
- Mentor field reads "No Mentor Assigned" (or equivalent) in muted/italic style — never blank or "undefined".

---

### TC-PROFILE-004 — Role Expectations modal opens

**Login as:** Staff
**Steps:**
1. Open Annual Goals → My Goals.
2. Look for a banner that says "Reference your role expectations…" with a **View Role Expectations** button.
3. Click it.

**Expected:**
- A modal opens, centered, with a darkened backdrop.
- The modal lists 8 competency / expectation sections relevant to your role+function.
- Each section has a heading and a description paragraph.

**UI checks:**
- Modal width is comfortable (not too narrow, not edge-to-edge).
- Long descriptions wrap; do not overflow the modal.
- Close button (X) is in the top-right of the modal.
- Modal closes when you click the X.
- Modal closes when you click the dark backdrop outside the modal.
- Modal closes when you press the ESC key.
- The modal does not jump or flicker when opening.

---

## 1.4 Notifications

### TC-NOTIF-001 — Bell icon visible

**Login as:** any role
**Steps:**
1. After login, look at the top-right of the page (near your avatar).

**Expected:**
- A bell icon is visible.
- If you have unread notifications, a small red badge with a number appears on the bell.

**UI checks:**
- The bell icon is the same size as the avatar / matches the height of the top bar.
- The unread badge is correctly positioned (top-right of the bell, not floating elsewhere).
- The badge number is centered inside its red circle.

---

### TC-NOTIF-002 — Open notifications dropdown

**Login as:** any role with at least one notification
**Steps:**
1. Click the bell icon.

**Expected:**
- A panel opens below the bell.
- It lists recent notifications: most recent on top.
- Each row shows: an icon, a short message, a timestamp ("2h ago"), and a state (read/unread).

**UI checks:**
- Panel doesn't get clipped by the right edge of the screen.
- Each notification row is the same height.
- Unread notifications look visually distinct from read ones (bolder text or a colored dot).

---

### TC-NOTIF-003 — Click a notification navigates to its source

**Login as:** any role with a notification linked to a goal/review
**Steps:**
1. Open the notifications panel.
2. Click on a single notification row.

**Expected:**
- You're taken to the source entity (the specific goal, review, or project the notification refers to).
- The notification is automatically marked as read (badge count decreases by 1).

---

### TC-NOTIF-004 — Mark all as read

**Login as:** any role with multiple unread notifications
**Steps:**
1. Open the notifications panel.
2. Click **Mark all as read** (button is usually at the top of the panel).

**Expected:**
- All notifications become "read" visually.
- The red badge on the bell disappears.
- After page refresh, they are still read.

---

### TC-NOTIF-005 — Empty notifications state

**Login as:** a test account with no notifications
**Steps:**
1. Click the bell icon.

**Expected:**
- The panel shows a friendly empty state ("You're all caught up!" or similar).
- No error, no infinite spinner.

**UI checks:**
- Empty-state illustration / icon is centered.
- Empty-state text is muted and not too large.

---

### TC-NOTIF-006 — Long notification list scrolls

**Login as:** a test account with 20+ notifications (HR can trigger several actions to generate them)
**Steps:**
1. Open the notifications panel.
2. Scroll down inside the panel.

**Expected:**
- The panel has a max height; once exceeded, scrolling happens inside the panel — not on the whole page.
- All notifications are reachable by scrolling.

---

## 1.5 System Settings (HR_MyOrg only)

### TC-SETTINGS-001 — Only HR_MyOrg can open Settings

**Login as:** Staff
**Steps:**
1. Try the Settings URL directly.

**Expected:** Forbidden / redirected (per TC-RBAC-005).

**Then login as:** HR_MyOrg
**Steps:**
1. Open Settings from the sidebar.

**Expected:** Settings page loads with current configuration values.

---

### TC-SETTINGS-002 — Cycle type display

**Login as:** HR_MyOrg
**Steps:**
1. Open Settings.

**Expected:**
- The current cycle type is shown (Annual / Half-yearly / Quarterly).
- The current active cycle name is shown (e.g. "H1 FY26-27").

**UI checks:**
- Each setting is in its own labeled row or card.
- Toggle switches (if used) are aligned consistently — all on the right side, same size.

---

### TC-SETTINGS-003 — Toggle "Annual goals edit enabled"

**Login as:** HR_MyOrg
**Steps:**
1. Open Settings.
2. Locate the "Annual goals edit enabled" toggle.
3. Note its current state.
4. Flip the toggle.
5. Wait for the save confirmation (toast or saved indicator).
6. Refresh the page.

**Expected:**
- The toggle state persists after refresh.
- A success toast appeared (e.g. "Settings updated").

**Then verify the effect:**
- Login as Staff in another browser.
- If the toggle is now OFF, Staff cannot add new goals (button hidden or banner shown).
- If the toggle is now ON, Staff can add goals.

---

### TC-SETTINGS-004 — Toggle "Project ratings visible"

**Login as:** HR_MyOrg
**Steps:**
1. In Settings, locate the "Project ratings visible" toggle.
2. Switch it OFF.

**Expected:**
- Login as Mentor; open Project Reviews → Team Reviews → click View on a reviewed row.
- The Project Rating row reads **"Hidden"** with a lock icon, not the number badge.
- Now switch it back ON in Settings, refresh the Mentor's modal — the rating badge reappears.

---

### TC-SETTINGS-005 — Toggle "Cycle window override"

**Login as:** HR_MyOrg
**Steps:**
1. Open Settings.
2. Toggle "Cycle window override" ON.

**Expected:** When this is ON, the H1/H2 calendar gate is bypassed for demos — Staff and Mentor can work on the current half even if the calendar says otherwise. Validate by logging in as Staff and confirming the relevant action (e.g. start a self-review) is available even outside the window.

---

### TC-SETTINGS-006 — Settings page UI

**Login as:** HR_MyOrg
**Steps:**
1. Open Settings.

**UI checks:**
- Each setting is grouped logically (e.g. "Cycle settings", "Goal settings", "Review visibility").
- Group headers are visually distinct from the settings inside them.
- Long descriptions wrap, never overflow.
- Save indicator (auto-save toast OR Save button) is consistent across all settings.

---

## 1.6 Users / Org Admin (HR_MyOrg)

### TC-ADMIN-001 — Open the Users page

**Login as:** HR_MyOrg
**Steps:**
1. Open the Users page from the sidebar.

**Expected:**
- A table of users loads.
- Columns include at least: Name, Email, Role, Function, Designation, Mentor, Status (Active/Deactivated).

**UI checks:**
- Column widths are reasonable — no column squashed so narrow it shows "…" everywhere, none so wide it leaves empty space.
- Row heights are consistent.
- The active/deactivated state is visually distinct (color badge or icon).

---

### TC-ADMIN-002 — Search / filter the user list

**Login as:** HR_MyOrg
**Steps:**
1. On the Users page, type part of a name in the search box.

**Expected:**
- The table filters live (as you type, or on Enter).
- Matching rows highlight or only matching rows remain.
- Clear the search → all users return.

---

### TC-ADMIN-003 — Filter by role and function

**Login as:** HR_MyOrg
**Steps:**
1. Use the Role filter dropdown → select "Mentor".

**Expected:** Only Mentor rows are shown.

2. Combine with a Function filter.

**Expected:** Only rows matching BOTH filters are shown.

3. Clear all filters → table resets.

---

### TC-ADMIN-004 — Invite a new user

**Login as:** HR_MyOrg
**Steps:**
1. Click **Invite User** (or **Add User**).
2. A modal/form opens.
3. Fill: Name, Email, Role, Function, Designation, Mentor.
4. Click **Send Invite** / **Save**.

**Expected:**
- A success toast appears.
- The new user appears in the users table.
- The new user receives an invitation email (verify the email landed).

**UI checks:**
- All required fields have a clear asterisk or "Required" marker.
- The form modal width is comfortable.
- Save button is at the bottom-right; Cancel is to its left, both visible without scrolling.

---

### TC-ADMIN-005 — Duplicate email is blocked

**Login as:** HR_MyOrg
**Steps:**
1. Click Invite User.
2. Type an email that already exists in the users table.
3. Click Save.

**Expected:**
- An inline error or toast: "A user with this email already exists."
- The form does not close; you can correct the field.

---

### TC-ADMIN-006 — Edit a user's role

**Login as:** HR_MyOrg
**Steps:**
1. In the users table, find a Staff user.
2. Click their row (or click the row's edit icon).
3. Change Role from Staff to Mentor.
4. Save.

**Expected:**
- Success toast.
- That row now shows Role = Mentor.
- Log in as that user separately and confirm the sidebar updates to show Mentor tabs.

---

### TC-ADMIN-007 — Assign / change mentor for a user

**Login as:** HR_MyOrg
**Steps:**
1. Find a Staff with no mentor.
2. Edit; in the Mentor field, pick a Mentor from the dropdown.
3. Save.

**Expected:**
- That Staff's Mentor column updates immediately.
- Log in as the assigned Mentor; the Staff now appears under their Team Goals tab.

---

### TC-ADMIN-008 — Deactivate a user

**Login as:** HR_MyOrg
**Steps:**
1. Find an active user.
2. Click the deactivate action (toggle, button, or kebab menu → Deactivate).
3. A confirmation dialog appears: "Deactivate <name>?" — confirm.

**Expected:**
- The row updates: Status = Deactivated (or moved into a separate "Deactivated" filter).
- That user's session ends on their next request (validate via TC-AUTH-012 if needed).

**UI checks:**
- Confirmation dialog is centered, has a clear destructive-action style (red button for confirm).

---

### TC-ADMIN-009 — Reactivate a user

**Login as:** HR_MyOrg
**Steps:**
1. Filter the users table to Deactivated.
2. Find the user from TC-ADMIN-008.
3. Click Reactivate.

**Expected:**
- Row returns to Active.
- That user can log in again.

---

### TC-ADMIN-010 — Function management (add / rename)

**Login as:** HR_MyOrg
**Steps:**
1. Open Functions / Designations admin (if exposed; may be on Settings or its own page).
2. Add a new function "QA & Validation".
3. Save.
4. Edit it: rename to "Quality & Validation".

**Expected:**
- Function appears in dropdowns elsewhere (e.g. Invite User → Function field).
- The renamed value flows through everywhere it was assigned.

---

### TC-ADMIN-011 — Designation management

**Login as:** HR_MyOrg
**Steps:** Same as TC-ADMIN-010 but for Designations.

---

### TC-ADMIN-012 — Users table sort

**Login as:** HR_MyOrg
**Steps:**
1. On the Users page, click the **Name** column header.

**Expected:** Rows re-sort A-Z. Click again → Z-A. Click a third time → original order (or remains in Z-A — confirm behavior with team).

**UI checks:** Sort indicator (up/down arrow) is shown only on the currently sorted column.

---

## 1.7 Cross-cutting UI / UX checks (do these on every screen)

Run these on every page you visit, regardless of test case. Log a separate bug for each finding.

| Check | What "good" looks like |
|---|---|
| **Top navigation height** | Same height across every page; doesn't jump on navigation. |
| **Sidebar width** | Constant width; doesn't expand/contract when you switch pages. |
| **Page padding** | Same left/right padding on every page; content doesn't hug the edge in some places and have huge gutters in others. |
| **Table column widths** | Long values truncate with "…" or wrap cleanly — they don't push the layout sideways. |
| **Modals** | Centered horizontally and vertically; backdrop covers the whole page; ESC closes them; clicking outside closes them; X is in the top-right; modal width matches the content (not too narrow, not edge-to-edge). |
| **Forms** | Labels are above their inputs (or aligned consistently); required fields have an asterisk; error messages appear inline and in red; success uses green/teal. |
| **Buttons** | Primary buttons (Save, Submit) are the brand color; secondary buttons (Cancel) are white/gray; destructive buttons (Delete, Deactivate) are red. Each button has a clear hover and pressed state. |
| **Toasts** | Appear in a consistent corner (usually bottom-right or top-right); auto-dismiss after a few seconds; do not stack into infinity. |
| **Loading states** | Each list shows a skeleton or spinner during load; nothing shows blank white while waiting. |
| **Empty states** | A friendly icon + sentence — never just a blank table. |
| **Error states** | When an API call fails, a clear error appears (red banner or toast). The app does NOT show a stack trace or a blank white screen. |
| **Font sizes** | Headings (H1) are clearly larger than subheadings (H2/H3) than body text. No two headings at the same level have different sizes. |
| **Color consistency** | Every "approved" badge is the same green. Every "pending" is the same amber. No two badges with the same meaning use different colors. |
| **Responsive** | At narrow widths (≈ 600 px), nothing overflows; tables convert to cards or scroll horizontally if needed. |
| **Mouse hover** | Every clickable element changes appearance on hover (cursor changes to a hand; color/border shifts). |
| **Keyboard nav** | Tab key moves through interactive elements in a sensible order. Modals trap focus inside themselves. ESC closes them. |

---

## 1.8 Bug reporting template (use this for every finding)

```
Bug ID: BUG-FOUND-001
Module: 1. Foundational / Cross-cutting
Test Case: TC-AUTH-002

Severity: (Critical / High / Medium / Low)
Browser & version: e.g. Chrome 142 on Windows 11
Window width: e.g. 1440 px

Steps to reproduce:
1. ...
2. ...

Expected:
...

Actual:
...

Screenshot: <link>
Console errors (if any): <press F12, click Console tab, screenshot any red errors>
```

---

**End of Module 1.** Next module: Annual Goals.
