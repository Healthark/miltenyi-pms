"""
Build docs/meetings/2026-05-25-notifications-decision-matrix.xlsx.

Matches the format of the existing review-window-decision-matrix.xlsx
exactly:
  - 5 sheets (one per module + Cross-cutting Policy)
  - 5 columns: #, Decision, Current Behavior, Assumption, Miltenyi's Answer
  - Header: bold white text on dark-blue (#1F4E79) background
  - Column widths A:6 / B:48 / C:45 / D:32 / E:32 (the D + E columns
    were 13 + 32 in the original but per-event audit rows need more
    room than policy rows; widened symmetrically to give Assumption
    space without crushing Miltenyi's Answer)
  - Wrap text on every body cell
  - Freeze pane at A2

Re-runnable. Overwrites the target file each time.
"""

from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


# ── Style constants — kept in lock-step with the review-window file ──
HEADER_FILL = PatternFill(start_color="FF1F4E79", end_color="FF1F4E79", fill_type="solid")
HEADER_FONT = Font(bold=True, color="FFFFFFFF")
WRAP_LEFT_TOP = Alignment(wrap_text=True, vertical="top", horizontal="left")
WRAP_CENTER_TOP = Alignment(wrap_text=True, vertical="top", horizontal="center")

HEADERS = ["#", "Decision", "Current Behavior", "Assumption", "Miltenyi's Answer"]
COL_WIDTHS = {"A": 6.0, "B": 48.0, "C": 45.0, "D": 32.0, "E": 32.0}


# Per-row payload type. Body columns only — the # column auto-fills
# from the sheet prefix + position.
Row = tuple[str, str, str]  # (decision, current_behavior, assumption)


# =====================================================================
# SHEET CONTENT
# =====================================================================
#
# Each sheet starts with OPEN POLICY questions (cross-cutting decisions
# the stakeholders should settle first), then a PER-EVENT AUDIT (one
# row per notify() call site in that module). Numbering is
# <sheet_no>.<row_no>.

# ── Sheet 1: Goal Notifications ──────────────────────────────────────
GOAL_NOTIFICATIONS: list[Row] = [
    # Open policy
    (
        "Should goal-related notifications fire on in-app, email, or both?",
        "Today: in-app fires on every event; email opt-in per-event (only "
        "mentor-assignment notifications fire email). The bell shows the "
        "in-app list; emails go via the SMTP relay when configured.",
        "In-app for all events. Email only on workflow-blocking events "
        "(goal submitted for approval, changes requested) so mentors and "
        "employees aren't waiting for someone who hasn't opened the app.",
    ),
    (
        "Do users need an opt-out / unsubscribe from goal emails?",
        "Today: no unsubscribe UI. SMTP simply doesn't fire if not "
        "configured org-wide. A user cannot mute individual categories.",
        "Add a per-user 'email me about my goals' toggle in Profile. "
        "In-app stays on always (it's a read-only feed, no spam pressure).",
    ),
    (
        "Should HR see a goal-events digest separately from individual "
        "alerts?",
        "Today: HR doesn't get individual goal alerts (Mentor handles the "
        "approval). The HR dashboard's stalled-goals widget is the only "
        "HR-side surface tracking goal lifecycle.",
        "Keep HR out of per-event alerts. Optional: weekly summary "
        "showing approval velocity + stalled count (future scope).",
    ),
    # Per-event audit — every notify() call site in goal_routes.py
    (
        "Event: Employee submits goal for mentor approval",
        "In-app: ✓  /  Email: ✗  /  Recipient: assigned mentor  /  "
        "Message: '{Employee name} submitted a goal for your approval.'",
        "Keep in-app. Add email (workflow-blocking — mentor needs to act).",
    ),
    (
        "Event: Mentor approves a single goal",
        "In-app: ✓  /  Email: ✗  /  Recipient: goal owner  /  "
        "Message: 'Your goal was approved.'",
        "Keep in-app. Email optional (good news, can wait for app visit).",
    ),
    (
        "Event: Mentor requests changes on a goal",
        "In-app: ✓  /  Email: ✗  /  Recipient: goal owner  /  "
        "Message: includes mentor's feedback inline.",
        "Keep in-app + add email (workflow-blocking — employee needs to "
        "revise and resubmit).",
    ),
    (
        "Event: Mentor bulk-approves goals",
        "In-app: ✓ (one per goal)  /  Email: ✗  /  Recipient: "
        "each goal owner  /  Message: 'Your goal was approved.'",
        "Keep in-app. Bulk-approve fires N notifications; consider "
        "collapsing into one summary per recipient ('3 of your goals "
        "were approved').",
    ),
    (
        "Event: Mentor notifies employee inline (free-text via Notify "
        "button on goal detail)",
        "In-app: ✓  /  Email: ✗  /  Recipient: goal owner  /  "
        "Message: mentor-typed text.",
        "Keep in-app. Add email opt-in so the mentor can choose to send "
        "the typed note as an email too.",
    ),
    (
        "Event: Employee submits H1 / H2 self-review on a goal",
        "In-app: ✓  /  Email: ✗  /  Recipient: assigned mentor  /  "
        "Message: '{Employee name} submitted a {H1|H2} self-review.'",
        "Keep in-app. Email optional — the mentor's review queue surfaces "
        "this when they next open the app.",
    ),
    (
        "Event: Mentor submits their H1 / H2 review on an employee's goal",
        "In-app: ✓  /  Email: ✗  /  Recipient: goal owner  /  "
        "Message: 'Your mentor submitted their {H1|H2} review.'",
        "Keep in-app. No email — the H1/H2 review is read-only feedback, "
        "not workflow-blocking for the employee.",
    ),
    (
        "POTENTIAL: Stalled-goal nudge (auto-remind mentor when a goal has "
        "been PENDING_APPROVAL for >N days)",
        "Today: HR sees a stalled-goals chase list on the dashboard but "
        "the mentor receives no auto-reminder.",
        "Add a daily cron at 9am org-tz that pushes one in-app + email "
        "to mentors with goals stalled ≥7 days. Configurable threshold.",
    ),
]

