/* shell.js — shared app chrome (sidebar + topbar, copied from
   frontend/src/layouts/Sidebar.tsx and Topbar.tsx), prototype state, badge
   and form helpers, modal helpers and the floating "Prototype controls" panel.

   Every wireframe page:
     1. declares <div id="page"> with its content (or lets its script fill it),
     2. loads assets/data.js and this file,
     3. calls PMS.init({ role, active, render }).
*/
window.PMS = (function () {
  const KEY = "pms-wf-state";
  const DEFAULTS = {
    persona: "aditi",
    stage: "draft",
    showWeights: true,
    ratingsVisible: false,
    finalBy: "miltenyi",
    dark: false,
    controlsOpen: false,
  };
  const STAGES = [
    { id: "draft", label: "Draft", badge: "bg-slate-100 text-slate-600" },
    { id: "submitted", label: "Submitted", badge: "bg-blue-100 text-blue-700" },
    { id: "approved", label: "Approved · agreed offline", badge: "bg-emerald-100 text-emerald-700" },
    { id: "self_reviewed", label: "Self-Reviewed", badge: "bg-teal-100 text-teal-700" },
    { id: "reviewed", label: "Reviewed", badge: "bg-violet-100 text-violet-700" },
  ];
  const EXTRA_BADGES = {
    unmapped: { label: "No framework", badge: "bg-red-50 text-red-700" },
    awaiting_self: { label: "Awaiting self-review", badge: "bg-amber-100 text-amber-700" },
  };

  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
  const state = load();
  if (state.dark) document.documentElement.classList.add("dark");

  const stageIndex = (id) => STAGES.findIndex((s) => s.id === id);
  const atLeast = (id) => stageIndex(state.stage) >= stageIndex(id);

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const icon = (name, cls) => `<i data-lucide="${name}" class="${cls || "h-4 w-4"}"></i>`;
  const initials = (name) => name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  const TEXTAREA_CLS =
    "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none disabled:bg-slate-50 disabled:text-text-muted disabled:cursor-not-allowed";
  const READONLY_BOX_CLS =
    "rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed";
  const INPUT_CLS =
    "w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand";
  const SELECT_CLS =
    "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";
  const BTN_PRIMARY = "flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity";
  const BTN_SECONDARY = "flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 disabled:opacity-50 transition-colors";
  const BTN_GHOST = "rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors";
  const TH_CLS = "text-[11px] font-bold uppercase tracking-wider text-text-muted";

  function badge(stageId) {
    const s = STAGES.find((x) => x.id === stageId) || EXTRA_BADGES[stageId];
    if (!s) return "";
    return `<span class="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${s.badge}">${esc(s.label)}</span>`;
  }
  const RATING_TIER = {
    1: "bg-green-50 text-green-700 border-green-200",
    2: "bg-brand-light text-brand-accent border-border",
    3: "bg-slate-100 text-slate-700 border-slate-200",
    4: "bg-amber-50 text-amber-700 border-amber-200",
    5: "bg-red-50 text-red-700 border-red-200",
  };
  function ratingBadge(n, size) {
    if (n == null || n === "") return `<span class="text-[12px] text-text-muted">—</span>`;
    const dim = size === "md" ? "h-7 w-7 text-sm" : "h-6 w-6 text-[12px]";
    return `<span class="inline-flex items-center justify-center rounded-md border font-bold ${dim} ${RATING_TIER[n] || RATING_TIER[3]}" title="Performance rating: ${n}">${n}</span>`;
  }
  function weightChip(w) {
    if (!state.showWeights) return "";
    return `<span class="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800" title="Weightage fixed by Miltenyi; not editable">${w}%</span>`;
  }
  function ratingGuide() {
    return `<div class="group relative inline-flex items-center">
      ${icon("info", "h-3.5 w-3.5 text-text-muted cursor-default")}
      <div class="invisible group-hover:visible pointer-events-none absolute top-full left-0 z-50 mt-2 w-72 rounded-lg border border-border bg-white px-3 py-2.5 text-xs text-text-main shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <p class="font-semibold mb-1.5">Rating Guide</p>
        <ul class="space-y-1.5 text-text-muted">
          <li><span class="font-semibold text-text-main">1 —</span> Performed beyond expectations</li>
          <li><span class="font-semibold text-text-main">2 —</span> Exceeded goals at expected level</li>
          <li><span class="font-semibold text-text-main">3 —</span> Achieved goals at expected level</li>
          <li><span class="font-semibold text-text-main">4 —</span> Partially achieved goals</li>
          <li><span class="font-semibold text-text-main">5 —</span> Did not achieve goals</li>
        </ul>
      </div>
    </div>`;
  }
  function ratingSelect(id, label, value, disabled) {
    const opts = [1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${String(value) === String(n) ? "selected" : ""}>${n}</option>`).join("");
    return `<div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-1.5">
        <label for="${id}" class="text-[13px] font-bold text-text-main">${esc(label)}</label>
        ${disabled ? "" : ratingGuide()}
      </div>
      <select id="${id}" ${disabled ? "disabled" : ""} class="w-24 rounded-lg border border-border bg-white px-3 py-2 text-[13px] outline-none focus:border-brand disabled:bg-slate-50 disabled:text-text-muted disabled:cursor-not-allowed">
        <option value="" ${value == null || value === "" ? "selected" : ""} disabled>Select</option>${opts}
      </select>
    </div>`;
  }
  function counter(text, max) {
    const n = (text || "").length;
    return `<div class="mt-1 text-right text-xs ${n >= max ? "text-red-600" : "text-text-muted"}">${n.toLocaleString()} / ${max.toLocaleString()}</div>`;
  }
  function kpiNumber(i) {
    return `<span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-light text-[12px] font-bold text-brand-accent">${i}</span>`;
  }
  function stageStrip(current) {
    const idx = stageIndex(current);
    return `<ol class="flex flex-wrap items-center gap-2 text-xs" aria-label="Goal set progress">${STAGES.map((s, i) => {
      const done = i < idx, cur = i === idx;
      const dot = done
        ? `<span class="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">${icon("check", "h-3 w-3")}</span>`
        : cur
          ? `<span class="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white text-[10px] font-bold">${i + 1}</span>`
          : `<span class="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-white text-[10px] font-semibold text-text-muted">${i + 1}</span>`;
      const txt = cur ? "font-semibold text-text-main" : done ? "text-text-main" : "text-text-muted";
      const sep = i < STAGES.length - 1 ? `<span class="h-px w-6 bg-border" aria-hidden="true"></span>` : "";
      return `<li class="flex items-center gap-2">${dot}<span class="${txt}">${esc(s.label)}</span></li>${sep}`;
    }).join("")}</ol>`;
  }

  const persona = () => WF.PERSONAS[state.persona] || WF.PERSONAS.aditi;
  const framework = () => WF.FRAMEWORK[persona().frameworkKey];

  /* Nav lists per role — copied from Sidebar.tsx, with the new "Project Goals"
     item added and "Project Reviews" omitted for the Miltenyi instance (the
     prototype takes the position that the per-project PM queue retires). */
  const NAVS = {
    employee: [
      ["layout-dashboard", "Dashboard", "#", "dashboard"],
      ["clipboard-list", "Project Goals", "01-employee-goals-table.html", "project-goals"],
      ["target", "Annual Goals", "#", "annual-goals"],
      ["file-text", "Annual Reviews", "#", "annual-reviews"],
    ],
    reviewer: [
      ["layout-dashboard", "Dashboard", "#", "dashboard"],
      ["clipboard-list", "Project Goals", "02-team-queue.html", "project-goals"],
    ],
    hr: [
      ["layout-dashboard", "Dashboard", "#", "dashboard"],
      ["clipboard-list", "Project Goals", "02-team-queue.html", "project-goals"],
      ["target", "Annual Goals", "#", "annual-goals"],
      ["file-text", "Annual Reviews", "#", "annual-reviews"],
      ["users", "My Mentees", "#", "my-mentees"],
      ["shield-check", "Management Review", "#", "management-review"],
      ["settings", "Admin Panel", "04-hr-framework-mapping.html", "admin"],
    ],
  };
  /* The reviewer of record is the employee's Mentor (decision 7 Sep). */
  const USERS = {
    get reviewer() { return { name: persona().mentor, role: "Mentor · Healthark" }; },
    hr: { name: "Aanya Sharma", role: "HR · Healthark" },
  };

  function navItem(item, active) {
    const [ic, label, href, id] = item;
    const isActive = id === active;
    return `<a href="${href}" class="w-full flex items-center rounded-lg transition-all duration-200 px-3 py-2 gap-2.5 ${
      isActive
        ? "bg-brand-light text-brand-accent font-semibold border-l-2 border-accent"
        : "text-text-muted hover:bg-brand-light hover:text-text-main font-medium border-l-2 border-transparent"
    }">${icon(ic, "w-4 h-4 shrink-0 " + (isActive ? "text-brand-accent" : "text-text-muted"))}<span class="text-sm whitespace-nowrap overflow-hidden">${esc(label)}</span></a>`;
  }

  function shellHtml(role, active) {
    const user = role === "employee" ? { name: persona().name, role: "Employee" } : USERS[role];
    const nav = (NAVS[role] || NAVS.employee).map((i) => navItem(i, active)).join("");
    return `
<div class="flex h-screen overflow-hidden">
  <aside class="w-56 h-screen shrink-0 bg-surface border-r border-border flex flex-col relative">
    <div class="h-14 flex items-center border-b border-border px-4">
      <img src="../frontend/public/miltenyi-biotec-logo.svg" alt="Miltenyi Biotec" class="h-10 w-auto object-contain shrink-0 max-w-[180px]">
      <span class="text-text-muted font-normal text-sm ml-2 shrink-0 whitespace-nowrap mt-4">PMS</span>
    </div>
    <nav aria-label="Main menu" class="flex-1 px-2.5 py-4 flex flex-col gap-1 overflow-y-auto overflow-x-hidden">${nav}</nav>
    <div class="p-2.5 border-t border-border flex flex-col gap-1 overflow-x-hidden">
      ${navItem(["user", "Profile", "#", "profile"], active)}
      ${navItem(["help-circle", "Support", "#", "support"], active)}
      <a href="index.html" class="w-full flex items-center rounded-lg text-red-600 hover:bg-red-50 font-medium transition-colors mt-1.5 px-3 py-2 gap-2.5">${icon("log-out", "w-4 h-4 shrink-0")}<span class="text-sm whitespace-nowrap">Logout</span></a>
    </div>
  </aside>
  <div class="flex flex-1 flex-col overflow-hidden">
    <header class="h-16 bg-surface border-b border-border flex items-center justify-between px-8 shrink-0">
      <div class="flex items-center gap-2">
        <span class="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800" title="Current financial year">${icon("calendar-days", "h-3 w-3 text-amber-700")}FY26-27</span>
        <span class="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-brand-light px-2.5 py-0.5 text-xs font-medium text-brand-accent" title="Project goals period">${icon("calendar-days", "h-3 w-3 text-accent")}Project Goals · CY 2026</span>
      </div>
      <div class="flex items-center gap-4">
        <button type="button" id="wf-theme" class="p-2 text-text-main hover:text-brand-accent transition-colors rounded-full hover:bg-brand-light" aria-label="Toggle theme">${icon(state.dark ? "sun" : "moon", "w-5 h-5" + (state.dark ? " text-amber-400" : ""))}</button>
        <button type="button" class="relative p-2 text-text-muted hover:text-brand-accent transition-colors rounded-full hover:bg-brand-light" aria-label="Notifications">${icon("bell", "w-5 h-5")}<span class="absolute top-1.5 right-2 w-2 h-2 bg-accent rounded-full border-2 border-surface" aria-hidden="true"></span></button>
        <div class="flex items-center gap-2.5">
          <div class="hidden md:block text-right leading-tight">
            <div class="text-sm font-medium text-text-main">${esc(user.name)}</div>
            <div class="text-[11px] text-text-muted">${esc(user.role)}</div>
          </div>
          <div class="h-8 w-8 rounded-full bg-brand text-white flex items-center justify-center font-semibold text-sm" title="${esc(user.name)}">${initials(user.name)}</div>
        </div>
      </div>
    </header>
    <main class="flex-1 overflow-y-auto bg-background p-6"><div id="main-slot"></div></main>
  </div>
</div>`;
  }

  function controlsHtml() {
    const opt = (v, l, cur) => `<option value="${v}" ${cur === v ? "selected" : ""}>${esc(l)}</option>`;
    const personaOpts = Object.values(WF.PERSONAS).map((p) => opt(p.id, `${p.name} · ${WF.FRAMEWORK[p.frameworkKey].title} (${WF.FRAMEWORK[p.frameworkKey].kpis.length} KPIs)`, state.persona)).join("");
    const stageOpts = STAGES.map((s) => opt(s.id, s.label, state.stage)).join("");
    const toggle = (id, label, on) => `<label class="flex items-center justify-between gap-3 py-1 cursor-pointer">
      <span class="text-xs text-text-main">${esc(label)}</span>
      <button type="button" role="switch" aria-checked="${on}" data-toggle="${id}" class="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${on ? "bg-brand" : "bg-slate-300"}"><span class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${on ? "translate-x-4" : "translate-x-0"}"></span></button>
    </label>`;
    const links = [
      ["index.html", "Index"],
      ["01-employee-goals-table.html", "1 · Employee: goals table"],
      ["02-team-queue.html", "2 · Reviewer: team queue"],
      ["03-reviewer-goals-table.html", "3 · Reviewer: goals table"],
      ["04-hr-framework-mapping.html", "4 · HR: mapping & framework"],
    ].map(([h, l]) => `<a href="${h}" class="block rounded px-2 py-1 text-xs text-text-muted hover:bg-brand-light hover:text-brand-accent">${esc(l)}</a>`).join("");
    return `
<div id="wf-controls" class="fixed bottom-4 right-4 z-[60] w-72 rounded-xl border border-border bg-surface shadow-xl">
  <button type="button" id="wf-controls-toggle" class="flex w-full items-center justify-between rounded-t-xl bg-brand px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-white">
    <span class="flex items-center gap-2">${icon("sliders-horizontal", "h-3.5 w-3.5")}Prototype controls</span>
    ${icon(state.controlsOpen ? "chevron-down" : "chevron-up", "h-3.5 w-3.5")}
  </button>
  <div id="wf-controls-body" class="${state.controlsOpen ? "" : "hidden"} p-3 space-y-3 text-sm">
    <label class="block"><span class="${TH_CLS}">Persona</span><select data-set="persona" class="${SELECT_CLS} mt-1 w-full">${personaOpts}</select></label>
    <label class="block"><span class="${TH_CLS}">Goal set stage</span><select data-set="stage" class="${SELECT_CLS} mt-1 w-full">${stageOpts}</select></label>
    <div class="divide-y divide-border">
      ${toggle("showWeights", "Show weightages to employee", state.showWeights)}
      ${toggle("ratingsVisible", "Ratings visible to employee", state.ratingsVisible)}
    </div>
    <div>
      <span class="${TH_CLS}">Final rating given by</span>
      <div class="mt-1 flex gap-1 rounded-lg border border-border bg-white p-0.5">
        <button type="button" data-final="miltenyi" class="flex-1 rounded-md px-2 py-1 text-[12px] font-medium ${state.finalBy === "miltenyi" ? "bg-brand-light text-brand-accent" : "text-text-muted hover:bg-slate-100"}">Miltenyi reviewer</button>
        <button type="button" data-final="healthark" class="flex-1 rounded-md px-2 py-1 text-[12px] font-medium ${state.finalBy === "healthark" ? "bg-brand-light text-brand-accent" : "text-text-muted hover:bg-slate-100"}">Healthark</button>
      </div>
    </div>
    <div class="border-t border-border pt-2">
      <span class="${TH_CLS}">Screens</span>
      <div class="mt-1">${links}</div>
    </div>
  </div>
</div>`;
  }

  function set(key, value) { state[key] = value; save(state); location.reload(); }

  function bindControls() {
    const root = document.getElementById("wf-controls");
    if (!root) return;
    root.querySelector("#wf-controls-toggle").addEventListener("click", () => {
      state.controlsOpen = !state.controlsOpen; save(state);
      document.getElementById("wf-controls-body").classList.toggle("hidden", !state.controlsOpen);
    });
    root.querySelectorAll("[data-set]").forEach((el) => el.addEventListener("change", (e) => set(el.dataset.set, e.target.value)));
    root.querySelectorAll("[data-toggle]").forEach((el) => el.addEventListener("click", () => set(el.dataset.toggle, !state[el.dataset.toggle])));
    root.querySelectorAll("[data-final]").forEach((el) => el.addEventListener("click", () => set("finalBy", el.dataset.final)));
    const theme = document.getElementById("wf-theme");
    if (theme) theme.addEventListener("click", () => set("dark", !state.dark));
  }

  const modal = {
    open(id) { const m = document.getElementById(id); if (m) m.classList.remove("hidden"); refreshIcons(); },
    close(id) { const m = document.getElementById(id); if (m) m.classList.add("hidden"); },
  };
  function refreshIcons() { if (window.lucide && window.lucide.createIcons) window.lucide.createIcons(); }

  function init(opts) {
    const role = opts.role || "employee";
    const page = document.getElementById("page");
    const modals = document.getElementById("modals");
    document.body.insertAdjacentHTML("afterbegin", shellHtml(role, opts.active));
    const slot = document.getElementById("main-slot");
    if (page) slot.appendChild(page);
    if (modals) document.body.appendChild(modals);
    document.body.insertAdjacentHTML("beforeend", controlsHtml());
    if (typeof opts.render === "function") opts.render();
    bindControls();
    document.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => modal.open(el.dataset.open)));
    document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => modal.close(el.dataset.close)));
    refreshIcons();
  }

  return {
    state, STAGES, atLeast, stageIndex, esc, icon, initials, badge, ratingBadge, weightChip, ratingSelect, counter, kpiNumber, stageStrip,
    persona, framework, modal, refreshIcons, init,
    cls: { TEXTAREA: TEXTAREA_CLS, READONLY: READONLY_BOX_CLS, INPUT: INPUT_CLS, SELECT: SELECT_CLS, BTN_PRIMARY, BTN_SECONDARY, BTN_GHOST, TH: TH_CLS },
  };
})();
