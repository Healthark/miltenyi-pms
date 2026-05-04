/**
 * BulkApproveModal — multi-select approve dialog for the mentor.
 *
 * Lists every team goal currently in `pending_approval` or
 * `changes_requested`, grouped by mentee. Mentors can:
 *   - tick individual goals,
 *   - tick a whole mentee (selects only their *pending_approval* goals),
 *   - tick the global "Select All" (same rule, across all mentees).
 *
 * `changes_requested` goals are shown for context but their checkbox is
 * disabled with an "Awaiting revision" tag — feedback was already sent;
 * the mentee owns the next move.
 *
 * Submit POSTs `goal_ids` to /goals/bulk-approve and returns a per-goal
 * result so the UI can show "approved 8 of 10" when goals slip state.
 */

import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Check,
  Loader2,
  ChevronDown,
  UserCircle,
  AlertTriangle,
} from "lucide-react";
import type { TeamGoal } from "../../services/goal.service";
import { formatFyYearSpan } from "../../utils/fy";

interface BulkApproveModalProps {
  readonly isOpen: boolean;
  readonly goals: TeamGoal[];
  readonly onClose: () => void;
  /** Returns the count actually approved on success. The parent decides how
   *  to surface partial-success failure rows (snackbar / toast). */
  readonly onSubmit: (goalIds: number[]) => Promise<void>;
  readonly isSaving: boolean;
  readonly error: string;
}

interface MenteeGroup {
  ownerName: string;
  pendingGoals: TeamGoal[];        // pending_approval — actionable
  awaitingRevisionGoals: TeamGoal[]; // changes_requested — disabled, shown for context
}

function groupByMentee(goals: TeamGoal[]): MenteeGroup[] {
  const buckets = new Map<string, MenteeGroup>();
  for (const g of goals) {
    if (
      g.approval_status !== "pending_approval" &&
      g.approval_status !== "changes_requested"
    ) {
      continue;
    }
    const key = g.owner_name ?? "—";
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { ownerName: key, pendingGoals: [], awaitingRevisionGoals: [] };
      buckets.set(key, bucket);
    }
    if (g.approval_status === "pending_approval") {
      bucket.pendingGoals.push(g);
    } else {
      bucket.awaitingRevisionGoals.push(g);
    }
  }
  return Array.from(buckets.values()).sort((a, b) =>
    a.ownerName.localeCompare(b.ownerName),
  );
}