# ── Sheet 2: Annual Review Notifications ─────────────────────────────
ANNUAL_REVIEW_NOTIFICATIONS: list[Row] = [
    # Open policy
    (
        "Should annual-review events fire to multiple recipients (mentor "
        "+ HR_MyOrg) or just the direct owner?",
        "Today: each event has exactly one recipient (the mentor on "
        "submission, the employee on completion). HR_MyOrg sees the "
        "calibration grid but receives no per-event alert.",
        "Keep single-recipient default. Optional 'HR copy' org setting "
        "for events that transition status (self-submitted, mentor-eval "
        "done, management rating published).",
    ),
    (
        "Should the employee be notified when HR sets / overwrites the "
        "Management rating?",
        "Today: yes — in-app fires with 'Your final rating is now "
        "available' (first publish) or 'Your final rating was updated' "
        "(recalibration). A same-value re-save stays silent.",
        "Keep this. The per-row final_rating_enabled gate + the org-wide "
        "annual_review_final_rating_visible flag still control whether "
        "the employee can actually see the number.",
    ),
    (
        "Should HR be notified when every mentor has finished evaluations "
        "for a cycle (so they can begin calibration)?",
        "Today: no — HR has to check the calibration grid manually.",
        "Add a daily check: when 100% of active employees' reviews are "
        "in PENDING_MANAGEMENT state for the active FY, fire a one-time "
        "in-app + email to HR_MyOrg 'Calibration ready: all mentor "
        "evaluations are in.'",
    ),
    # Per-event audit
    (
        "Event: Employee submits annual self-appraisal",
        "In-app: ✓  /  Email: ✗  /  Recipient: assigned mentor  /  "
        "Message: '{Employee name} submitted their {FY26-27} self-"
        "appraisal.'",
        "Keep in-app + add email (year-end workflow — mentors need to "
        "be reminded to start their evaluations).",
    ),
    (
        "Event: Mentor submits annual evaluation",
        "In-app: ✓  /  Email: ✗  /  Recipient: employee  /  "
        "Message: 'Your mentor submitted their evaluation for {FY26-27}.'",
        "Keep in-app + add email (year-end milestone for the employee).",
    ),
    (
        "Event: HR_MyOrg publishes / updates the Management rating",
        "In-app: ✓  /  Email: ✗  /  Recipient: employee  /  "
        "Message: 'Your final rating is now available' OR 'Your final "
        "rating was updated.'",
        "Keep in-app + add email. This is the final compensation-adjacent "
        "event for the year and warrants a notification outside the app.",
    ),
]

