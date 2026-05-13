/**
 * Onboarding Guide generator. Produces docs/Miltenyi-PMS-Onboarding-Guide.docx
 * targeted at a non-technical new hire whose job is to maintain
 * requirements docs, flow diagrams, and tests.
 *
 * Run from the docs/ folder:
 *   node .onboarding-guide-gen.js
 */

const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageBreak, PageNumber,
  TabStopType, TabStopPosition,
} = require("docx");

// ── Style + sizing constants ──────────────────────────────────────────
const FONT = "Calibri";
const PAGE_W = 12240;      // 8.5"
const PAGE_H = 15840;      // 11"
const MARGIN = 1080;       // 0.75"
const CONTENT_W = PAGE_W - 2 * MARGIN; // 10080

const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: "BFBFBF" };
const cellBorders = {
  top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder,
};
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// ── Helpers ───────────────────────────────────────────────────────────

const p = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: 120, ...opts.spacing },
    alignment: opts.alignment,
    children: [new TextRun({ text, bold: !!opts.bold, italics: !!opts.italics, size: opts.size, color: opts.color })],
    ...opts.extra,
  });

/** A paragraph that mixes plain and styled runs. `parts` is an array of
 *  strings or `{text, bold, italics, code}` objects. */
const ptxt = (parts, opts = {}) =>
  new Paragraph({
    spacing: { after: 120, ...opts.spacing },
    children: parts.map(part => {
      if (typeof part === "string") return new TextRun({ text: part, size: opts.size });
      return new TextRun({
        text: part.text,
        bold: !!part.bold,
        italics: !!part.italics,
        font: part.code ? "Consolas" : undefined,
        color: part.code ? "0B5394" : part.color,
        size: opts.size,
      });
    }),
  });

const h1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 200 },
    children: [new TextRun({ text })],
  });

const h2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 140 },
    children: [new TextRun({ text })],
  });

const h3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 100 },
    children: [new TextRun({ text })],
  });

const bullet = (text) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text })],
  });

/** Bullet built from mixed runs (string | {text, bold, italics, code}). */
const bulletMixed = (parts) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 60 },
    children: parts.map(part => {
      if (typeof part === "string") return new TextRun({ text: part });
      return new TextRun({
        text: part.text, bold: !!part.bold, italics: !!part.italics,
        font: part.code ? "Consolas" : undefined,
        color: part.code ? "0B5394" : part.color,
      });
    }),
  });

const numItem = (text, ref = "steps") =>
  new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80 },
    children: [new TextRun({ text })],
  });

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

/** Build a simple table from a 2D array of strings. First row is bold header. */
function table(rows, columnWidths) {
  const totalW = columnWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths,
    rows: rows.map((row, rIdx) => new TableRow({
      tableHeader: rIdx === 0,
      children: row.map((cell, cIdx) => new TableCell({
        borders: cellBorders,
        width: { size: columnWidths[cIdx], type: WidthType.DXA },
        shading: rIdx === 0
          ? { fill: "1F4E79", type: ShadingType.CLEAR }
          : (rIdx % 2 === 0 ? { fill: "F2F2F2", type: ShadingType.CLEAR } : undefined),
        margins: cellMargins,
        children: (Array.isArray(cell) ? cell : [cell]).map(line =>
          new Paragraph({
            spacing: { after: 40 },
            children: [new TextRun({
              text: line,
              bold: rIdx === 0,
              color: rIdx === 0 ? "FFFFFF" : undefined,
              size: 20,
            })],
          })
        ),
      })),
    })),
  });
}

const blank = () => new Paragraph({ spacing: { after: 80 }, children: [] });

// ── Content ───────────────────────────────────────────────────────────