export function BulkApproveModal({
  isOpen,
  goals,
  onClose,
  onSubmit,
  isSaving,
  error,
}: BulkApproveModalProps) {
  const groups = useMemo(() => groupByMentee(goals), [goals]);
  const allPendingIds = useMemo(
    () => groups.flatMap((g) => g.pendingGoals.map((p) => p.id)),
    [groups],
  );

  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  // Mentee groups are expanded by default — mentor wants to see what
  // they're approving. Tapping the chevron collapses to just the header.
  const [collapsedMentees, setCollapsedMentees] = useState<Set<string>>(
    () => new Set(),
  );

  // Reset selection whenever the modal opens; the underlying goals list
  // may have shifted while the modal was closed.
  useEffect(() => {
    if (isOpen) {
      setSelected(new Set());
      setCollapsedMentees(new Set());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const toggleGoal = (goalId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  };

  const toggleMentee = (group: MenteeGroup) => {
    const ids = group.pendingGoals.map((g) => g.id);
    if (ids.length === 0) return;
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleCollapse = (ownerName: string) => {
    setCollapsedMentees((prev) => {
      const next = new Set(prev);
      if (next.has(ownerName)) next.delete(ownerName);
      else next.add(ownerName);
      return next;
    });
  };

  const allSelected =
    allPendingIds.length > 0 && allPendingIds.every((id) => selected.has(id));
  const noneSelected = selected.size === 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allPendingIds));
    }
  };

  const handleSubmit = async () => {
    if (selected.size === 0) return;
    await onSubmit(Array.from(selected));
  };

  const totalPending = allPendingIds.length;
  const totalAwaiting = groups.reduce(
    (sum, g) => sum + g.awaitingRevisionGoals.length,
    0,
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-approve-title"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2
              id="bulk-approve-title"
              className="font-display text-base font-semibold text-text-main"
            >
              Bulk Approve Goals
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {totalPending} pending approval
              {totalAwaiting > 0 && ` · ${totalAwaiting} awaiting revision`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-100 transition-colors"
            aria-label="Close bulk approve"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 flex-1">
          {error && (
            <p className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Check className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
              <p className="font-display text-sm font-medium text-text-main">
                Nothing waiting for approval
              </p>
              <p className="mt-1 text-xs text-text-muted">
                None of your mentees have goals pending approval right now.
              </p>
            </div>
          ) : (
            <>
              {/* Global Select All */}
              {totalPending > 0 && (
                <label className="flex items-center gap-2 px-3 py-2 mb-2 rounded-lg border border-border bg-slate-50/50 cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                  />
                  <span className="text-sm font-semibold text-text-main">
                    Select all ({totalPending})
                  </span>
                </label>
              )}

              {/* Mentee groups */}
              <div className="space-y-2">
                {groups.map((group) => {
                  const collapsed = collapsedMentees.has(group.ownerName);
                  const menteeIds = group.pendingGoals.map((g) => g.id);
                  const menteeAllSelected =
                    menteeIds.length > 0 &&
                    menteeIds.every((id) => selected.has(id));
                  const menteeSomeSelected =
                    menteeIds.some((id) => selected.has(id));
                  const menteeDisabled = group.pendingGoals.length === 0;
                  const menteeDisabledReason = menteeDisabled
                    ? "Awaiting revisions on all goals"
                    : null;

                  return (
                    <div
                      key={group.ownerName}
                      className="rounded-lg border border-border bg-surface overflow-hidden"
                    >
                      {/* Mentee header row */}
                      <div
                        className={`flex items-center gap-2 px-3 py-2 ${
                          menteeDisabled ? "bg-slate-50/60" : "bg-slate-50/30"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={menteeAllSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = !menteeAllSelected && menteeSomeSelected;
                          }}
                          onChange={() => toggleMentee(group)}
                          disabled={menteeDisabled}
                          className="h-4 w-4 rounded border-border text-brand focus:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                          title={menteeDisabledReason ?? undefined}
                        />
                        <UserCircle className="h-4 w-4 text-text-muted shrink-0" />
                        <span className="text-sm font-semibold text-text-main flex-1 truncate">
                          {group.ownerName}
                        </span>
                        <span className="text-[11px] text-text-muted">
                          {menteeDisabled
                            ? menteeDisabledReason
                            : `${group.pendingGoals.length} pending${
                                group.awaitingRevisionGoals.length > 0
                                  ? ` · ${group.awaitingRevisionGoals.length} awaiting revision`
                                  : ""
                              }`}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleCollapse(group.ownerName)}
                          className="rounded-md p-1 text-text-muted hover:bg-slate-100"
                          aria-label={collapsed ? "Expand goals" : "Collapse goals"}
                          aria-expanded={!collapsed}
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${
                              collapsed ? "" : "rotate-180"
                            }`}
                          />
                        </button>
                      </div>

                      {/* Goal rows */}
                      {!collapsed && (
                        <ul className="divide-y divide-border/60">
                          {group.pendingGoals.map((goal) => (
                            <li
                              key={goal.id}
                              className="flex items-start gap-2 px-3 py-2 hover:bg-brand/5"
                            >
                              <input
                                id={`bulk-goal-${goal.id}`}
                                type="checkbox"
                                checked={selected.has(goal.id)}
                                onChange={() => toggleGoal(goal.id)}
                                className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand"
                              />
                              <label
                                htmlFor={`bulk-goal-${goal.id}`}
                                className="flex-1 min-w-0 cursor-pointer"
                              >
                                <p className="text-sm text-text-main line-clamp-1">
                                  {goal.title}
                                </p>
                                {goal.fy_year && (
                                  <p className="text-[11px] text-text-muted">
                                    {formatFyYearSpan(goal.fy_year)}
                                  </p>
                                )}
                              </label>
                            </li>
                          ))}
                          {group.awaitingRevisionGoals.map((goal) => (
                            <li
                              key={goal.id}
                              className="flex items-start gap-2 px-3 py-2 opacity-70"
                              title="Feedback already sent — awaiting the mentee's revision"
                            >
                              <input
                                type="checkbox"
                                disabled
                                className="mt-0.5 h-4 w-4 rounded border-border disabled:cursor-not-allowed"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-text-main line-clamp-1">
                                  {goal.title}
                                </p>
                                <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  Awaiting revision
                                </p>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <p className="text-xs text-text-muted">
            {selected.size > 0
              ? `${selected.size} goal${selected.size === 1 ? "" : "s"} selected`
              : "Pick goals to approve"}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSaving || noneSelected}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4" aria-hidden="true" />
              )}
              {isSaving
                ? "Approving…"
                : `Approve ${selected.size > 0 ? selected.size : ""}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
