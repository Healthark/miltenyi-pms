# PMS Risk Register

Forward-looking catalog of risks across the Miltenyi PMS app. Each row
identifies a way the code or architecture could break — in production
load, at boundary conditions, under concurrency, against misuse, or
during evolution. Updated as we walk through each module.

This is **not** a bug list. Existing-bug findings live in their own
tickets; this register captures **what could go wrong next**.

---

## Status legend

| Label | Meaning |
|---|---|
| **Severity** | Impact if the risk manifests. `H` = data loss / security / many users blocked. `M` = degraded UX or perf for a subset. `L` = cosmetic or rare-edge. |
| **Likelihood** | Probability under normal-ish operation. `H` = will happen / has happened. `M` = plausible under load or specific conditions. `L` = needs deliberate / unusual trigger. |
| **Status** | `🔴 Open` (no mitigation) · `🟡 Mitigated` (partial / planned) · `🟢 Resolved` (closed by code change) · `⚪ Accepted` (documented; no action planned) |

---

## Module coverage

| # | Module | Open Risks | Status |
|---|---|---|---|
| 1 | Auth & Session | 12 | 🔴 Reviewed |
| 2 | Multi-tenancy + Authorization | 10 | 🔴 Reviewed |
| 3 | Annual Goals workflow | TBD | ⏳ Pending |
| 4 | Annual Reviews workflow | TBD | ⏳ Pending |
| 5 | Project Reviews workflow | TBD | ⏳ Pending |
| 6 | Cycle / Time / Timezone logic | TBD | ⏳ Pending |
| 7 | Admin Panel — Users + Projects | TBD | ⏳ Pending |
| 8 | System Settings + Gate Flags | TBD | ⏳ Pending |
| 9 | Exports (Excel) | TBD | ⏳ Pending |
| 10 | Notifications | TBD | ⏳ Pending |
| 11 | Dashboard read paths | TBD | ⏳ Pending |
| 12 | Tables + pagination + caching | TBD | ⏳ Pending |
| 13 | Frontend state sync | TBD | ⏳ Pending |
| 14 | Schema evolution / migration safety | TBD | ⏳ Pending |

---

## Per-row format

Each module section uses this table:

| # | Risk | Trigger | Sev | Lik | Status | Mitigation |
|---|---|---|---|---|---|---|
| 1.1 | (one-sentence risk) | (concrete scenario that triggers it) | H/M/L | H/M/L | 🔴/🟡/🟢/⚪ | (one-line action item) |

Mitigation column is intentionally short — each is its own ticket if pursued.

---

## Module 1: Auth & Session

**Scope:** Login flow, JWT lifecycle, sliding refresh, password change, password reset (forgot-password), forced password change, CSRF, `CurrentUser` dependency, logout, multi-tab session sync.

