/**
 * NotifyTab — Admin "Notify" surface (26 Sep 2026, annual-parity part 3).
 *
 * Sends a manual, targeted announcement (in-app, email or both) to a group of
 * users. Recipients are narrowed by AND-combined filters — specific users,
 * roles and functions — with a live recipient count; no filter means every
 * active user. The sender never receives their own announcement.
 *
 * The message is authored in the shared Markdown subset (RichTextEditor), so
 * bold / italic / lists render identically in the bell (RichText) and in the
 * email (backend markdown_to_html). Quick presets pre-fill subject and body;
 * both stay fully editable.
 *
 * Below the composer sits the **Daily summary emails** card: the in-process
 * job's schedule, SMTP state, last run, and a "send now" button (idempotent
 * per person per day — see backend/app/services/daily_digests.py).
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock, Mail, Megaphone, Send, Shield, UserPlus, Users2, X } from "lucide-react";
import {
  adminService,
  type AdminNotifyPayload,
  type NotifyChannel,
  type UserResponse,
} from "@/services/admin.service";
import { queryKeys } from "@/lib/queryKeys";
import { UserCombobox } from "@/components/common/UserCombobox";
import { RichText, stripMarkdown } from "@/components/common/RichText";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { useConfirm } from "@/hooks/useConfirm";
import { getErrorMessage } from "@/utils/errors";

interface NotifyTabProps {
  /** The org's users, already loaded by the Admin Panel. */
  readonly users: readonly UserResponse[];
}

const PRESETS: { key: string; label: string; subject: string; body: string; roles?: string[] }[] = [
  {
    key: "quarter_self_reviews",
    label: "Quarter self-reviews due",
    subject: "Your Project Goals self-review for this quarter is due",
    body:
      "The self-review for the current quarter is open on the **Project Goals** page.\n" +
      "- Write what you delivered against each goal\n" +
      "- Give one overall rating\n" +
      "- Submit before the quarter closes",
    roles: ["Staff"],
  },
  {
    key: "annual_goals_open",
    label: "Annual goals open",
    subject: "Annual goal entry is open",
    body:
      "Please create and submit your **annual goals** for the new year from the Annual Goals page. " +
      "Your mentor will review and approve them.",
    roles: ["Staff"],
  },
  {
    key: "mentor_reviews",
    label: "Reviews waiting on mentors",
    subject: "Reviews are waiting for you",
    body:
      "Some of your mentees' self-reviews are waiting for your review.\n" +
      "1. Team Goals — approve pending goals and enter the H1/H2 review\n" +
      "2. Project Goals — enter the Miltenyi review for the current quarter",
    roles: ["Mentor"],
  },
];

const ROLES = ["Staff", "Mentor", "Admin"] as const;

const CHANNELS: { value: NotifyChannel; label: string }[] = [
  { value: "both", label: "In-app + email" },
  { value: "in_app", label: "In-app only" },
  { value: "email", label: "Email only" },
];