const titlePage = [
  new Paragraph({ spacing: { before: 4000, after: 0 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Miltenyi PMS", bold: true, size: 64, color: "1F4E79" })] }),
  new Paragraph({ spacing: { before: 240, after: 240 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Onboarding Guide", size: 44, color: "1F4E79" })] }),
  new Paragraph({ spacing: { before: 800 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "A complete reference for the new requirements / QA owner", italics: true, size: 24, color: "595959" })] }),
  new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Healthark × Miltenyi Biotec — Performance Management System", size: 22, color: "595959" })] }),
  new Paragraph({ spacing: { before: 2000 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Version 1.0", size: 20, color: "808080" })] }),
  pageBreak(),
];

// ── Section 0: About this document ────────────────────────────────────
const aboutDoc = [
  h1("About this document"),
  p("This guide exists for one reason: to take you from zero context to confident ownership of the requirements, flow diagrams, and test artefacts for the Miltenyi PMS in a single sitting. It is written for a new hire with a business-analyst / QA background — code-level details are intentionally avoided. When you need to look at the codebase, point a teammate at the relevant section here and ask them to walk you through the implementation."),
  h2("How to read it"),
  bullet("Sections 1–3 give you the lay of the land: what the product is, who uses it, and the organizational concepts that everything else is built on. Read these in order on day one."),
  bullet("Section 4 is a one-paragraph tour of each module. Use it as a map when you don't know which area a question belongs to."),
  bullet("Section 5 is the heart of the doc — every workflow written as numbered steps so you can turn each one into a flow diagram in your tool of choice."),
  bullet("Sections 6 and 7 capture the rules and edge cases that don't fit neatly into a workflow. Reference material; don't memorise."),
  bullet("Section 8 is a page-by-page tour of the UI — useful once you start writing test cases."),
  bullet("Section 9 covers the testing approach and how to think about it role-by-role."),
  bullet("Section 10 walks you through running the system locally and lists the seed accounts you'll log in as."),
  bullet("Sections 11–12 are reference: glossary and a code-repository map."),
  h2("Conventions used in this guide"),
  bulletMixed([{ text: "Inline code formatting", code: true }, " indicates a database column, an API path, a status value, or a config key — anything that's exact in the system."]),
  bullet("\"Staff\" with a capital S means the role specifically; \"staff\" lowercase is general English. Same for Mentor, PM, HR."),
  bullet("Workflow steps are numbered. Each one is a single action you could draw as one node on a diagram."),
  bullet("Italics flag a system rule or constraint that's important but not a step (\"the mentor cannot edit the goal at this stage\")."),
  pageBreak(),
];

// ── Section 1: Introduction ───────────────────────────────────────────
const sec1 = [
  h1("1. Introduction"),

  h2("1.1  What is PMS?"),
  p("PMS — short for Performance Management System — is a multi-tenant SaaS application that runs the full performance cycle for Miltenyi Biotec. Healthark builds and operates it; Miltenyi Biotec is the client whose employees and managers use it day-to-day. A single deployment supports both organisations side-by-side, with data isolated per organisation."),
  p("The system manages three intertwined performance artefacts: annual goals, annual reviews, and project-level evaluations. It is designed around the reality that Healthark places consultants on Miltenyi projects, so a single employee has both a Healthark mentor (their HR-side career sponsor) and a Miltenyi PM (their project supervisor). Both perspectives feed into how that employee is evaluated."),

  h2("1.2  Who uses it?"),
  p("Five distinct user roles. You will hear these names constantly — get fluent fast."),
  bulletMixed([{ text: "HR_MyOrg", code: true }, " — Healthark HR. Full super-admin. Creates users, manages projects, runs the export feature, oversees calibration of every annual review."]),
  bulletMixed([{ text: "HR_Miltenyi", code: true }, " — Miltenyi HR. Limited admin. Can read everything (goals, reviews, projects) but cannot edit Mentors or HR_MyOrg users."]),
  bulletMixed([{ text: "Mentor", code: true }, " — A Healthark mentor who is permanently paired with a roster of Staff. Reviews their mentees' annual goals (approve / request changes) and writes the mentor stage of their annual reviews. Mentors are never themselves rated."]),
  bulletMixed([{ text: "PM", code: true }, " — A Miltenyi project manager who supervises a project. Writes per-cycle project reviews for every team member assigned to their project. PMs are never themselves rated."]),
  bulletMixed([{ text: "Staff", code: true }, " — A Healthark employee assigned to a Miltenyi project. Has goals, files self-reviews, receives project reviews and annual reviews. This is the role being measured by everyone else."]),

  h2("1.3  The two orgs"),
  p("Two organisations are modelled in a single database, separated by an org_id column on every row. The seeded environment has just one organisation (\"Miltenyi\") to keep the demo focused. The Healthark people live in that same organisation but are tagged with Healthark email addresses; they are not a separate tenant in the system."),
  ptxt(["Confusion-buster: \"Healthark HR\" and \"Miltenyi HR\" are ", { text: "two different roles", italics: true }, " (", { text: "HR_MyOrg", code: true }, " and ", { text: "HR_Miltenyi", code: true }, "), not two different tenants. They share the same org_id but have different permission scopes."]),

  h2("1.4  High-level capabilities"),
  p("Everything the application does fits into one of these eight modules:"),
  bullet("Authentication and session — login, password reset, 30-minute sliding session, role-aware redirects."),
  bullet("User administration — create / edit / deactivate / reactivate users; assign function, designation, mentor."),
  bullet("Project management — create projects, assign PMs and team members, mark complete, re-open."),
  bullet("Annual goals — Staff write annual goals; Mentor approves; Staff and Mentor file H1 and H2 reviews."),
  bullet("Annual reviews — three-stage appraisal: Staff self → Mentor → Management calibration → final rating."),
  bullet("Project reviews — PM writes per-cycle evaluations for each Staff on their project; an optional Secondary evaluator adds an impact statement."),
  bullet("HR dashboard — org-wide rollups for HR_MyOrg and HR_Miltenyi: headcount, cycle progress funnels, exception lists."),
  bullet("Excel exports — HR_MyOrg can download every entity as XLSX, including a per-employee deep-dive bundle. Every download is logged to an audit table."),
  pageBreak(),
];

// ── Section 2: User Roles & Permissions ───────────────────────────────
const sec2 = [
  h1("2. User Roles & Permissions"),
  p("Five roles, each with a distinct surface area and a distinct set of permissions. The sections below describe each role in turn; the table at the end summarises which role can do what."),

  h2("2.1  HR_MyOrg (Healthark HR)"),
  p("The platform-owner HR role. There is typically only one or two of these in the entire system. They are the only role with truly unrestricted access."),
  p("What they can do:"),
  bullet("Create, edit, deactivate, and reactivate any user — including other HR_MyOrg users, Mentors, and PMs."),
  bullet("Create and edit projects; assign PMs; assign and end team-member assignments; mark projects complete or re-open them."),
  bullet("Read every annual goal, every annual review, every project review across the organisation."),
  bullet("Calibrate annual reviews in the management stage and publish final ratings."),
  bullet("Configure system settings (active cycle, cycle type, fiscal start month, feature toggles)."),
  bullet("Run any of the Excel export endpoints and access the centralised Exports admin tab."),
  bullet("View the HR Dashboard with org-wide rollups."),

  h2("2.2  HR_Miltenyi (Miltenyi HR)"),
  p("The client-side HR role. They share read scope with HR_MyOrg — the same dashboards, the same All Reviews / All Goals lists — but cannot mutate certain protected user records."),
  p("What they can do:"),
  bullet("Create and edit Staff and PM users."),
  bullet("Read every annual goal, every annual review, every project review."),
  bullet("View the HR Dashboard."),
  p("What they cannot do:"),
  bullet("Edit Mentor users or HR_MyOrg users. Backend returns 403."),
  bullet("Run the Excel exports — those are HR_MyOrg only by design (compliance scope)."),
  bullet("Open the Management Review tab in the admin panel."),

  h2("2.3  Mentor"),
  p("A career sponsor on the Healthark side. Each Mentor has a fixed pool of Staff mentees, assigned by an HR_MyOrg admin. Mentors are not themselves rated and do not write their own goals."),
  p("What they can do:"),
  bullet("View the Team Goals tab on the Annual Goals page (their mentees' goals)."),
  bullet("Approve a mentee's submitted annual goal, or request changes."),
  bullet("Write the H1 and H2 mentor reviews on each mentee's approved annual goal."),
  bullet("Write the mentor stage of each mentee's annual review (stage 2 of 3)."),
  bullet("Use the My Mentees page to see a roster overview of all their mentees."),
  p("What they cannot do:"),
  bullet("See the goals of any Staff who is not their mentee."),
  bullet("Run any administrative action (create users, manage projects, etc.)."),

  h2("2.4  PM (Project Manager)"),
  p("Miltenyi-side supervisor of a project. Project membership is established by an HR admin; the PM does not pick their own team. PMs are not rated and do not have annual goals."),
  p("What they can do:"),
  bullet("See the Primary Evaluation tab on the Project Reviews page — a queue of every assigned Staff member on their project whose review hasn't been written yet."),
  bullet("Write a per-cycle project review for each team member: seven competency comments, an impact statement, and a performance group rating."),
  bullet("Edit a project review they previously submitted (status moves from reviewed back to draft and then forward again)."),
  bullet("End a team member's assignment on their project (\"this person left the project\")."),
  p("What they cannot do:"),
  bullet("See or write reviews for Staff who are not on a project they own."),
  bullet("Create projects, assign PMs, or change team rosters beyond ending an active assignment."),

  h2("2.5  Staff"),
  p("The role being measured. Every Staff member is mentored by exactly one Mentor and is typically active on one or more projects, each run by a PM."),
  p("What they can do:"),
  bullet("Set and edit their own annual goal (one annual goal per Staff per fiscal year)."),
  bullet("File their H1 and H2 self-reviews on the annual goal once it has been approved."),
  bullet("File their annual review self-stage (stage 1 of 3) — overall narrative plus a self-rating."),
  bullet("View completed project reviews written about them (once the PM has submitted)."),
  bullet("View the My Mentees page if they happen to have a Mentor relationship — Staff don't, but the page is reachable; in practice it is empty for them."),
  p("What they cannot do:"),
  bullet("See other Staff's goals or reviews."),
  bullet("See a project review until the PM has finished writing it."),
  bullet("See the final rating on their annual review until HR enables the visibility flag."),

  h2("2.6  Permission matrix"),
  p("A compact reference for the actions HR will care about most."),
  table([
    ["Action", "HR_MyOrg", "HR_Miltenyi", "Mentor", "PM", "Staff"],
    ["Create / edit Staff & PM users",       "✓",  "✓",  "—",  "—",  "—"],
    ["Create / edit Mentor or HR users",     "✓",  "—",  "—",  "—",  "—"],
    ["Create / edit projects",               "✓",  "✓",  "—",  "—",  "—"],
    ["Mark project complete / re-open",      "✓",  "—",  "—",  "—",  "—"],
    ["Write project reviews",                "—",  "—",  "—",  "✓",  "—"],
    ["Approve mentee annual goal",           "—",  "—",  "✓",  "—",  "—"],
    ["Write H1 / H2 mentor review",          "—",  "—",  "✓",  "—",  "—"],
    ["Write annual review (mentor stage)",   "—",  "—",  "✓",  "—",  "—"],
    ["Calibrate / publish final rating",     "✓",  "—",  "—",  "—",  "—"],
    ["Write own annual goal + self-review",  "—",  "—",  "—",  "—",  "✓"],
    ["Run Excel exports",                    "✓",  "—",  "—",  "—",  "—"],
    ["See HR Dashboard",                     "✓",  "✓",  "—",  "—",  "—"],
    ["Change system settings",               "✓",  "—",  "—",  "—",  "—"],
  ], [2400, 1800, 1900, 1400, 1100, 1480]),

  pageBreak(),
];

// ── Section 3: Organizational Model ───────────────────────────────────
const sec3 = [
  h1("3. Organizational Model"),
  p("Three concepts you need before any feature makes sense: the org / multi-tenancy model, the function-and-designation taxonomy, and the fiscal-year-and-cycle structure that drives every time-bound feature."),

  h2("3.1  Multi-tenancy"),
  ptxt(["Every database row carries an ", { text: "org_id", code: true }, " column. The application is built to support multiple isolated organisations on a single deployment — when an HR user creates a goal or a project, that row is stamped with their org_id, and every read query filters by the caller's org_id. The seeded environment has only one organisation (\"Miltenyi\"), so in your daily work you will see exactly one org_id everywhere. The tenancy boundary still matters because the cross-org guard is enforced at the API layer: any request for an entity that belongs to another organisation returns 404, not 403."]),

  h2("3.2  Function and Designation"),
  p("Two reference tables capture an employee's slot in the org chart:"),
  bulletMixed([{ text: "Function", code: true }, " — the broad area of work. Seeded values: R&D, Manufacturing, Commercial."]),
  bulletMixed([{ text: "Designation", code: true }, " — the seniority level. Seeded values: Scientist, Senior Scientist, Team Lead, Director."]),
  p("Every Staff and PM user is assigned to one Function and one Designation. Mentors and HR users carry a Designation (typically Director) but no Function — they are cross-functional by design."),
  p("These two values together pick the right Role Expectation rubric (eight competencies' worth of guidance text) that PMs see when writing a project review for a Staff member."),

  h2("3.3  Mentor → Mentee pairing"),
  ptxt(["Each Staff user has a single ", { text: "mentor_id", code: true }, " pointing to a Mentor. The pairing is permanent unless an HR admin reassigns it. Mentors are the gatekeepers for that Staff's annual goal approval and the writers of their annual review's mentor stage."]),
  p("If a Mentor is deactivated while still pointing to Staff, those Staff become \"unmentored\" in practice — the HR Dashboard's Mentor Coverage card surfaces them so HR can re-assign. The system does not auto-redirect mentees to another mentor."),

  h2("3.4  Fiscal year and cycle types"),
  ptxt(["The fiscal year starts in the month set by ", { text: "fiscal_start_month", code: true }, " on system settings. The seed sets this to April (4), matching the Indian fiscal calendar. So FY26-27 means \"April 2026 through March 2027.\""]),
  ptxt(["Each organisation picks a ", { text: "cycle_type", code: true }, " — one of three:"]),
  bullet("annual — the cycle is the full fiscal year. There is one performance cycle per FY."),
  bullet("half_yearly — two cycles per FY (H1 covers April–September; H2 covers October–March)."),
  bullet("quarterly — four cycles per FY (Q1 April–June, Q2 July–September, Q3 October–December, Q4 January–March)."),
  p("Cycle type drives the project-review cadence. Goal self-reviews are always half-yearly (H1 and H2) regardless of cycle_type — that decoupling is intentional. Annual reviews are always annual."),
  ptxt(["The currently-active cycle is stored as a label on system settings: ", { text: "active_cycle_name", code: true }, ", e.g. ", { text: "\"Q1 FY26-27\"", code: true }, " in the seeded environment."]),

  h2("3.5  Cycle windows"),
  p("Most actions are time-gated. Examples:"),
  bullet("Staff can only submit an annual goal while the goals submission window is open."),
  bullet("Staff can only file an H1 self-review during the H1 window of the goal's FY."),
  bullet("PMs can only write a project review for the current cycle (past cycles are read-only)."),
  ptxt(["For demo and stakeholder testing, a system-settings flag ", { text: "cycle_window_override", code: true }, " can be turned on to bypass all calendar gates. This lets a single demo session walk the full lifecycle of a goal or review without waiting for calendar dates to advance. Production should always leave this flag false."]),

  pageBreak(),
];

// ── Section 4: Core Modules at a Glance ───────────────────────────────
const sec4 = [
  h1("4. Core Modules at a Glance"),
  p("A one-paragraph orientation per module. Detailed step-by-step flows live in Section 5; this section exists so you know which area to dig into."),

  h2("4.1  Authentication & Session"),
  p("Email-and-password login. Backend issues a 30-minute JSON Web Token in an HttpOnly cookie; every authenticated request slides the expiry forward another 30 minutes. Walk away from the laptop for 30 minutes and the next click bounces you to the login page. A forgot-password flow emails a one-time reset link valid for 15 minutes."),

  h2("4.2  User Administration (Admin Panel)"),
  p("HR_MyOrg and HR_Miltenyi can create users, edit their function / designation / mentor, set their role, deactivate them, and reactivate them later. HR_MyOrg can additionally reset any user's password (admin-initiated reset). Deactivated users disappear from every dropdown but their historical records are kept."),

  h2("4.3  Projects"),
  p("HR creates a project with a code (MIL-PRJ-101), name, description, PM, and optional Secondary evaluator. Staff are assigned to projects as team members. A project moves through two states: active and completed. Marking complete auto-ends every team-member assignment on that date and stops generating new review cycles for the project."),

  h2("4.4  Annual Goals"),
  p("Each Staff member writes one annual goal per FY. They submit it for approval; their Mentor approves it or requests changes. Once approved, the goal is locked for editing and unlocks the H1 and H2 self-review windows. Staff file an H1 self-review at the half-year point; the Mentor responds with an H1 mentor review. Same pattern repeats for H2."),

  h2("4.5  Annual Reviews"),
  p("Separate from goals. A three-stage workflow per Staff per FY: stage 1 is the Staff's own self review plus self rating; stage 2 is the Mentor's review plus mentor rating; stage 3 is management calibration where HR_MyOrg can override with a management rating and publish a final rating."),

  h2("4.6  Project Reviews"),
  p("Each cycle the system creates a pending review for every active project assignment. The PM writes seven per-competency comments, an impact statement, and a performance group rating. Optionally a Secondary evaluator adds an impact statement to round out the picture. Once submitted, the Staff member sees the review under My Reviews."),

  h2("4.7  HR Dashboard"),
  p("Org-wide rollups for HR. Seven cards: headcount, annual-review progress funnel, goal-approval funnel, project-review completion funnel, missing annual reviews, stalled goal approvals, mentor coverage. Each card links to its corresponding tab via a \"View all\" link. Filters by fiscal year using a picker at the top of the page."),

  h2("4.8  Excel Exports"),
  p("HR_MyOrg can download any entity as XLSX: users, projects, annual goals (with H1/H2 reviews inlined), annual reviews, project reviews, plus a single-workbook bundle containing all five sheets, plus a per-employee deep-dive workbook (profile, goals, annual reviews, project assignment history, project reviews). Each download is logged to an audit table for compliance."),

  pageBreak(),
];

// ── Section 5: Detailed Workflows ─────────────────────────────────────
const sec5 = [
  h1("5. Detailed Workflows"),
  p("Step-by-step descriptions of every flow you'll need to test and diagram. Each numbered step is a single action, intended to map onto one node when you draw the flow as a diagram."),

  h2("5.1  Authentication & Session"),

  h3("5.1.1  Login"),
  numItem("User opens the application URL; the frontend checks for an existing session by calling /auth/session.", "f-login"),
  numItem("If the session is valid, user is routed to /dashboard immediately. Skip to step 6.", "f-login"),
  numItem("If no session or expired, user lands on the Login page.", "f-login"),
  numItem("User enters email and password; clicks Sign in.", "f-login"),
  numItem("Backend validates credentials; if valid, issues a JWT cookie with a 30-minute expiry and returns the session payload (user_id, role, full_name, org_id, has_mentees flag).", "f-login"),
  numItem("Frontend stashes the session in memory + localStorage and routes the user to their landing surface (Dashboard for most roles).", "f-login"),
  numItem("Sliding behaviour: every subsequent authenticated request resets the cookie to a fresh 30 minutes. The user is silently logged out only after 30 minutes of complete inactivity.", "f-login"),

  h3("5.1.2  Silent expiry (idle logout)"),
  numItem("User is logged in but leaves the tab idle for over 30 minutes.", "f-expiry"),
  numItem("User returns and clicks anywhere that triggers an API request.", "f-expiry"),
  numItem("Backend rejects the request with HTTP 401 (cookie expired).", "f-expiry"),
  numItem("Frontend's axios interceptor catches the 401; clears localStorage; navigates to /login?reason=expired.", "f-expiry"),
  numItem("Login page reads the reason query parameter and shows a blue banner: \"Your session expired due to inactivity. Please sign in again.\"", "f-expiry"),

  h3("5.1.3  Forgot password (self-service)"),
  numItem("On the Login page, user clicks Forgot password?", "f-forgot"),
  numItem("Form mode swaps to forgot-password; user enters their email.", "f-forgot"),
  numItem("Backend looks up the user; if active, generates a random URL-safe token, hashes it (SHA-256), and stores the hash with a 15-minute expiry.", "f-forgot"),
  numItem("Backend sends an email with a /reset-password?token=… link to the user's address.", "f-forgot"),
  numItem("If the email account has had 3+ reset requests in the last hour, backend returns 429 instead.", "f-forgot"),
  numItem("User clicks the link in the email; lands on the Reset Password page with the token in the URL.", "f-forgot"),
  numItem("User enters a new password twice; submits.", "f-forgot"),
  numItem("Backend validates the token (hash match, not used, not expired), updates the password, marks the token used. User is redirected to /login.", "f-forgot"),

  h3("5.1.4  Forced logout (account deactivated)"),
  numItem("HR_MyOrg deactivates a user from the Admin Panel.", "f-dactv"),
  numItem("Deactivated user is still holding a valid JWT cookie from before they were deactivated.", "f-dactv"),
  numItem("On their next API call, backend's get_current_user dependency notices is_deleted=true and rejects with HTTP 403 detail \"account deactivated\".", "f-dactv"),
  numItem("Frontend's axios interceptor matches the deactivated detail; clears localStorage; navigates to /login?reason=deactivated.", "f-dactv"),
  numItem("Login page renders an amber banner explaining the account has been deactivated.", "f-dactv"),

  h2("5.2  Onboarding a New User"),
  numItem("HR_MyOrg or HR_Miltenyi opens Admin Panel → Users tab.", "f-onboard"),
  numItem("Clicks Add User; modal opens.", "f-onboard"),
  numItem("Enters full name, email, employee code, phone, role, function, designation. Optionally picks a mentor for Staff.", "f-onboard"),
  numItem("Submits. Backend generates a random temporary password, returns the new user record. The temp password is shown back in the success modal so the admin can relay it.", "f-onboard"),
  numItem("Alternatively, the admin clicks Reset Password on the new user's row; backend issues an email reset link and shows it on screen (so the admin can copy if email delivery is slow).", "f-onboard"),
  numItem("The new user receives the reset email or the temporary password.", "f-onboard"),
  numItem("New user signs in for the first time. If a temp password was used, backend's must_change_password flag is set, and the frontend routes them to the Change Password screen before any other surface.", "f-onboard"),
  numItem("New user picks a permanent password, the flag clears, and they land on Dashboard.", "f-onboard"),

  h2("5.3  Project Lifecycle"),

  h3("5.3.1  Project creation"),
  numItem("HR_MyOrg or HR_Miltenyi opens Admin Panel → Projects tab.", "f-projcre"),
  numItem("Clicks Add Project; project modal opens.", "f-projcre"),
  numItem("Enters project code (must be unique per org), name, description, start date, expected end date.", "f-projcre"),
  numItem("Picks a PM from the dropdown (any user with role=PM in the same org).", "f-projcre"),
  numItem("Optionally picks a Secondary evaluator (any non-PM, non-Mentor user — typically HR or a senior cross-functional reviewer).", "f-projcre"),
  numItem("Adds team members: for each Staff to assign, the admin picks the user, their assignment role (defaults to their Designation), their function (defaults to theirs), and an assigned date.", "f-projcre"),
  numItem("Saves. Backend creates the project row and one ProjectAssignment row per team member.", "f-projcre"),
  numItem("Project status is automatically active.", "f-projcre"),

  h3("5.3.2  Ending a team member's assignment mid-cycle"),
  numItem("HR or the project's PM opens the project edit modal.", "f-aend"),
  numItem("Finds the team member to remove and clicks the X / End Assignment icon next to their row.", "f-aend"),
  numItem("Backend sets that assignment's end_date to today and stamps ended_by_id with the actor.", "f-aend"),
  numItem("The row stays in the database; the user is no longer counted as an active member.", "f-aend"),
  ptxt([{ text: "Important:", bold: true }, " any in-flight project review for that user × cycle stays in the PM's queue. The PM should still complete a partial review covering the time the user was on the project. Once submitted, no new placeholders are generated for that user × project in future cycles."]),

  h3("5.3.3  Marking a project complete"),
  numItem("HR_MyOrg opens the project edit modal.", "f-complete"),
  numItem("Clicks Mark Complete; a confirmation dialog appears showing how many active assignments will be auto-end-dated.", "f-complete"),
  numItem("Confirms.", "f-complete"),
  numItem("Backend: sets project status to completed, stamps completed_at = today and completed_by_id with the actor, then sets end_date on every active assignment to today and ended_by_id to the actor.", "f-complete"),
  numItem("Project is now archived. PM queue stops surfacing it for upcoming cycles. Historical project reviews remain readable to everyone with access.", "f-complete"),

  h3("5.3.4  Re-opening a completed project"),
  numItem("HR_MyOrg opens a completed project's edit modal.", "f-reopen"),
  numItem("Clicks Re-open; confirms.", "f-reopen"),
  numItem("Backend clears completed_at and completed_by_id and sets status back to active.", "f-reopen"),
  ptxt(["Re-opening does ", { text: "not", italics: true }, " automatically re-activate the previously-ended assignments. HR must add team members back explicitly. This is intentional — re-opening usually means a new scope of work."]),

  h3("5.3.5  Re-assigning a Staff who previously left a project"),
  numItem("On a still-active project, HR or PM uses the Add Team Member flow.", "f-rejoin"),
  numItem("They pick a Staff who has a previous (ended) assignment to this same project.", "f-rejoin"),
  numItem("Backend allows the insert — a Staff can hold multiple historical assignment rows for the same project. Each stint preserves its own review history.", "f-rejoin"),
  numItem("Only one of the rows may have end_date = NULL at any moment. The route layer enforces this.", "f-rejoin"),

  h2("5.4  Annual Goal Lifecycle"),
  ptxt(["Goal lifecycle is governed by the ", { text: "approval_status", code: true }, " column on the Goal row. It moves through these states:"]),
  bullet("draft → pending_approval → approved → h1_self_reviewed → h1_mentor_reviewed → h2_self_reviewed → h2_mentor_reviewed"),
  p("With a side-branch: at any point from pending_approval onward, the mentor can request changes, which sends the goal back to changes_requested and unlocks editing for the Staff."),

  h3("5.4.1  Drafting and submission"),
  numItem("Staff opens the Annual Goals page → My Goals tab.", "f-goal"),
  numItem("Clicks Add Goal (only enabled when the goals submission window is open).", "f-goal"),
  numItem("Fills in title, description, due date, attachment URL, and an optional list of criteria (key results that drive progress %).", "f-goal"),
  numItem("Saves as draft. The goal is invisible to the Mentor at this stage — private mentee work.", "f-goal"),
  numItem("Staff can edit the draft as many times as they want.", "f-goal"),
  numItem("When ready, Staff clicks Submit for Approval. Status moves to pending_approval. Goal becomes visible on the Mentor's Team Goals tab.", "f-goal"),

  h3("5.4.2  Mentor approval"),
  numItem("Mentor opens Annual Goals → Team Goals tab.", "f-goalapp"),
  numItem("Sees a list of mentees with their goals nested. Clicks Approve on a goal.", "f-goalapp"),
  numItem("Confirmation modal appears (\"Approving locks this goal for editing\").", "f-goalapp"),
  numItem("Mentor confirms; backend sets approval_status to approved, stamps approved_at = now.", "f-goalapp"),
  numItem("Staff can no longer edit the goal. H1 and H2 self-review windows open per the calendar gate.", "f-goalapp"),

  h3("5.4.3  Mentor requests changes"),
  numItem("On the same Team Goals tab, Mentor clicks Request Changes instead of Approve.", "f-changes"),
  numItem("A small modal asks for free-text feedback.", "f-changes"),
  numItem("Mentor enters feedback and submits.", "f-changes"),
  numItem("Backend sets approval_status to changes_requested and stores the feedback on manager_feedback.", "f-changes"),
  numItem("Staff sees the feedback on their My Goals tab; goal is editable again.", "f-changes"),
  numItem("Staff revises and re-submits (back to pending_approval). Cycle repeats until the Mentor approves.", "f-changes"),

  h3("5.4.4  H1 self-review and mentor review"),
  numItem("Cycle calendar reaches the H1 window for the goal's FY. The H1 menu item on the My Goals tab unlocks (the cycle_window_override demo flag also unlocks it).", "f-h1"),
  numItem("Staff clicks the H1 entry; a single-paragraph reflection form opens.", "f-h1"),
  numItem("Staff can save a draft (private to them) or submit. Submission flips approval_status to h1_self_reviewed.", "f-h1"),
  numItem("Mentor sees the submission on Team Goals; clicks the H1 chip on that goal row.", "f-h1"),
  numItem("The Mentor Review modal opens: three-column layout — Role Expectations on the left, the mentee's self-review in the middle, the mentor's writing area on the right.", "f-h1"),
  numItem("Mentor writes their H1 review and submits. Status becomes h1_mentor_reviewed.", "f-h1"),

  h3("5.4.5  H2 self-review and mentor review"),
  numItem("Same as H1 but for H2. Status progresses: h2_self_reviewed → h2_mentor_reviewed.", "f-h2"),
  numItem("Once h2_mentor_reviewed is reached, the goal is fully closed for the FY. It remains visible on past-year tabs but no further actions are required.", "f-h2"),

  h2("5.5  Annual Review Lifecycle"),
  ptxt(["Annual reviews are separate from goals. One AnnualReview row per Staff per FY (unique index enforces this). Lifecycle is governed by ", { text: "status", code: true }, ":"]),
  bullet("draft → pending_mentor → pending_management → completed"),

  h3("5.5.1  Stage 1 — Staff self-review"),
  numItem("Staff opens Annual Reviews → My Self Review tab.", "f-ar1"),
  numItem("If no row exists yet, clicks Start Self Review.", "f-ar1"),
  numItem("Backend creates a new AnnualReview row with status=draft, stamped with the active FY's cycle_name (e.g. \"FY26-27\").", "f-ar1"),
  numItem("Staff fills two fields: a freeform overall narrative + a numeric self rating (1=best to 5=worst).", "f-ar1"),
  numItem("Can save as draft repeatedly; mentor never sees draft content.", "f-ar1"),
  numItem("Submits. Status moves to pending_mentor.", "f-ar1"),

  h3("5.5.2  Stage 2 — Mentor evaluation"),
  numItem("Mentor opens Annual Reviews → Team Reviews tab; sees their mentees' pending submissions.", "f-ar2"),
  numItem("Clicks Evaluate on one; the form opens with the Staff's self-review visible above the mentor's writing area.", "f-ar2"),
  numItem("Mentor writes their overall review and assigns a mentor performance rating.", "f-ar2"),
  numItem("Can save as draft repeatedly. Drafts live in separate columns (mentor_overall_review_draft) so the mentee doesn't see premature content.", "f-ar2"),
  numItem("Mentor submits. Backend copies the draft fields into the published columns and clears the drafts. Status moves to pending_management.", "f-ar2"),

  h3("5.5.3  Stage 3 — Management calibration"),
  numItem("HR_MyOrg opens Admin Panel → Management Review tab.", "f-ar3"),
  numItem("Sees a calibration grid: every Staff in the active FY whose review is pending_management or completed, with self / mentor / final ratings in adjacent columns.", "f-ar3"),
  numItem("Optionally overrides with a management_performance_rating (e.g. mentor said 1 but management calibrates down to 2 after cross-org comparison).", "f-ar3"),
  numItem("Sets the final_performance_rating and toggles final_rating_enabled on that row to publish.", "f-ar3"),
  numItem("Status moves to completed.", "f-ar3"),
  numItem("Visibility to the Staff member is gated by the annual_review_final_rating_visible system-wide flag and the per-row final_rating_enabled flag (both must be true).", "f-ar3"),

  h2("5.6  Project Review Lifecycle"),
  ptxt(["One ProjectReview row per (user × project × cycle). Status moves through:"]),
  bullet("pending → draft → reviewed"),

  h3("5.6.1  Cycle opening and pending placeholders"),
  numItem("HR_MyOrg rotates the active cycle on system settings (e.g. moves from \"Q1 FY26-27\" to \"Q2 FY26-27\").", "f-pr1"),
  numItem("System creates a pending ProjectReview row for every active project × every team member assigned at any time during the cycle window.", "f-pr1"),
  numItem("These rows show up in each PM's Primary Evaluation queue.", "f-pr1"),

  h3("5.6.2  PM writes the review"),
  numItem("PM opens Project Reviews → Primary Evaluation tab.", "f-pr2"),
  numItem("Sees a queue of all their team members across all their projects for the active cycle. Each row has Evaluate.", "f-pr2"),
  numItem("PM clicks Evaluate on one row; the evaluation form opens.", "f-pr2"),
  numItem("Form has seven competency comment fields: task execution, ownership, project management, client deliverables, communication, mentoring, competency & skills. Plus an impact statement and a performance group rating (1–5).", "f-pr2"),
  numItem("On the left, the relevant Role Expectations are shown as reference (scoped to the Staff's function × designation).", "f-pr2"),
  numItem("PM can save partial work; status moves to draft. The Staff cannot yet see the partial content.", "f-pr2"),
  numItem("PM clicks Submit. Status moves to reviewed and reviewer_id is stamped with the PM's id. Staff can now see the review under My Reviews.", "f-pr2"),

  h3("5.6.3  Secondary evaluator (optional)"),
  numItem("If the project has a Secondary evaluator configured, that user sees the review under the Secondary Evaluation tab once it's been submitted by the PM.", "f-pr3"),
  numItem("Secondary clicks Add Impact Statement.", "f-pr3"),
  numItem("Writes a freeform impact statement (no ratings, no competency comments) and submits.", "f-pr3"),
  numItem("Backend stores it in ProjectReviewEvaluator. Visible alongside the PM's review in any read-only view.", "f-pr3"),
  numItem("A review can have zero or more secondary statements depending on how many secondary evaluators are configured / submit.", "f-pr3"),

  h3("5.6.4  PM edits a submitted review"),
  numItem("PM opens the reviewed entry. Editing reopens the form; status stays reviewed throughout (no need to roll back).", "f-pr4"),
  numItem("PM updates fields, submits again. The review is overwritten in place.", "f-pr4"),
  numItem("HR_MyOrg has the same edit privilege (admin override). Other roles do not.", "f-pr4"),

  h2("5.7  Excel Export Workflows"),

  h3("5.7.1  Per-tab quick exports"),
  numItem("HR_MyOrg opens any of these tabs: Admin → Users, Admin → Projects, Annual Goals → All Goals, Annual Reviews → All Reviews, Project Reviews → All Reviews.", "f-exp1"),
  numItem("On the right of the filter toolbar, clicks Export Excel.", "f-exp1"),
  numItem("Backend builds the relevant sheet — Users, Annual Goals, Annual Reviews, Projects, or Project Reviews — and streams it as XLSX.", "f-exp1"),
  numItem("Filename pattern: pms-{kind}-YYYY-MM-DD.xlsx. Date stamp comes from the backend.", "f-exp1"),
  numItem("A row is appended to export_audit_logs with user_id, data_type, row_count, and timestamp.", "f-exp1"),
  ptxt([{ text: "Important:", bold: true }, " filters in the UI are advisory only. The export always dumps the full authorised dataset regardless of which filters are applied. This is a deliberate design choice — HR runs exports for compliance, not for view-snippets."]),

  h3("5.7.2  Centralised Exports page"),
  numItem("HR_MyOrg opens Admin → Exports tab.", "f-exp2"),
  numItem("Sees a workbook section with FY checkboxes (current FY + three prior). All unchecked = all-time.", "f-exp2"),
  numItem("Clicks Export Workbook. Backend builds a single XLSX with five sheets (Users, Annual Goals, Annual Reviews, Projects, Project Reviews).", "f-exp2"),
  numItem("Users and Projects sheets ignore the FY filter (they're point-in-time snapshots). The other three honour it.", "f-exp2"),
  numItem("Filename: pms-workbook-FY{years}-YYYY-MM-DD.xlsx (FY infix only if filter is set).", "f-exp2"),

  h3("5.7.3  Per-employee export"),
  numItem("On the same Exports tab, second section is Per-Employee Export.", "f-exp3"),
  numItem("HR types or selects an employee name from the typeable picker (deactivated users appear as \"Name (deactivated)\").", "f-exp3"),
  numItem("Clicks Export Employee Record. Backend builds a 5-sheet workbook scoped to that one user: Profile (key/value), Annual Goals, Annual Reviews, Project Assignments (active + ended history), Project Reviews.", "f-exp3"),
  numItem("Filename: pms-employee-{name-slug}-YYYY-MM-DD.xlsx.", "f-exp3"),
  numItem("Useful for offboarding, transfers, and compliance asks.", "f-exp3"),

  h2("5.8  HR Dashboard"),
  numItem("HR_MyOrg or HR_Miltenyi opens /dashboard (default landing page after login).", "f-dash"),
  numItem("Page fetches a single batched payload from /dashboard/hr-summary that feeds all seven cards.", "f-dash"),
  numItem("Top right has an FY picker; default is the active FY. Options come from the backend (FYs that have data + the active FY).", "f-dash"),
  numItem("Changing the FY re-fetches; FY-scoped cards (the three funnels, Missing Reviews, Stalled Goals) update. Headcount and Mentor Coverage ignore FY (snapshots).", "f-dash"),
  numItem("Every card has a View All link to the corresponding tab (Annual Reviews, Annual Goals, Project Reviews, Admin → Users).", "f-dash"),
  numItem("Skeleton loaders show on each card during the fetch so the page doesn't reflow between loading and loaded states.", "f-dash"),

  pageBreak(),
];

// ── Section 6: System Settings & Admin Controls ───────────────────────
const sec6 = [
  h1("6. System Settings & Admin Controls"),
  p("HR_MyOrg controls these from Admin Panel → System Settings tab. Every setting has knock-on effects across the application; toggling one of these often changes what other roles can see or do."),

  h2("6.1  Cycle settings"),
  bulletMixed([{ text: "active_cycle_name", code: true }, " — the current performance cycle. Stamped onto every new annual review and project review at creation time. Example: \"Q1 FY26-27\"."]),
  bulletMixed([{ text: "cycle_type", code: true }, " — annual, half_yearly, or quarterly. Drives the cadence of project reviews."]),
  bulletMixed([{ text: "fiscal_start_month", code: true }, " — 1 to 12. Seeded value is 4 (April). Changing this mid-stream is not supported in practice — it would shift every cycle date range."]),

  h2("6.2  Submission and visibility flags"),
  bulletMixed([{ text: "goals_submission_open", code: true }, " — when false, Staff cannot submit a new annual goal (the Add Goal button hides)."]),
  bulletMixed([{ text: "reviews_submission_open", code: true }, " — when false, the project-review cycle is frozen (PMs see existing rows read-only)."]),
  bulletMixed([{ text: "annual_goals_edit_enabled", code: true }, " — controls the edit pencil on draft annual goals on the My Goals tab."]),
  bulletMixed([{ text: "project_ratings_visible", code: true }, " — controls whether Staff can see the performance group on their submitted project reviews. Many orgs prefer to hide this until calibration completes."]),
  bulletMixed([{ text: "annual_reviews_enabled", code: true }, " — master switch for the annual review feature. When false, the entire Annual Reviews page is unavailable."]),
  bulletMixed([{ text: "annual_review_final_rating_visible", code: true }, " — once management has set a final rating, this controls whether the Staff member sees it on their own review."]),

  h2("6.3  Demo / testing escape hatch"),
  bulletMixed([{ text: "cycle_window_override", code: true }, " — when true, the H1/H2 calendar gate is bypassed everywhere. A Staff member can file both H1 and H2 self-reviews in the same session even when the calendar says it's only H1. The seeded local environment has this turned on; production should always leave it off."]),
  pageBreak(),
];

// ── Section 7: Business Rules & Edge Cases ────────────────────────────
const sec7 = [
  h1("7. Business Rules & Edge Cases"),
  p("Specifics that shape behaviour but don't fit cleanly into a workflow. These are the kinds of things that will come up when you write detailed test cases."),

  h2("7.1  Submission windows"),
  p("Annual goals can be submitted only while the goals submission window is open. Project reviews can be filed only while the cycle's review window is open (cycle-specific). The cycle_window_override flag bypasses the H1/H2 review-window gate for goal self-reviews but does not bypass the goal submission window."),

  h2("7.2  HR_Miltenyi vs HR_MyOrg differences"),
  bullet("Both can read every annual goal, every annual review, every project review. Read scope is identical."),
  bullet("Only HR_MyOrg can edit Mentor and HR_MyOrg users. HR_Miltenyi can edit Staff and PM users."),
  bullet("Only HR_MyOrg can run Excel exports. The export buttons auto-hide for HR_Miltenyi on the frontend; the backend returns 403 if they try via the API directly."),
  bullet("Only HR_MyOrg can open the Management Review tab and publish final ratings."),
  bullet("Only HR_MyOrg can change system settings (the API enforces this even though both HR roles see the same admin pages)."),

  h2("7.3  Soft delete and historical data"),
  p("Users are never hard-deleted. Deactivating a user sets is_deleted=true. The user disappears from every dropdown but their historical goals, reviews, and project assignments remain. They count as inactive on the dashboard but still show up in Excel exports (Users sheet, with Is Active = No)."),
  p("Projects use the same pattern. ProjectReview rows have an is_deleted flag for stale rows that get cleaned up when a Staff's assignment ends before the cycle closes; the historical reviews themselves are never hard-deleted."),

  h2("7.4  Cross-cycle backfill"),
  p("A goal's H1 self-review can be filed any time during H1 OR H2 of the same FY. This is intentional — if the H1 window slipped and the mentee never filed, they can still backfill during H2. A H1 review cannot be filed once the FY itself has ended."),
  p("Project reviews don't backfill: a past cycle's project review is read-only after the cycle rotates."),

  h2("7.5  Cycle rotation effects"),
  p("Rotating the active cycle:"),
  bullet("Creates pending ProjectReview placeholders for every active project × team member in the new cycle."),
  bullet("Does not affect existing reviews (they stay tagged to their original cycle_name)."),
  bullet("Closes the review-write window on the previous cycle (PMs can no longer submit new reviews for it)."),

  h2("7.6  Mentor-pairing edge cases"),
  bullet("A Staff with mentor_id=null is \"unmentored\" — appears in the Mentor Coverage dashboard card."),
  bullet("A Staff whose mentor was deactivated (mentor.is_deleted=true) is also treated as unmentored — the dangling FK case."),
  bullet("Re-assigning a Staff's mentor does not transfer historical mentor reviews. The previous mentor's H1 review on that Staff's goal stays attached; the new mentor inherits responsibility for H2 onward."),

  h2("7.7  Project assignment edge cases"),
  bullet("A single Staff can hold multiple historical assignments to the same project — one ended, then a new active one. Only one may have end_date=NULL at any moment."),
  bullet("Ending an assignment mid-cycle keeps the in-flight review row in the PM's queue. The PM should still complete it (covering the period the Staff was on the project)."),
  bullet("Marking a project complete auto-ends every active assignment on the completion date. Re-opening does not auto-restore them."),

  h2("7.8  Visibility of ratings"),
  bullet("Final annual-review ratings are double-gated: the system-wide annual_review_final_rating_visible flag AND the per-review final_rating_enabled flag must both be true for the Staff to see their final rating."),
  bullet("Project review performance groups are gated by project_ratings_visible (a single system-wide flag)."),
  bullet("Mentors can always see their own mentor_performance_rating while writing the review — needed for the workflow."),

  h2("7.9  Cross-organisation guard"),
  p("Every read endpoint filters by current_user.org_id. Cross-org requests for a specific entity (e.g. GET /annual-reviews/{id} where the review's org_id differs from the caller's) return 404, not 403 — we don't want to leak the existence of records in other orgs."),

  pageBreak(),
];

// ── Section 8: Screen / Page Inventory ────────────────────────────────
const sec8 = [
  h1("8. Screen / Page Inventory"),
  p("Every page in the application, who can reach it, and what they can do once there. Used as a checklist when planning manual smoke walks."),

  table([
    ["Page (URL)", "Who can see it", "Key features"],
    ["/login", "Anyone", "Email + password login. Forgot Password link. Shows banner if redirected with ?reason=expired or ?reason=deactivated."],
    ["/reset-password?token=…", "Anyone with valid token", "Sets a new password using a one-time email token. Token expires in 15 minutes."],
    ["/change-password", "Logged-in user with must_change_password flag", "Forces a password change before the user can use the app. Used after admin-issued temp passwords."],
    ["/dashboard", "All logged-in users", "Role-aware landing. HR roles see the HR Dashboard (7 widgets). Other roles see a placeholder until per-role dashboards land."],
    ["/profile", "All logged-in users", "Read-only profile view: name, email, role, function, designation, mentor, phone. Includes a Change Password section."],
    ["/annual-goals", "Staff, Mentor, HR_MyOrg", "Tabs: My Goals (Staff/Mentor); Team Goals (Mentor); All Goals (HR_MyOrg). My Goals lets Staff create / submit / self-review. Team Goals lets Mentor approve / request changes / file H1 + H2 mentor reviews. All Goals is the HR org-wide listing."],
    ["/annual-reviews", "Staff, Mentor, HR_MyOrg", "Tabs: My Self Review (Staff); Team Reviews (Mentor); All Reviews (HR). Staff files Stage 1; Mentor writes Stage 2; HR runs Stage 3 via the Admin Panel's Management Review tab."],
    ["/project-reviews", "Staff, PM, Mentor, HR", "Tabs vary by role. Staff sees My Reviews (submitted-only). PM sees Primary Evaluation queue + Secondary Evaluation tab if they're a secondary on any project. Mentor sees Mentees' Reviews. HR sees All Reviews."],
    ["/mentees", "Mentor, HR_MyOrg", "Mentor sees their mentee roster as cards. Clicking a card opens the mentee detail page."],
    ["/mentees/{id}", "Mentor (for their mentees), HR_MyOrg (any)", "Per-mentee deep-dive: profile, annual goals, annual reviews, project assignments, project reviews. Mentors fill annual reviews from here."],
    ["/admin", "HR_MyOrg, HR_Miltenyi (limited)", "Admin Panel. Tabs: Users, Projects, Management Review (HR_MyOrg only), Exports (HR_MyOrg only), System Settings (HR_MyOrg only). Permissions per-row enforce who can edit what."],
    ["/unauthorized", "Anyone", "Fallback page when the user lands on a route their role isn't allowed to see. Manual navigation only — normal flows redirect cleanly."],
  ], [2700, 2200, 5180]),

  pageBreak(),
];

// ── Section 9: Testing Strategy ───────────────────────────────────────
const sec9 = [
  h1("9. Testing Strategy"),
  p("This section is the foundation for the test artefacts you'll own going forward. It describes what good test coverage looks like for this codebase and how to think about test cases."),

  h2("9.1  Test pyramid for PMS"),
  p("Three layers of testing, in increasing order of coverage and decreasing order of speed:"),
  bullet("Manual smoke walks — a per-role checklist run through the UI. Cheap, slow, catches the most regressions in early-stage features. Currently the primary test surface."),
  bullet("Automated frontend tests — limited today; the codebase has TypeScript + ESLint guarding compile-time correctness but no runtime test suite. An opportunity to add."),
  bullet("Automated backend tests — partial pytest coverage on the more complex business-rule endpoints. Adding more is high-value because the rules are easy to specify and the routes are easy to invoke."),

  h2("9.2  How to think about a test case"),
  p("Every test case has three parts:"),
  bullet("Pre-conditions — what state the system is in before the test runs (e.g. \"a Staff has a draft annual goal, no submissions yet\")."),
  bullet("Action — the single user-facing action the test exercises (e.g. \"Staff clicks Submit on the goal\")."),
  bullet("Expected outcome — what should happen (status change, navigation, error message, etc.)."),
  p("Aim for test cases that fit on one screen. If you can't, the action is probably too big — split it."),

  h2("9.3  Coverage by role"),
  p("For every meaningful workflow in Section 5, you should be able to walk through it end-to-end as the relevant role. The seed data is structured to make this easy: each seeded role has at least one user, and the data is staged so that the first action you'd take naturally surfaces interesting state."),
  p("Recommended weekly smoke walks (each takes 5–10 minutes):"),
  bullet("Login + session expiry — verify the 30-min sliding behaviour, the expired/deactivated banners, the change-password flow."),
  bullet("Annual goal lifecycle as Staff — draft → submit → see it land on the Mentor's tab."),
  bullet("Annual goal approval as Mentor — approve, then request changes on a different goal, then file an H1 mentor review."),
  bullet("Project review as PM — write a fresh review, edit a submitted one."),
  bullet("Annual review calibration as HR_MyOrg — set a management override + final rating + toggle visibility."),
  bullet("HR Dashboard sanity — change FY, confirm all cards re-fetch, click View All links and confirm they land on the right tab."),
  bullet("Export bundle — download the centralised workbook + a per-employee bundle; open both in Excel; check that key columns are populated."),

  h2("9.4  Regression checklist for releases"),
  p("Before any merge to main, the matrix below should be walked at least once. The seed accounts make this fast — log in as each role in turn and click through."),
  bullet("As Staff: write a draft goal; submit; check it appears on Mentor's Team Goals."),
  bullet("As Mentor: approve a pending goal; verify status moves to approved on Staff's tab."),
  bullet("As Staff: file H1 self-review; check it appears on Mentor's Team Goals for response."),
  bullet("As Mentor: file H1 mentor review; status reaches h1_mentor_reviewed."),
  bullet("As PM: open Primary Evaluation queue; write a review for a Staff; submit. Verify the Staff sees the review under My Reviews."),
  bullet("As Secondary Evaluator: add an impact statement on a reviewed project review."),
  bullet("As HR_MyOrg: deactivate a user; reactivate them; reset a password; verify the temp-password modal appears."),
  bullet("As HR_MyOrg: open Exports tab; download a workbook; download a per-employee export. Verify audit log row appears."),
  bullet("As HR_MyOrg: open Management Review tab; set a management rating; toggle final_rating_enabled."),
  bullet("As HR (either role): verify HR Dashboard loads, all seven cards populate, FY picker works."),

  h2("9.5  Where to file test artefacts"),
  bullet("Manual test cases — your call. A shared spreadsheet or a Confluence page is common. The shape we suggest: one row per test case, columns for pre-condition, action, expected outcome, role, and status."),
  bullet("Bug reports — GitHub issues on the project repo. Reproduction steps should map back to a workflow number from Section 5 of this guide."),
  bullet("Regression checklists — markdown files in docs/ or a tracker like Trello. Keep them living documents."),

  pageBreak(),
];

// ── Section 10: Local Setup ───────────────────────────────────────────
const sec10 = [
  h1("10. Local Setup"),
  p("How to run the application on your machine and what data you'll see after seeding. Aimed at a non-developer — ask a teammate to walk you through the first install if the commands look unfamiliar."),

  h2("10.1  Prerequisites"),
  bullet("Python 3.12 (the version used in development)."),
  bullet("Node.js 20 or newer."),
  bullet("Git (to clone the repository)."),
  bullet("An IDE or text editor — VS Code is what the team uses."),

  h2("10.2  First-time backend setup"),
  numItem("Clone the repository and open a terminal in the backend folder.", "f-setupb"),
  numItem("Create a Python virtual environment: python -m venv venv", "f-setupb"),
  numItem("Activate it. On Windows: venv\\Scripts\\activate. On macOS / Linux: source venv/bin/activate", "f-setupb"),
  numItem("Install dependencies: pip install -r requirements.txt", "f-setupb"),
  numItem("Copy .env.example to .env (or ask a teammate for the development .env contents).", "f-setupb"),
  numItem("Apply database migrations: python -m alembic upgrade head", "f-setupb"),
  numItem("Seed the database: python seed.py — creates the org, users, projects, goals, reviews described in section 10.4.", "f-setupb"),
  numItem("Start the backend: uvicorn main:app --reload — by default it listens on http://localhost:8000.", "f-setupb"),

  h2("10.3  First-time frontend setup"),
  numItem("Open a separate terminal in the frontend folder.", "f-setupf"),
  numItem("Install dependencies: npm install", "f-setupf"),
  numItem("Start the dev server: npm run dev — usually listens on http://localhost:5173 or http://localhost:5175.", "f-setupf"),
  numItem("Open the URL it prints in a browser; you'll land on the Login page.", "f-setupf"),

  h2("10.4  Seed test accounts"),
  p("After running seed.py, all accounts below have the password password123. Logging in as each role gives you a complete view of the system."),

  h3("10.4.1  HR accounts"),
  table([
    ["Email", "Name", "Role", "What you can do as them"],
    ["sarah.patel@healthark.ai", "Sarah Patel", "HR_MyOrg", "Full super-admin. Everything HR-side: users, projects, exports, calibration, dashboard."],
    ["karin.weber@miltenyi.com", "Karin Weber", "HR_Miltenyi", "Read every record but can't edit Mentors / HR_MyOrg users and can't run exports."],
  ], [2800, 1700, 1500, 4080]),

  h3("10.4.2  Mentor accounts"),
  table([
    ["Email", "Name", "Role", "Mentees"],
    ["anjali.rao@healthark.ai", "Anjali Rao", "Mentor", "Bob Builder, Charlie Chemist, Dana DNA"],
    ["mark.singh@healthark.ai", "Mark Singh", "Mentor", "Iris Immel, Evan Engineer, Fiona Factory"],
    ["priya.mehta@healthark.ai", "Priya Mehta", "Mentor", "Klaus Köhler, Mia Markt, Nils Niedermeier"],
  ], [2800, 1700, 1500, 4080]),

  h3("10.4.3  PM accounts"),
  table([
    ["Email", "Name", "Function", "Projects they manage"],
    ["hans@miltenyi.com", "Hans Müller", "R&D", "MIL-PRJ-101 (completed), MIL-PRJ-103"],
    ["greta@miltenyi.com", "Greta Schmidt", "Manufacturing", "MIL-PRJ-102"],
    ["lukas@miltenyi.com", "Lukas Lange", "Commercial", "MIL-PRJ-104"],
    ["dieter@miltenyi.com", "Dieter Becker", "R&D", "(reserve — no active projects)"],
  ], [2500, 1700, 1800, 4080]),

  h3("10.4.4  Staff accounts"),
  table([
    ["Email", "Name", "Function / Designation", "Mentor", "On projects"],
    ["bob@miltenyi.com",     "Bob Builder",         "R&D / Senior Scientist",   "Anjali Rao",  "MIL-PRJ-101"],
    ["charlie@miltenyi.com", "Charlie Chemist",     "R&D / Scientist",          "Anjali Rao",  "MIL-PRJ-101, MIL-PRJ-103 (two stints)"],
    ["dana@miltenyi.com",    "Dana DNA",            "R&D / Scientist",          "Anjali Rao",  "MIL-PRJ-101, MIL-PRJ-103"],
    ["iris@miltenyi.com",    "Iris Immel",          "R&D / Senior Scientist",   "Mark Singh",  "MIL-PRJ-103"],
    ["evan@miltenyi.com",    "Evan Engineer",       "Mfg / Team Lead",          "Mark Singh",  "MIL-PRJ-102"],
    ["fiona@miltenyi.com",   "Fiona Factory",       "Mfg / Scientist",          "Mark Singh",  "MIL-PRJ-102"],
    ["klaus@miltenyi.com",   "Klaus Köhler",        "Mfg / Scientist",          "Priya Mehta", "MIL-PRJ-102"],
    ["mia@miltenyi.com",     "Mia Markt",           "Commercial / Sr Scientist","Priya Mehta", "MIL-PRJ-104"],
    ["nils@miltenyi.com",    "Nils Niedermeier",    "Commercial / Scientist",   "Priya Mehta", "MIL-PRJ-104"],
  ], [2100, 1700, 2300, 1450, 2530]),

  h2("10.5  What state the seed data is in"),
  p("The seed deliberately stages mixed states so you can exercise every workflow without re-running:"),
  bullet("MIL-PRJ-101 has been marked Completed (2025-09-01). All three of its assignments are end-dated. Useful for testing the completed-project read flow."),
  bullet("Charlie has two assignment rows on MIL-PRJ-103: one ended 2026-04-30, one active starting 2026-06-01. Useful for testing the re-join flow."),
  bullet("Annual goals span every approval state: drafts (Dana, Klaus), pending approval (Charlie, Fiona, Nils), approved with H1 self-review filed (Bob, Evan, Mia), approved with no review yet (Iris)."),
  bullet("Annual reviews for FY25-26 are fully completed across all Staff (history). FY26-27 reviews span draft, pending mentor, and pending management states."),
  bullet("Project reviews for Q1 FY26-27 are mostly pending; two are reviewed (Charlie on PRJ-101, Fiona on PRJ-102)."),

  pageBreak(),
];

// ── Section 11: Glossary ──────────────────────────────────────────────
const sec11 = [
  h1("11. Glossary & Acronyms"),
  p("Skim once; come back when a term in another section feels unfamiliar."),

  table([
    ["Term", "Definition"],
    ["Active cycle", "The current performance cycle as stamped on system settings. Drives which reviews are open for writing."],
    ["Approval status", "The state of an annual goal in its lifecycle. One of: draft, pending_approval, changes_requested, approved, h1_self_reviewed, h1_mentor_reviewed, h2_self_reviewed, h2_mentor_reviewed (and Q1..Q4 equivalents on quarterly orgs)."],
    ["Calibration", "Stage 3 of the annual review where HR_MyOrg compares mentor ratings across the org and assigns a final rating."],
    ["Cycle (project review)", "A time window during which a PM writes project reviews. Half-yearly orgs have two per FY (H1, H2); quarterly orgs have four (Q1–Q4); annual orgs have one."],
    ["Cycle_window_override", "Demo flag on system settings that bypasses the H1/H2 calendar gate on goal self-reviews. Production should leave false."],
    ["Designation", "Seniority level: Scientist, Senior Scientist, Team Lead, or Director."],
    ["Final rating", "The published performance rating from the annual review. Visible to the Staff only when both system and per-row visibility flags are true."],
    ["Function", "Broad area of work: R&D, Manufacturing, Commercial."],
    ["FY (Fiscal Year)", "April through March. FY26-27 = April 2026 through March 2027."],
    ["H1 / H2", "Two halves of a fiscal year. H1 = April–September, H2 = October–March."],
    ["HR_Miltenyi", "Client-side HR role. Read-everything, edit-Staff/PM only. No exports."],
    ["HR_MyOrg", "Healthark super-admin role. Full read + write everywhere."],
    ["JWT", "JSON Web Token. The session token issued at login, stored in an HttpOnly cookie, expires after 30 minutes idle."],
    ["Management Review tab", "Admin Panel tab where HR_MyOrg calibrates annual reviews. Stage 3."],
    ["Mentor", "Healthark career sponsor. Permanently paired with a roster of Staff mentees."],
    ["Mentee", "Staff member from the perspective of their Mentor."],
    ["Org (organisation)", "Tenant boundary. Every row in the database carries an org_id. The seeded environment has one org (\"Miltenyi\")."],
    ["Performance group", "1–5 numeric rating on a project review. 1 = best."],
    ["PM", "Project Manager. Miltenyi-side role that owns a project and writes project reviews on its team."],
    ["Primary Evaluation", "Tab where a PM writes project reviews. The \"primary\" is the PM themself (as opposed to the optional Secondary evaluator)."],
    ["Project assignment", "A row linking a Staff to a Project for a date range. May have end_date = NULL (active) or a past date (ended stint)."],
    ["Role Expectation", "Eight competency-level expectation paragraphs scoped to a (function × designation) pair. Used as a rubric reference while writing reviews."],
    ["Secondary Evaluator", "Optional second reviewer on a project. Adds an impact statement only, no ratings or competency comments."],
    ["Staff", "The role being measured. Has goals, files self-reviews, receives project + annual reviews."],
    ["Sliding session", "The 30-minute JWT expiry that resets to a fresh 30 on every authenticated request. User stays logged in as long as they're active."],
    ["Soft delete", "Logical delete via is_deleted=true. Row stays in the database; the user disappears from active views."],
    ["Stalled goal", "An annual goal sitting in pending_approval for more than 7 days (currently the hardcoded threshold)."],
    ["Unmentored Staff", "A Staff whose mentor_id is null or points to a deactivated mentor. Blocked from goal / review actions until reassigned."],
  ], [2600, 7480]),

  pageBreak(),
];

// ── Section 12: Where to find things ──────────────────────────────────
const sec12 = [
  h1("12. Where to Find Things"),
  p("A pointer-only map. Tech terms appear here for the first time deliberately — these are landmarks you'll be asked about by developers, even if you're not editing the code yourself."),

  h2("12.1  Repository structure"),
  bulletMixed([{ text: "backend/", code: true }, " — Python FastAPI server. Contains the database models (app/models), API routes (app/api/routes), service modules (app/services), and the Alembic migration history (alembic/versions)."]),
  bulletMixed([{ text: "frontend/", code: true }, " — React + TypeScript single-page app. Contains all the pages and components."]),
  bulletMixed([{ text: "docs/", code: true }, " — this file lives here, alongside any other shared documents (Testing Guide, etc.)."]),
  bulletMixed([{ text: "backend/seed.py", code: true }, " — the deterministic dev seed script. Re-running it is idempotent — it tops up missing pieces without duplicating existing ones."]),

  h2("12.2  Backend module landmarks"),
  bulletMixed([{ text: "app/api/routes/auth_routes.py", code: true }, " — login, logout, session, password reset."]),
  bulletMixed([{ text: "app/api/routes/admin_routes.py", code: true }, " — user CRUD, system settings."]),
  bulletMixed([{ text: "app/api/routes/goal_routes.py", code: true }, " — annual goals end-to-end."]),
  bulletMixed([{ text: "app/api/routes/annual_review_routes.py", code: true }, " — annual review three-stage workflow."]),
  bulletMixed([{ text: "app/api/routes/project_review_routes.py", code: true }, " — PM evaluation + secondary statements."]),
  bulletMixed([{ text: "app/api/routes/project_routes.py", code: true }, " — project + assignment CRUD."]),
  bulletMixed([{ text: "app/api/routes/dashboard_routes.py", code: true }, " — HR Dashboard's batched endpoint."]),
  bulletMixed([{ text: "app/api/routes/export_routes.py", code: true }, " — every Excel export endpoint."]),
  bulletMixed([{ text: "app/core/cycle_utils.py", code: true }, " — fiscal year math; the canonical place for any date-window question."]),

  h2("12.3  Frontend page landmarks"),
  bulletMixed([{ text: "frontend/src/pages/Login.tsx", code: true }, " — login + forgot password."]),
  bulletMixed([{ text: "frontend/src/pages/HrDashboard.tsx", code: true }, " — HR dashboard page."]),
  bulletMixed([{ text: "frontend/src/pages/AnnualGoals.tsx", code: true }, " — goals page with all three tabs."]),
  bulletMixed([{ text: "frontend/src/pages/AnnualReviews.tsx", code: true }, " — reviews page."]),
  bulletMixed([{ text: "frontend/src/pages/ProjectReviews.tsx", code: true }, " — project reviews page."]),
  bulletMixed([{ text: "frontend/src/pages/AdminPanel.tsx", code: true }, " — admin panel with all sub-tabs."]),
  bulletMixed([{ text: "frontend/src/pages/MenteeDetail.tsx", code: true }, " — per-mentee deep dive."]),

  h2("12.4  Useful side documents"),
  bulletMixed([{ text: "docs/Miltenyi-PMS-Testing-Guide.docx", code: true }, " — separate stakeholder testing walkthrough. Older; use it as a complement to this guide, not a replacement."]),
  bulletMixed([{ text: "Git history", code: true }, " — every PR has a description that's usually a short feature spec. Worth skimming when you need historical context."]),

  h2("12.5  When you get stuck"),
  p("Three escalation paths, in order:"),
  numItem("Check this guide first — section 11 (Glossary) and section 5 (Workflows) cover most questions.", "f-stuck"),
  numItem("Search the repository — every business rule is commented inline in the route file that implements it.", "f-stuck"),
  numItem("Ask a teammate. The codebase has a habit of leaving long, prose-heavy comments in the source files; if a feature seems opaque, the comment near it is almost certainly the design rationale.", "f-stuck"),

  blank(),
  p("Welcome to the team — and happy testing.", { italics: true, alignment: AlignmentType.CENTER }),
];

// ── Assemble the document ─────────────────────────────────────────────
const children = [
  ...titlePage,
  ...aboutDoc,
  ...sec1,
  ...sec2,
  ...sec3,
  ...sec4,
  ...sec5,
  ...sec6,
  ...sec7,
  ...sec8,
  ...sec9,
  ...sec10,
  ...sec11,
  ...sec12,
];

const doc = new Document({
  creator: "Healthark IDT",
  title: "Miltenyi PMS — Onboarding Guide",
  description: "Comprehensive onboarding document for the new requirements / QA owner of the Miltenyi PMS.",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: FONT, color: "1F4E79" },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: "2E75B6" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: FONT, color: "404040" },
        paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
      // One independent reference per workflow so numbering restarts per flow.
      { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-login",   levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-expiry",  levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-forgot",  levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-dactv",   levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-onboard", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-projcre", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-aend",    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-complete",levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-reopen",  levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-rejoin",  levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-goal",    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-goalapp", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-changes", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-h1",      levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-h2",      levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-ar1",     levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-ar2",     levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-ar3",     levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-pr1",     levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-pr2",     levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-pr3",     levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-pr4",     levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-exp1",    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-exp2",    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-exp3",    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-dash",    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-setupb",  levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-setupf",  levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
      { reference: "f-stuck",   levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: "Miltenyi PMS — Onboarding Guide", italics: true, color: "808080", size: 18 })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Page ", color: "808080", size: 18 }),
            new TextRun({ children: [PageNumber.CURRENT], color: "808080", size: 18 }),
          ],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.resolve(__dirname, "Miltenyi-PMS-Onboarding-Guide.docx");
  fs.writeFileSync(out, buf);
  console.log("Wrote", out, "(" + buf.length + " bytes)");
});
