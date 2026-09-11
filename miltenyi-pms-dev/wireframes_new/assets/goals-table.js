/* goals-table.js — the single Project Goals table.

   One table per employee per period. Rows are the framework KPIs; columns are
   KPI · Goal · Self review · PM review. The framework paragraphs sit in a band
   above the table. Cells are edited inline; which column is editable depends
   on the viewer's role and the goal set's stage:

     employee  · draft         → Goal column
     employee  · approved      → Self review column (window open)
     reviewer  · approved /
                 self_reviewed → PM review column (entered on behalf)
     everyone else             → read-only

   A footer row carries the self rating (self-review column) and the final
   rating (PM review column). No per-KPI ratings. */
window.renderGoalsTable = function (opts) {
  const role = opts.role || "employee";
  const { state, esc, icon, badge, weightChip, stageStrip, counter, ratingBadge, cls } = PMS;
  const p = PMS.persona();
  const f = PMS.framework();
  const st = state.stage;
  const at = PMS.atLeast;

  const editGoal = role === "employee" && st === "draft";
  const editSelf = role === "employee" && st === "approved";
  const editPM = role === "reviewer" && (st === "approved" || st === "self_reviewed");
  const selfDone = at("self_reviewed");
  const reviewed = st === "reviewed";
  const TH = cls.TH;

  /* ── Header band: framework text ───────────────────────────────── */
  const trialChips = p.trials.map((t) => `<span class="inline-flex items-center rounded-full border border-border bg-white px-2 py-0.5 text-[11px] font-medium text-text-main">${esc(t)}</span>`).join("");
  const frameworkBand = `
<section class="rounded-xl border border-blue-100 bg-blue-50 p-5" aria-label="Framework">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex items-start gap-2.5">
      ${icon("book-open", "h-4 w-4 mt-1 shrink-0 text-blue-600")}
      <div>
        <p class="text-[11px] font-bold uppercase tracking-wider text-blue-700">Framework · ${esc(f.period)}</p>
        <h2 class="font-display text-base font-semibold text-text-main">${esc(f.title)} <span class="font-normal text-text-muted">· ${esc(f.functionName)} · level ${f.level} of 4</span></h2>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-1.5"><span class="mr-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">Trials</span>${trialChips}</div>
  </div>
  <div class="mt-4 grid gap-4 md:grid-cols-2">
    <div><p class="mb-1 text-[11px] font-bold uppercase tracking-wider text-blue-700">Business &amp; strategic outcomes</p><p class="text-[13px] leading-relaxed text-blue-900">${esc(f.outcomes)}</p></div>
    <div><p class="mb-1 text-[11px] font-bold uppercase tracking-wider text-blue-700">Functional / operational excellence goals</p><p class="text-[13px] leading-relaxed text-blue-900">${esc(f.functional)}</p></div>
  </div>
</section>`;

  /* ── Provenance band (reviewer) ────────────────────────────────── */
  const locked = reviewed;
  const provenance = role === "reviewer" && (editPM || reviewed) ? `
<section class="rounded-lg border border-border bg-slate-50 p-4">
  <div class="mb-3 flex flex-wrap items-center gap-2"><span class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Entered on behalf</span><p class="text-xs text-text-muted">Stored with the review and shown to the employee.</p></div>
  <div class="grid gap-4 md:grid-cols-4">
    <label class="block"><span class="mb-1 block text-xs font-semibold text-text-main">Miltenyi reviewer</span><input ${locked ? "disabled" : ""} value="${esc(p.miltenyiReviewer)}" class="${cls.INPUT} disabled:bg-slate-50 disabled:text-text-muted"><span class="mt-0.5 block text-[11px] text-text-muted">${esc(p.miltenyiReviewerRole)}</span></label>
    <label class="block"><span class="mb-1 block text-xs font-semibold text-text-main">Input received on</span><input type="date" ${locked ? "disabled" : ""} value="2027-01-19" class="${cls.INPUT} disabled:bg-slate-50 disabled:text-text-muted"></label>
    <div><span class="mb-1 block text-xs font-semibold text-text-main">Source</span><div class="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text-main">${icon("paperclip", "h-3.5 w-3.5 shrink-0 text-text-muted")}<span class="truncate">${esc(p.miltenyiReviewer.split(" ").pop().toLowerCase())}-cy2026-review.eml</span></div></div>
    <div><span class="mb-1 block text-xs font-semibold text-text-main">Entered by</span><div class="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text-main"><span class="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white">${PMS.initials(p.reviewerOfRecord)}</span>${esc(p.reviewerOfRecord)} · Mentor, Healthark</div><span class="mt-0.5 block text-[11px] text-text-muted">${locked ? esc(p.dates.reviewed) : "now"}</span></div>
  </div>
</section>` : "";

  /* ── Stage notice ──────────────────────────────────────────────── */
  const note = (tone, ic, html) => {
    const tones = {
      info: "border-blue-100 bg-blue-50 text-text-main", blue: "border-blue-100 bg-blue-50 text-blue-800",
      green: "border-emerald-200 bg-emerald-100 text-emerald-700", teal: "border-teal-200 bg-teal-100 text-teal-700",
      violet: "border-violet-200 bg-violet-100 text-violet-700", amber: "border-amber-200 bg-amber-50 text-amber-800",
    };
    return `<div class="flex items-start gap-2 rounded-lg border px-4 py-2.5 text-[13px] ${tones[tone]}">${icon(ic, "mt-0.5 h-4 w-4 shrink-0")}<div>${html}</div></div>`;
  };
  let notice = "";
  if (role === "employee") {
    notice = {
      draft: note("info", "book-open", `Write one goal in each row. Agree the wording with ${esc(p.miltenyiReviewer)} first; submitting records what was agreed, it does not start an approval round.`),
      submitted: note("blue", "clock", `<b>Submitted on ${esc(p.dates.submitted)}.</b> Read-only while ${esc(p.reviewerOfRecord)} records the approval agreed with ${esc(p.miltenyiReviewer)}.`),
      approved: note("green", "lock", `<b>Approved (agreed offline)</b>, recorded by ${esc(p.reviewerOfRecord)} on ${esc(p.dates.approved)}. Goals are locked. The self-review column is open for CY 2026. <span class="wf-tag">window opens 1 Jan 2027</span>`),
      self_reviewed: note("teal", "check-circle-2", `<b>Self-review submitted on ${esc(p.dates.selfReviewed)}.</b> ${esc(p.miltenyiReviewer)}'s comments will fill the last column once ${esc(p.reviewerOfRecord)} has entered them.`),
      reviewed: note("violet", "file-check-2", `<b>Reviewed on ${esc(p.dates.reviewed)}</b> by ${esc(p.miltenyiReviewer)} (${esc(p.miltenyiReviewerRole)}, Miltenyi), entered by ${esc(p.reviewerOfRecord)} from input received 19 Jan 2027.`),
    }[st];
  } else if (role === "reviewer") {
    notice = {
      draft: note("info", "pencil", `${esc(p.name)} is still drafting. Nothing to do yet.`),
      submitted: note("blue", "check", `<b>Goals submitted on ${esc(p.dates.submitted)}.</b> Confirm the offline agreement with ${esc(p.miltenyiReviewer)}, then mark the set approved. This locks the Goal column.`),
      approved: note("amber", "alert-triangle", `${esc(p.name)} has not submitted a self-review. You can draft ${esc(p.miltenyiReviewer)}'s comments now and submit once the self-review is in, or HR can override the gate. <span class="wf-tag">to confirm</span>`),
      self_reviewed: note("teal", "check-circle-2", `<b>Self-review in</b> (${esc(p.dates.selfReviewed)}). Enter ${esc(p.miltenyiReviewer)}'s comments in the last column and the final rating in the footer.`),
      reviewed: note("violet", "file-check-2", `<b>Review submitted on ${esc(p.dates.reviewed)}.</b> Edits after submission are logged with before/after text and notify ${esc(p.name)}.`),
    }[st];
  } else {
    notice = note("info", "eye", `HR view: read-only. Visibility of ratings to the employee is controlled in Admin → Framework.`);
  }

  /* ── Table ─────────────────────────────────────────────────────── */
  const ph = (t) => `<span class="text-xs italic text-text-muted">${t}</span>`;
  const readCell = (t) => t ? `<div class="whitespace-pre-wrap leading-relaxed text-text-main">${esc(t)}</div>` : ph("—");
  const editCell = (id, text, placeholder) => `<textarea id="${id}" rows="5" maxlength="3000" class="${cls.TEXTAREA}" placeholder="${esc(placeholder)}">${esc(text)}</textarea>${counter(text, 3000)}`;

  const goalCell = (i) => {
    if (editGoal) return editCell("goal-" + i, p.goals[i], "The deliverable, the measure and the timing for your trials.");
    if (st === "draft") return ph("Employee drafting");
    return readCell(p.goals[i]);
  };
  const selfCell = (i) => {
    if (editSelf) return editCell("self-" + i, p.selfReview[i], "What you delivered against this goal, the evidence, and what you would do differently.");
    if (selfDone) return readCell(p.selfReview[i]);
    if (!at("approved")) return ph("Opens after 31 Dec 2026");
    return ph(role === "employee" ? "Open for you to fill" : "Awaiting self-review");
  };
  const pmCell = (i) => {
    const hk = p.secondaryComments[i] || "";
    if (editPM) return `${editCell("pm-" + i, p.primaryComments[i], `Type or paste ${p.miltenyiReviewer}'s words for this KPI.`)}
      <div class="mt-2 rounded-md border border-dashed border-border px-2.5 py-2">
        <label for="hk-${i}" class="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-brand-accent">${icon("message-square", "h-3 w-3")}Healthark note · optional <span class="wf-tag">to confirm</span></label>
        <textarea id="hk-${i}" rows="2" maxlength="1000" class="${cls.TEXTAREA} text-xs" placeholder="Your own observation, shown to the employee as Healthark's.">${esc(hk)}</textarea>
      </div>`;
    if (reviewed) return `<div class="whitespace-pre-wrap leading-relaxed text-text-main">${esc(p.primaryComments[i])}</div>
      <p class="mt-1 flex items-center gap-1 text-[11px] text-text-muted">${icon("quote", "h-3 w-3 text-accent")}${esc(p.miltenyiReviewer)} · Miltenyi</p>
      ${hk ? `<div class="mt-2 rounded-md bg-brand-light px-2.5 py-2"><p class="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-brand-accent">${icon("message-square", "h-3 w-3")}Healthark · ${esc(p.reviewerOfRecord)}</p><p class="text-xs text-text-main">${esc(hk)}</p></div>` : ""}`;
    if (selfDone) return ph("Awaiting review");
    return ph("After self-review");
  };

  const colHead = (label, sub, active) => `<th scope="col" class="border-b border-border px-4 py-2.5 text-left align-bottom ${active ? "bg-brand-light" : ""}">
    <div class="flex items-center gap-2"><span class="${TH} ${active ? "text-brand-accent" : ""}">${label}</span>${active ? `<span class="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">editing</span>` : ""}</div>
    <div class="mt-0.5 text-[11px] font-normal normal-case tracking-normal text-text-muted">${sub}</div></th>`;

  const rows = f.kpis.map((k, i) => `<tr class="align-top hover:bg-slate-50">
    <td class="border-b border-border px-4 py-3">
      <div class="flex items-start gap-2.5">${PMS.kpiNumber(i + 1)}<div><p class="text-sm font-semibold leading-snug text-text-main">${esc(k.text)}</p><div class="mt-1.5">${weightChip(k.weight)}</div></div></div>
    </td>
    <td class="border-b border-border px-4 py-3 ${editGoal ? "bg-brand-light" : ""}">${goalCell(i)}</td>
    <td class="border-b border-border px-4 py-3 ${editSelf ? "bg-brand-light" : ""}">${selfCell(i)}</td>
    <td class="border-b border-border px-4 py-3 ${editPM ? "bg-brand-light" : ""}">${pmCell(i)}</td>
  </tr>`).join("");

  /* Footer: ratings */
  const finalBy = state.finalBy === "miltenyi" ? `${esc(p.miltenyiReviewer)} (Miltenyi)` : "Healthark";
  const selfRatingCell = editSelf
    ? PMS.ratingSelect("self-rating", "Your overall rating", p.selfRating, false)
    : selfDone
      ? `<div class="flex items-center gap-2">${ratingBadge(p.selfRating, "md")}<div class="text-xs text-text-muted">Self rating<br>given ${esc(p.dates.selfReviewed)}</div></div>`
      : ph(at("approved") && role === "employee" ? "Rate yourself after filling the column" : "—");
  const finalRatingCell = editPM
    ? `${PMS.ratingSelect("final-rating", "Final rating *", p.finalRating, false)}<p class="mt-1.5 text-[11px] text-text-muted">Given by <span class="font-medium text-text-main">${finalBy}</span> <span class="wf-tag">to confirm</span></p>`
    : reviewed
      ? (role === "employee" && !state.ratingsVisible
          ? `<div class="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-muted">${icon("lock", "h-3.5 w-3.5")}Final rating hidden until HR releases ratings</div>`
          : `<div class="flex items-center gap-2">${ratingBadge(p.finalRating, "md")}<div class="text-xs text-text-muted">Final rating<br>given by ${finalBy}</div></div>`)
      : ph("—");

  const table = `
<div class="overflow-x-auto rounded-lg border border-border">
  <table class="w-full min-w-[1040px] table-fixed border-collapse text-sm">
    <colgroup><col class="w-[27%]"><col class="w-[25%]"><col class="w-[24%]"><col class="w-[24%]"></colgroup>
    <thead class="bg-slate-50">
      <tr>
        ${colHead("KPI / success measure", "From the Miltenyi framework" + (state.showWeights ? " · weightage fixed" : ""), false)}
        ${colHead("Goal", "Agreed offline · written by the employee", editGoal)}
        ${colHead("Self review", "After 31 Dec 2026 · employee", editSelf)}
        ${colHead("PM review", "Miltenyi reviewer · entered by Healthark", editPM)}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot class="bg-slate-50">
      <tr class="align-top">
        <td colspan="2" class="px-4 py-3"><p class="text-sm font-semibold text-text-main">Overall rating · CY 2026</p><p class="text-xs text-text-muted">One rating for the whole goal set. No rating per KPI.</p></td>
        <td class="px-4 py-3 ${editSelf ? "bg-brand-light" : ""}">${selfRatingCell}</td>
        <td class="px-4 py-3 ${editPM ? "bg-brand-light" : ""}">${finalRatingCell}</td>
      </tr>
    </tfoot>
  </table>
</div>`;

  /* ── Footer actions ────────────────────────────────────────────── */
  let actions = "";
  if (editGoal) actions = `<p class="text-xs text-text-muted">Drafts can be saved and edited. Submit once the goals are agreed with your reviewer.</p><div class="flex items-center gap-3"><button type="button" class="${cls.BTN_SECONDARY}">${icon("save", "h-4 w-4")}Save Draft</button><button type="button" class="${cls.BTN_PRIMARY}" data-open="confirm-goals">${icon("send", "h-4 w-4")}Submit Goals</button></div>`;
  else if (editSelf) actions = `<p class="text-xs text-text-muted">Self-reviews are one-shot: locked once submitted.</p><div class="flex items-center gap-3"><button type="button" class="${cls.BTN_SECONDARY}">${icon("save", "h-4 w-4")}Save Draft</button><button type="button" class="${cls.BTN_PRIMARY}" data-open="confirm-self">${icon("send", "h-4 w-4")}Submit Self-Review</button></div>`;
  else if (role === "employee" && reviewed) actions = `<p class="text-xs text-text-muted">Acknowledging confirms you have read the review; it does not signal agreement. <span class="wf-tag">to confirm</span></p><button type="button" class="${cls.BTN_PRIMARY}">${icon("check", "h-4 w-4")}Acknowledge review</button>`;
  else if (role === "reviewer" && st === "submitted") actions = `<p class="text-xs text-text-muted">Marking approved records who confirmed, when, and locks the Goal column.</p><button type="button" class="${cls.BTN_PRIMARY}" data-open="approve-modal">${icon("check", "h-4 w-4")}Mark approved (agreed offline)</button>`;
  else if (editPM) actions = `<p class="text-xs text-text-muted">Submitting stores who entered it, when, from which source, and notifies ${esc(p.name)}.</p><div class="flex items-center gap-3"><button type="button" class="${cls.BTN_SECONDARY}" data-open="packet-modal">${icon("file-down", "h-4 w-4")}Send packet</button><button type="button" class="${cls.BTN_SECONDARY}">${icon("save", "h-4 w-4")}Save Draft</button><button type="button" id="do-review-submit" class="${cls.BTN_PRIMARY}" ${selfDone ? "" : "disabled title='Waiting for the self-review'"}>${icon("send", "h-4 w-4")}Submit Review</button></div>`;
  else if (role === "reviewer" && reviewed) actions = `<p class="text-xs text-text-muted">Submitted ${esc(p.dates.reviewed)} by ${esc(p.reviewerOfRecord)}.</p><button type="button" class="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2 text-sm font-medium text-white hover:opacity-90">${icon("pencil", "h-4 w-4")}Edit review</button>`;

  const footerBar = actions ? `<div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">${actions}</div>` : "";

  return { frameworkBand, provenance, notice, table, footerBar, stage: `<div class="flex flex-wrap items-center justify-between gap-3">${stageStrip(st)}${badge(st)}</div>` };
};