**Key facts grounding the analysis:**
- Single JWT with 30-min sliding window (cookie's max-age rolls forward on every authenticated request via `dependencies.py:147-148`). No separate refresh token.
- JWT in `HttpOnly` cookie; CSRF token in a JS-readable cookie + body fallback for cross-origin.
- `must_change_password` enforced **frontend-only** — backend accepts all authenticated requests regardless.
- `is_deleted` is checked at login AND on every authenticated request (403 if true).
- Password reset: 32-byte random token, SHA-256 hash stored, 15-min TTL, single-use.
- Reset-token rate limit is **per-user** (3 active per hour), no per-IP limit.
- `clear` on logout: cookies deleted server-side, but **no JWT blacklist** — token valid until natural expiry.
- Frontend: no background sliding refresh; `/auth/session` called only on mount + manual `refreshSession()`.

### Risks

| # | Risk | Trigger | Sev | Lik | Status | Mitigation |
|---|---|---|---|---|---|---|
| 1.1 | No rate-limiting / lockout on `/auth/login` — credential stuffing can run unchecked | Attacker scripts login with email list + common-password list against the public endpoint | H | M | 🔴 | Per-IP + per-email throttle (e.g. 5 attempts / 5 min); fail2ban or WAF; CAPTCHA after N fails |
| 1.2 | `must_change_password` is enforced **frontend-only**; a user with the flag set can bypass the change-password screen by calling any API directly | Admin resets a user's password → user uses Postman / DevTools to call `/goals/`, `/annual-reviews/self`, etc. before changing | M | L | 🔴 | Add backend gate in `get_current_user`: if `must_change_password=true`, 403 every request EXCEPT `/users/me/password`, `/auth/logout`, `/auth/session` |
| 1.3 | Password change does NOT rotate the JWT — old token stays valid for up to 30 min after a "compromise" change | User suspects token theft, changes password; attacker's token still works until its 30-min `exp` | M | L | 🔴 | Add `password_changed_at` to users; in `get_current_user`, reject JWTs with `iat < password_changed_at`. Or set new cookie + JWT-revocation table |
| 1.4 | Logout doesn't invalidate the JWT server-side — a stolen cookie keeps working after the user "logs out" | XSS or shared-machine exfiltration of the `access_token` cookie value; victim logs out; attacker continues to use the cookie for ~30 min | M | L | 🔴 | Maintain a revocation table (jti or cookie hash); check in `get_current_user`. Alternative: short JWT TTL (~5 min) + refresh-token flow |
| 1.5 | localStorage stores session claims (incl. CSRF token for cross-origin) — any XSS reads them and can forge mutating requests | A reflected/stored XSS payload exfiltrates `localStorage["user"]` + `localStorage["csrf_token"]` | H | L | 🔴 | Audit for `dangerouslySetInnerHTML`, untrusted markdown, 3rd-party widgets. Move CSRF to an HttpOnly cookie + a custom server-reflected header that JS never touches |
| 1.6 | Cached `user` in localStorage drifts from backend state — role/feature changes don't take effect until manual refresh | Admin demotes a user's role mid-session; the cached `user.role` keeps unlocking UI surfaces until next page reload or auth-context refresh | M | M | 🔴 | Background `/auth/session` ping on tab focus / every N minutes; OR poll for the canonical role change via SSE/WebSocket |
| 1.7 | No frontend sliding-refresh — idle users hit 401 mid-action and lose in-flight work | User opens a long annual-review form, walks away 35 min, returns, hits Save → 401, redirected to login, draft lost | M | M | 🔴 | Background `/auth/session` ping every ~10 min while tab is visible; OR warn-before-expiry banner + grace-period extension on user action |
| 1.8 | Reset-token rate limit is per-user only — an attacker can enumerate emails via `/auth/forgot-password` response timing | Iterate email list against the endpoint; 429s for valid accounts (existing tokens), 204s for invalid; or measure response time | M | M | 🔴 | Per-IP rate limit on `/auth/forgot-password`; equalize response timing (always queue background work even for unknown emails); return 204 for both valid and invalid emails |
| 1.9 | `/auth/forgot-password` preemptively sets `must_change_password=true` before email delivery is confirmed — an attacker can soft-lock a victim | Attacker hits `/auth/forgot-password` with victim's email; victim's flag flips to true; email fails delivery / lands in spam; victim is stuck on the change-password screen until they actually reset | M | L | 🔴 | Only set `must_change_password` when the reset token is **consumed**, not when requested. Or set it on request but provide a clear UX path for the victim to escape (e.g. cancel-reset link) |
| 1.10 | No 2FA / MFA — single-factor auth means a phished password = full account access | Phishing campaign harvests credentials for an HR_MyOrg user; attacker has org-admin powers | H | M | 🔴 | TOTP-based 2FA, at minimum required for HR roles. Backup codes for recovery. WebAuthn (passkeys) as a stretch goal |
| 1.11 | No "your password was just reset" notification email — users can't detect unauthorized resets quickly | Attacker resets victim's password via a leaked reset link; victim only notices when they next try to log in | L | L | 🔴 | Send a confirmation email after `/auth/reset-password` succeeds, including IP / user-agent + a "this wasn't me?" link to a secondary recovery path |
| 1.12 | JWT secret is loaded from env — accidental .env commit forges every token | Developer accidentally commits .env containing `SECRET_KEY`; attacker mints arbitrary JWTs | H | L | 🟡 | Confirm .env is in .gitignore (likely already); add a pre-commit hook (gitleaks / detect-secrets); document secret-rotation runbook so a leak is recoverable without a forced re-issue of every cookie |

### Top 3 to schedule (engineering-effort prioritised)

1. **1.2 — Backend gate for `must_change_password`** — 20 lines of code; closes a real privilege-bypass; lowest effort highest value.
2. **1.1 — Login rate-limiting** — single dependency (e.g. `slowapi`) wired into the login route + forgot-password; closes the most plausible production attack.
3. **1.6 + 1.7 (paired) — Frontend session refresh on focus + visible-tab ping** — eliminates two UX pain points (stale role, lost-work-on-401) with one piece of work.

### Defer-and-document

- **1.10 (2FA)**, **1.4 (JWT revocation)**, **1.5 (XSS hardening)**, **1.11 (reset-confirm email)** — all real but bigger lifts and currently unblocked by lower-effort wins. Worth a "v2 hardening" tracker ticket each.

---

## Module 2: Multi-tenancy + Authorization

**Scope:** `org_id` filtering on every read/write, role-based route guards, ownership checks (Mentor→Mentee, PM→Project, Self→Goal/Review), `PROTECTED_USER_ROLES` mutation guards, fan-out boundaries (notifications, exports), public-read endpoints.

**Key facts grounding the analysis:**
- Single `org_id` tenant fence applied on every authenticated query (audited across `goal_routes`, `annual_review_routes`, `project_review_routes`, `mentee_routes`, `project_routes`, `admin_routes`, `dashboard_routes`, `export_routes`, `notification_routes`, `system_settings_routes`, `user_routes`).
- Role checks happen in route handlers (no central policy module) — each route imports `Role` enum and compares `current_user.role == Role.X.value`.
- `PROTECTED_USER_ROLES = {Mentor, HR_MyOrg}` blocks `HR_Miltenyi` mutation in `admin_routes.py:110-132`.
- `mentee_routes.py:337` Goal query filters by `mentee_id` only; the org fence is implicit via the user-mentee FK chain.
- `notification_routes.py:98` and `system_settings_routes.py:116,168` use hardcoded string role literals (`"HR_MyOrg"`) instead of `Role.HR_MYORG.value`.
- JWT carries the `role` claim, but `get_current_user` re-reads `User.role` from DB on every request — so the JWT role is decorative and stale-token-after-role-change is not exploitable for elevation.
- `system_settings` GET endpoint is public-read (no auth) — currently fine because only display flags live there; risk surface grows if sensitive keys are added.
- `notify_many` accepts a list of `user_id`s from callers without re-verifying every recipient shares the actor's `org_id`.

### Risks

| # | Risk | Trigger | Sev | Lik | Status | Mitigation |
|---|---|---|---|---|---|---|
| 2.1 | Implicit tenant fence via FK chain in `mentee_routes.py:337` — Goal query filters by `mentee_id` only and trusts the FK to be intra-org | A bug elsewhere (admin import, migration backfill, manual SQL fix) inserts a cross-org `mentee_id` reference; this endpoint silently returns the wrong-org Goal | H | L | 🔴 | Add explicit `Goal.org_id == current_user.org_id` to the filter clause. Cost: one line. Defense-in-depth even if the FK invariant holds today |
| 2.2 | Hardcoded role string literals (`"HR_MyOrg"` etc.) in `notification_routes.py:98` and `system_settings_routes.py:116,168` — bypasses the `Role` enum | Future rename refactor (like the recent `Staff→Employee`) silently misses these spots → guard returns `False` for legitimate users, or worse, matches nothing and grants access if the check is "not in list" style | M | M | 🔴 | Replace string literals with `Role.HR_MYORG.value`; add a grep-based CI check that flags string literals matching known role names |
| 2.3 | No automated test or lint rule enforces the `org_id` fence on new routes — human review is the only barrier | Developer adds a new endpoint, forgets `.filter(Model.org_id == current_user.org_id)`; PR review misses it; cross-org leak ships | H | M | 🔴 | Author a pytest fixture that hits every authenticated GET route with a 2-org seed and asserts no foreign-org row is returned. OR a SQLAlchemy event hook that warns on un-fenced queries in dev |
| 2.4 | JWT carries `role` claim that the backend ignores — schema implies the claim is authoritative, inviting future code that trusts it | A new endpoint or middleware reads `claims["role"]` for speed instead of `current_user.role`, granting stale elevated access after a demotion | M | L | 🔴 | Drop the `role` claim from the JWT entirely (backend already re-reads it). OR document loudly in `auth_routes.py` that JWT role is decorative |
| 2.5 | `GET /system-settings` is public-read (no auth) — currently only exposes display flags but risk grows as the table evolves | A future PR adds a sensitive key (e.g. `support_email`, internal feature toggle, beta cohort list) without realizing the endpoint is unauthenticated → world-readable | M | M | 🔴 | Require auth on the endpoint and split "public bootstrap flags" into a dedicated `/public/settings` allow-list. OR add a `is_public` column on `system_settings` rows and filter on the public route |
| 2.6 | `notify_many` fan-out doesn't re-verify every `user_id` shares the actor's `org_id` — trusts the caller's recipient list | An upstream bug (or a future feature like "notify all mentors of project X") feeds a cross-org `user_id` into the list; victim in another org receives the notification with sender context | M | L | 🔴 | In `notify_many`, batch-load the recipient users, filter to `org_id == actor.org_id`, log a warning if any were dropped. One query, no behavior change in the happy path |
| 2.7 | Role checks scattered across ~12 route files — adding a new role (e.g. `HR_External`, `ReadOnly_Auditor`) requires grepping every handler | PM adds `Auditor` role; engineer updates `admin_routes` and `user_routes` but misses `export_routes` and `dashboard_routes`; auditor can't see what they were supposed to see (M) or sees more than they should (H) | M | M | 🔴 | Extract a `policy.py` module: `can_view_user(actor, target)`, `can_export_employee_data(actor)`, etc. Each route calls one function; new role = update one file |
| 2.8 | Some routes check `org_id` *after* fetching the row — returns 404 for cross-org vs 404 for not-exists, but two-query timing differs | Attacker enumerates IDs and times responses; consistent timing gap reveals which IDs exist in *some* org | L | L | 🔴 | Combine fetch + org_id filter into one query (`db.query(X).filter(X.id == id, X.org_id == org_id).first()`). Already the pattern in most places; sweep the stragglers |
| 2.9 | Sub-resource creation routes (e.g. POST a Goal under a User) infer the parent's `org_id` from `current_user` rather than validating the parent's actual `org_id` | A `mentor_id` or `project_id` body field references a cross-org parent; the new child row is written with the actor's `org_id`, creating an orphaned/mis-tenanted row | M | L | 🔴 | On every sub-resource create, load the parent and assert `parent.org_id == current_user.org_id` before insert. Especially: Goal.mentor_id, ProjectReview.project_id, AnnualReview.user_id |
| 2.10 | Soft-deleted users (`is_deleted=true`) still own historical rows; joins through `users` without an `is_deleted` filter may surface ghost data | HR dashboard funnel counts include rows owned by deleted users → bloated numerators; exports include a deleted employee's reviews; mentor picker shows a deleted mentor | L | M | 🔴 | Audit every `JOIN users` in read paths for an `is_deleted == False` clause. Add a SQLAlchemy `with_loader_criteria` to apply globally where appropriate |

### Top 3 to schedule (engineering-effort prioritised)

1. **2.2 — Replace hardcoded role strings with `Role` enum constants** — 15-min fix across 3 known spots; lowest effort; prevents the next `Staff→Employee` rename from quietly breaking access checks.
2. **2.1 + 2.9 (paired) — Explicit `org_id` filter on FK-implicit queries + parent-org validation on sub-resource creates** — 1-2 hours; closes the two real defense-in-depth gaps before they become exploited.
3. **2.3 — Pytest fixture for the `org_id` fence** — half-day to author; catches every future regression at PR-time; cheapest insurance policy in this register.

### Defer-and-document

- **2.7 (policy module extraction)** — large refactor; worth doing only when the next new role is on the roadmap.
- **2.4 (drop JWT role claim)** — coordinate with any frontend code that reads the claim; otherwise low-priority since backend doesn't trust it.
- **2.5 (auth-gate `/system-settings`)** — fine as-is *today*; revisit the moment anyone proposes adding a non-public key to that table.

---