# ── Sheet 3: Project Review Notifications ────────────────────────────
PROJECT_REVIEW_NOTIFICATIONS: list[Row] = [
    # Open policy
    (
        "Should PMs be auto-reminded as the cycle close approaches?",
        "Today: no reminders. The PM sees their queue in the app and "
        "must remember to file. HR sees a project-review completion card "
        "on the dashboard funnel.",
        "Add a cron-based reminder N days before cycle close (default 7) "
        "to PMs with any PENDING reviews on their team. In-app + email.",
    ),
    (
        "When the project assignment ends mid-cycle, should we notify the "
        "PM that the review window is shortened?",
        "Today: no auto-message. The assignment end-date silently "
        "shortens the PM's window on that team-member.",
        "Add an in-app alert to the PM: '{Employee} rolled off {Project}; "
        "complete their {cycle} review by FY end or skip.' Email "
        "optional.",
    ),
    (
        "Should the secondary evaluator be alerted independently when the "
        "PM submits their primary review?",
        "Today: yes — the secondary gets an in-app ping when the PM "
        "submits, prompting them to add the impact statement.",
        "Keep in-app. Add email opt-in for secondaries who don't open "
        "the app daily.",
    ),
    # Per-event audit
    (
        "Event: PM submits a project review",
        "In-app: ✓  /  Email: ✗  /  Recipient: the employee being "
        "reviewed  /  Message: 'Your PM submitted a project review for "
        "{project name}.'",
        "Keep in-app + add email (review visibility is important for the "
        "reviewee — keep them informed).",
    ),
    (
        "Event: Secondary evaluator adds impact statement",
        "In-app: ✓  /  Email: ✗  /  Recipient: the employee being "
        "reviewed  /  Message: 'A secondary evaluator added impact on "
        "your {project name} review.'",
        "Keep in-app. Email optional.",
    ),
    (
        "Event: PM EDITS a previously-submitted project review (status "
        "transitions back to draft → reviewed)",
        "In-app: ✓  /  Email: ✗  /  Recipient: the employee being "
        "reviewed  /  Message: 'Your PM updated their project review for "
        "{project name}.'",
        "Keep in-app. Email only if material rating change (1+ step on "
        "the 1–5 scale). Avoids edit-thrash spam.",
    ),
    (
        "Event: Project assigned with a secondary evaluator",
        "In-app: ✓  /  Email: ✗  /  Recipient: secondary  /  "
        "Message: assignment + project name.",
        "Keep in-app + add email (the secondary needs to know they're "
        "on a new project; they likely don't poll the app for this).",
    ),
    (
        "Event: Project's secondary evaluator changed",
        "Today: notify both old (\"you have been removed\") and new "
        "(\"you have been assigned\") secondaries. In-app only.",
        "Keep in-app + add email to the NEW secondary (so they know "
        "they're now on the hook).",
    ),
    (
        "Event: Project marked complete",
        "In-app: ✓  /  Email: ✗  /  Recipients: PM + all "
        "assigned employees + secondary (via notify_many).  /  "
        "Message: 'Project {name} has been marked complete.'",
        "Keep in-app for everyone. Email opt-in.",
    ),
    (
        "Event: Project member assignment ended (rolled off mid-project)",
        "In-app: ✓  /  Email: ✗  /  Recipient: the rolled-off "
        "employee + their PM  /  Message: assignment ended date.",
        "Keep in-app. Email optional.",
    ),
]