// Length guidance (soft — the counter warns but never blocks sending).
const SUBJECT_MAX = 200;
const BODY_MAX = 4000;
const IN_APP_SOFT_LIMIT = 300;

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function NotifyTab({ users }: NotifyTabProps) {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const { user: me } = useAuth();

  const functionsQuery = useQuery({
    queryKey: queryKeys.admin.functions(),
    queryFn: adminService.getFunctions,
  });
  const functions = functionsQuery.data ?? [];

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [userIds, setUserIds] = useState<number[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [functionIds, setFunctionIds] = useState<number[]>([]);
  const [channel, setChannel] = useState<NotifyChannel>("both");
  const [showPreview, setShowPreview] = useState(false);

  const send = useMutation({
    mutationFn: (payload: AdminNotifyPayload) => adminService.sendNotify(payload),
  });

  const applyPreset = (key: string) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    setSubject(preset.subject);
    setBody(preset.body);
    if (preset.roles) setRoles(preset.roles);
  };

  const activeUsers = useMemo(() => users.filter((u) => !u.is_deleted), [users]);

  // Live recipient preview — mirrors the backend notify_audience() filter
  // (active users, AND-combined specific-users / roles / functions, sender out).
  const recipients = useMemo(
    () =>
      activeUsers.filter((u) => {
        if (me && u.id === me.user_id) return false;
        if (userIds.length > 0 && !userIds.includes(u.id)) return false;
        if (roles.length > 0 && !roles.includes(u.role)) return false;
        if (functionIds.length > 0 && !(u.function_id != null && functionIds.includes(u.function_id))) return false;
        return true;
      }),
    [activeUsers, me, userIds, roles, functionIds],
  );
  const recipientCount = recipients.length;

  const selectedUsers = useMemo(
    () => userIds.map((id) => users.find((u) => u.id === id)).filter((u): u is UserResponse => u != null),
    [userIds, users],
  );

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (userIds.length > 0) parts.push(`${userIds.length} named user${userIds.length === 1 ? "" : "s"}`);
    if (roles.length > 0) parts.push(roles.join(" / "));
    if (functionIds.length > 0) parts.push(`${functionIds.length} function${functionIds.length === 1 ? "" : "s"}`);
    return parts.length > 0 ? parts.join(" · ") : "everyone";
  }, [userIds, roles, functionIds]);

  const plainBody = stripMarkdown(body);
  const writesInApp = channel !== "email";
  const overSoftLimit = writesInApp && plainBody.length > IN_APP_SOFT_LIMIT;
  const hasContent = subject.trim().length > 0 && body.trim().length > 0;
  const canSend = hasContent && recipientCount > 0 && !send.isPending;

  const channelPhrase: Record<NotifyChannel, string> = {
    email: "email",
    in_app: "notify in-app",
    both: "notify in-app and by email",
  };

  const handleSend = async () => {
    if (!canSend) return;
    const ok = await confirm({
      title: "Send announcement?",
      message: `This will ${channelPhrase[channel]} ${recipientCount} ${recipientCount === 1 ? "person" : "people"} (${filterSummary}). It cannot be recalled once sent.`,
      variant: "warning",
      confirmText: "Send",
    });
    if (!ok) return;
    try {
      const result = await send.mutateAsync({
        subject: subject.trim(),
        body: body.trim(),
        user_ids: userIds,
        roles,
        function_ids: functionIds,
        channel,
      });
      const emailNote =
        channel === "in_app" ? "" : result.emailed ? " Emails are on their way." : " Email is not configured on this server, so only the in-app notice went out.";
      toast.success(`Announcement sent to ${result.recipients} ${result.recipients === 1 ? "person" : "people"}.${emailNote}`);
      setSubject("");
      setBody("");
      setShowPreview(false);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const inputCls =
    "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
  const chipCls = (selected: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
      selected ? "border-brand bg-brand text-white" : "border-border text-text-main hover:bg-slate-50"
    }`;
  const sectionLabel = "mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-text-muted";

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-brand" aria-hidden="true" />
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">Send an announcement</h2>
          <p className="text-xs text-text-muted">
            A targeted notice for staff, mentors or named people. It lands in their notification bell and, if you choose, in their inbox.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Message composer ── */}
        <div className="space-y-5">
          <div>
            <p className={sectionLabel}>Quick presets</p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.key)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-main transition-colors hover:bg-slate-50"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="notify-subject" className="mb-1 block text-xs font-semibold text-text-main">
              Subject *
            </label>
            <input
              id="notify-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={SUBJECT_MAX}
              placeholder="e.g. Q3 self-reviews close on Friday"
              className={inputCls}
            />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="notify-body" className="text-xs font-semibold text-text-main">
                Message *
              </label>
              <button
                type="button"
                onClick={() => setShowPreview((v) => !v)}
                className="text-[11px] font-medium text-brand hover:underline"
              >
                {showPreview ? "Hide preview" : "Preview"}
              </button>
            </div>
            <RichTextEditor
              id="notify-body"
              rows={8}
              value={body}
              onChange={setBody}
              maxLength={BODY_MAX}
              placeholder="What do you want to tell them?"
            />
            <p className="mt-1 text-xs text-text-muted">
              Select text and use the toolbar, or press Ctrl+B / Ctrl+I. Formatting shows in the bell and in the email.
            </p>
            <p className={`mt-1 text-[11px] ${overSoftLimit ? "font-semibold text-red-600" : "text-text-muted"}`} aria-live="polite">
              {writesInApp
                ? `${plainBody.length}/${IN_APP_SOFT_LIMIT} characters — keep in-app notices short${overSoftLimit ? " (over the recommended length)" : ""}`
                : `${plainBody.trim() ? plainBody.trim().split(/\s+/).length : 0} words`}
            </p>
            {showPreview && (
              <div className="mt-3 rounded-lg border border-border bg-surface px-4 py-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">How it will read</p>
                {hasContent ? (
                  <div className="text-sm text-text-main">
                    <p className="font-semibold">{subject}</p>
                    <RichText value={body} variant="cell" className="mt-1 text-text-main" />
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">Add a subject and a message to preview them.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Recipients ── */}
        <div>
          <div className="space-y-4 rounded-xl border border-border bg-slate-50/50 p-4">
            <div className="flex items-center gap-2">
              <Users2 className="h-4 w-4 text-brand" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-text-main">Recipients</h3>
            </div>

            <div>
              <p className={sectionLabel}>
                <Shield className="h-3.5 w-3.5" aria-hidden="true" /> Roles
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={roles.includes(r)}
                    onClick={() => setRoles((prev) => toggle(prev, r))}
                    className={chipCls(roles.includes(r))}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className={sectionLabel}>
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" /> Functions
              </p>
              {functions.length === 0 ? (
                <p className="text-xs text-text-muted">{functionsQuery.isPending ? "Loading…" : "No functions set up."}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {functions.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={functionIds.includes(f.id)}
                      onClick={() => setFunctionIds((prev) => toggle(prev, f.id))}
                      className={chipCls(functionIds.includes(f.id))}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className={sectionLabel}>
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" /> Specific people
              </p>
              <UserCombobox
                users={activeUsers}
                value={null}
                onChange={(id) => {
                  if (id != null) setUserIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
                }}
                label=""
                placeholder="Search by name or email…"
                excludeIds={userIds}
              />
              {selectedUsers.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedUsers.map((u) => (
                    <span
                      key={u.id}
                      className="inline-flex items-center gap-1 rounded-full border border-brand bg-brand-light px-2.5 py-1 text-xs font-medium text-brand"
                    >
                      {u.full_name}
                      <button
                        type="button"
                        onClick={() => setUserIds((prev) => prev.filter((x) => x !== u.id))}
                        className="rounded-full p-0.5 hover:bg-brand/20"
                        aria-label={`Remove ${u.full_name}`}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-text-muted">
                Filters combine: a named person is only included if they also match the selected roles and functions.
              </p>
            </div>

            <div className="border-t border-border pt-3">
              <p className={sectionLabel}>Channel</p>
              <div role="radiogroup" aria-label="Delivery channel" className="flex overflow-hidden rounded-lg border border-border">
                {CHANNELS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={channel === c.value}
                    onClick={() => setChannel(c.value)}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium transition-colors ${
                      channel === c.value ? "bg-brand text-white" : "bg-white text-text-main hover:bg-slate-50"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-white px-3 py-2 text-xs text-text-muted">
              Sending to <span className="font-semibold text-text-main">{recipientCount} {recipientCount === 1 ? "person" : "people"}</span> ({filterSummary}).
              {" "}You are not included.
              {recipientCount === 0 && (
                <span className="block mt-1 text-amber-700">Nobody matches these filters.</span>
              )}
            </div>

            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {send.isPending ? "Sending…" : "Send announcement"}
            </button>
          </div>
        </div>
      </div>

      <DigestCard />
    </div>
  );
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Daily summary emails — status of the in-process job and a "send now". */
function DigestCard() {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: queryKeys.admin.digestStatus(), queryFn: adminService.getDigestStatus });
  const run = useMutation({
    mutationFn: adminService.runDigests,
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.digestStatus() });
      if (r.skipped_no_smtp) {
        snackbar.error("Email is not configured on this server, so no summaries were sent.");
        return;
      }
      const skipped = r.skipped_already_sent ? ` ${r.skipped_already_sent} already had today's summary.` : "";
      toast.success(`Summaries sent: ${r.mentor} to mentors, ${r.staff} to staff.${skipped}`);
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
  });
  const st = status.data;

  const handleRun = async () => {
    const ok = await confirm({
      title: "Send today's summaries now?",
      message: "Every mentor with pending approvals or reviews, and every staff member waiting on something or with a fresh approval, gets one email. Anyone who already had today's summary is skipped.",
      variant: "warning",
      confirmText: "Send now",
    });
    if (ok) run.mutate();
  };

  const chip = (ok: boolean, yes: string, no: string) => (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
      {ok ? yes : no}
    </span>
  );

  return (
    <div className="mt-8 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Mail className="mt-0.5 h-5 w-5 text-brand" aria-hidden="true" />
          <div>
            <h3 className="font-display text-base font-semibold text-text-main">Daily summary emails</h3>
            <p className="mt-0.5 max-w-2xl text-xs text-text-muted">
              One email per person per weekday morning, only when something is pending. Mentors get the approvals and reviews they owe (annual goals, H1/H2 goal reviews, Project Goals sets and quarterly reviews), grouped by mentee. Staff get what is waiting on their mentor, goals sent back, goals approved since their last summary and quarterly reviews to acknowledge. The bell is unchanged.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={run.isPending || !st}
          className="flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 disabled:opacity-60"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {run.isPending ? "Sending…" : "Send today's summaries now"}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-text-muted">
        {status.isPending && <span>Loading…</span>}
        {st && (
          <>
            {chip(st.email_configured, "Email configured", "Email not configured — nothing is sent")}
            {chip(st.enabled && st.running, "Scheduler running", st.enabled ? "Scheduler not running" : "Scheduler off (DIGEST_ENABLED=false)")}
            <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" /> {st.schedule}</span>
            <span>Next run: <b className="text-text-main">{fmtWhen(st.next_run_at)}</b></span>
            <span>Last run: <b className="text-text-main">{fmtWhen(st.last_run_at)}</b></span>
            <span>Sent today: <b className="text-text-main">{st.sent_today}</b></span>
          </>
        )}
      </div>
    </div>
  );
}