# ── Sheet 4: Admin & Account Notifications ───────────────────────────
ADMIN_ACCOUNT_NOTIFICATIONS: list[Row] = [
    # Open policy
    (
        "When HR_Miltenyi creates a user, should HR_MyOrg be informed "
        "(audit trail)?",
        "Today: no. The audit is in the User row's created_at + the "
        "creating user's ID isn't recorded as a column.",
        "Optional in-app digest to HR_MyOrg: 'N users created today by "
        "{HR_Miltenyi name}.' Daily cron. Not per-event.",
    ),
    (
        "Should a deactivated user receive any notification (the JWT is "
        "already blocked)?",
        "Today: no — the notify() service short-circuits writes to "
        "deactivated recipients (PR #60). The deactivated user cannot "
        "log in to see anything anyway.",
        "Keep current behavior. If HR reactivates the user, fire a "
        "'welcome back' in-app + email (already implemented).",
    ),
    (
        "Should the user's manager / mentor be notified when their direct "
        "report's profile changes (function / designation / etc.)?",
        "Today: no. Only mentor-assignment changes fire a notification.",
        "Skip for now — too chatty if a function/designation change "
        "fires N notifications per mentee under the same mentor.",
    ),
    # Per-event audit
    (
        "Event: New user account created by HR",
        "In-app: ✓  /  Email: ✓  (welcome email with temp "
        "password)  /  Recipient: the new user  /  In-app message: "
        "'Welcome to PMS — your account is ready.'",
        "Keep both. Critical onboarding event.",
    ),
    (
        "Event: User's mentor assigned / reassigned / unassigned",
        "In-app: ✓  /  Email: ✓  /  Recipients: the mentee + "
        "the new mentor (if any)  /  Message: includes new mentor name "
        "or unassignment notice.",
        "Keep both. Mentor relationship is foundational — user "
        "needs to know who reviews their work.",
    ),
    (
        "Event: User account reactivated",
        "In-app: ✓  /  Email: ✓  /  Recipient: the reactivated "
        "user  /  Message: 'Your account has been reactivated. You can "
        "sign in again.'",
        "Keep both.",
    ),
    (
        "Event: Password reset requested",
        "Email: ✓ (reset link, 15-min expiry)  /  In-app: ✗ "
        "(user is logged out)  /  Recipient: requesting user.",
        "Keep email-only. The user is locked out of the app when this "
        "fires; in-app is unreachable.",
    ),
    (
        "Event: Password changed (self-service)",
        "Today: no notification on success. The user clicks Change "
        "Password and the modal closes.",
        "Add a confirmation email (security: alerts the user if the "
        "change wasn't them). In-app banner on next login.",
    ),
    (
        "Event: must_change_password flag set by HR (forced reset)",
        "Today: in-app banner gates the app on next login. No email.",
        "Add an email so the user knows to expect the gate on next "
        "login: 'Your password was reset by HR. You'll be asked to "
        "choose a new one when you sign in.'",
    ),
]

# ── Sheet 5: Cross-cutting Policy ────────────────────────────────────
CROSS_CUTTING_POLICY: list[Row] = [
    (
        "Channel split: which categories of notification go to which "
        "channel by default?",
        "Today: every notify() call writes in-app. Email is opt-in per "
        "call (currently only mentor-assignment + welcome + password-"
        "reset + reactivation fire email).",
        "Default matrix:\n"
        "  • Workflow-blocking (approval requested, changes "
        "requested) → in-app + email\n"
        "  • Status updates (your review submitted) → in-app "
        "+ email opt-in\n"
        "  • Read-only feedback (your H1 review is in) → "
        "in-app only\n"
        "  • Security events (password reset, login from new "
        "device) → email mandatory",
    ),
    (
        "Email digest cadence: should low-priority notifications be "
        "batched into a daily / weekly digest?",
        "Today: every email is fire-and-forget at event time. No digest.",
        "Add an opt-in 'send me a daily digest at 9am' switch in Profile "
        "for non-blocking categories. Workflow-blocking emails fire "
        "immediately regardless.",
    ),
    (
        "Per-user notification preferences: where do they live?",
        "Today: no per-user preferences. Notifications fire to everyone.",
        "Add a Profile → Notifications tab with toggles per "
        "category (Goals / Annual Reviews / Project Reviews / Admin) "
        "and per channel (in-app on/off, email on/off, digest "
        "frequency).",
    ),
    (
        "Should HR be able to bcc themselves on every notification "
        "(observation mode)?",
        "Today: no. HR's only audit surface is the Notification table "
        "directly (no UI).",
        "Skip. Future: a 'Notification audit log' admin page that lists "
        "every fired notification across the org with filters.",
    ),
    (
        "Unsubscribe links in emails — required for compliance / nicety?",
        "Today: emails don't include unsubscribe footers.",
        "Add a one-click 'manage email preferences' link footer that "
        "deep-links to Profile → Notifications. Not a hard "
        "unsubscribe — keeps security emails mandatory.",
    ),
    (
        "Quiet hours: should emails respect a per-user quiet window "
        "(e.g. don't email between 8pm and 7am org-tz)?",
        "Today: emails fire immediately regardless of time.",
        "Add quiet hours to the per-user preferences in Profile. "
        "In-app notifications still fire (user reads on their schedule). "
        "Security emails ignore quiet hours.",
    ),
    (
        "POTENTIAL: Slack / MS Teams integration",
        "Today: not implemented.",
        "Future scope. Bind a Slack webhook to the user's profile; "
        "notify() learns a 'slack' channel alongside in-app/email. "
        "Most value for mentor approval queues + HR reminders.",
    ),
    (
        "POTENTIAL: Mobile push (PWA / native app)",
        "Today: not implemented. The app is web-only.",
        "Future scope. Lower priority — emails cover most cases "
        "until a mobile presence is justified by usage.",
    ),
    (
        "POTENTIAL: SMS for security-critical events (password reset, "
        "account locked)",
        "Today: not implemented. Email is the only out-of-app channel.",
        "Future scope. Tradeoff: SMS cost + carrier reliability "
        "vs. email's reach. Email + TOTP / passkeys may be enough.",
    ),
    (
        "How long are in-app notifications retained in the bell?",
        "Today: every notification persists forever in the Notification "
        "table. The bell shows the most recent 20 (notification_routes."
        "get_topbar_summary limit=20).",
        "Auto-archive read notifications older than 90 days "
        "(soft-delete on the table, kept for audit). Unread "
        "notifications never auto-archive.",
    ),
    (
        "When a sender is deactivated, do their historical notifications "
        "stay visible to recipients?",
        "Today: yes. The notify() writer short-circuits NEW writes to "
        "deactivated recipients, but existing rows from a now-"
        "deactivated sender remain in recipients' bells. Documented as "
        "intentional in notification_routes.get_topbar_summary.",
        "Keep current behavior. The notification represents a real "
        "past event; erasing it would erase audit history.",
    ),
    (
        "Notification audit / observability: where does HR see what fired?",
        "Today: HR has no UI to inspect the Notification table. They can "
        "only see what each user sees by logging in as them (not "
        "possible).",
        "Add an HR-only Notifications Audit page (Admin Panel) that "
        "filters notifications by module / recipient / date range. "
        "Read-only — no editing.",
    ),
]


SHEETS: list[tuple[str, int, list[Row]]] = [
    ("Goal Notifications", 1, GOAL_NOTIFICATIONS),
    ("Annual Review Notifications", 2, ANNUAL_REVIEW_NOTIFICATIONS),
    ("Project Review Notifications", 3, PROJECT_REVIEW_NOTIFICATIONS),
    ("Admin & Account Notifications", 4, ADMIN_ACCOUNT_NOTIFICATIONS),
    ("Cross-cutting Policy", 5, CROSS_CUTTING_POLICY),
]


# =====================================================================
# RENDERER
# =====================================================================

def build_sheet(wb: Workbook, name: str, sheet_no: int, rows: list[Row]) -> None:
    """Render one sheet with the standard header + body."""
    ws = wb.create_sheet(title=name)

    # Header row
    for col_idx, header in enumerate(HEADERS, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = WRAP_CENTER_TOP

    # Column widths
    for col_letter, width in COL_WIDTHS.items():
        ws.column_dimensions[col_letter].width = width

    # Body
    for row_idx, (decision, current, assumption) in enumerate(rows, start=2):
        ws.cell(row=row_idx, column=1, value=f"{sheet_no}.{row_idx - 1}").alignment = WRAP_CENTER_TOP
        ws.cell(row=row_idx, column=2, value=decision).alignment = WRAP_LEFT_TOP
        ws.cell(row=row_idx, column=3, value=current).alignment = WRAP_LEFT_TOP
        ws.cell(row=row_idx, column=4, value=assumption).alignment = WRAP_LEFT_TOP
        # Column 5 left blank for Miltenyi's Answer
        ws.cell(row=row_idx, column=5, value="").alignment = WRAP_LEFT_TOP

    # Freeze header
    ws.freeze_panes = "A2"


def main() -> None:
    wb = Workbook()
    # openpyxl creates a default "Sheet" — remove before adding ours
    default = wb.active
    wb.remove(default)

    for name, sheet_no, rows in SHEETS:
        build_sheet(wb, name, sheet_no, rows)

    out = Path(__file__).resolve().parent.parent / "docs" / "meetings" / "2026-05-25-notifications-decision-matrix.xlsx"
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    total_rows = sum(len(r) for _, _, r in SHEETS)
    print(f"Wrote {out}")
    print(f"Sheets: {len(SHEETS)}  /  Total decision rows: {total_rows}")


if __name__ == "__main__":
    main()
