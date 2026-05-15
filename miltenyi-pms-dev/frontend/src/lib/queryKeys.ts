/**
 * queryKeys — single source of truth for every TanStack Query cache key.
 *
 * Why this exists:
 *   1. TypeScript catches typos at every call site (queryKeys.aadmin won't
 *      compile; ["adminn", "users"] silently creates a new cache entry).
 *   2. Renaming a namespace is safe — find-all-references inside the
 *      factory replaces every consumer.
 *   3. The hierarchy is documented in ONE place; future contributors don't
 *      have to grep for "what keys exist?"
 *   4. Encourages prefix-style broadcast invalidation via the `.all`
 *      properties (see Pattern 3 below).
 *
 * Structure (per namespace):
 *   - `.all`  — the namespace root tuple. Use for broadcast invalidation:
 *               queryClient.invalidateQueries({ queryKey: queryKeys.goals.all })
 *               catches every cache entry under ['goals', ...] regardless
 *               of depth.
 *   - methods — return literal tuples for specific cache entries. Always
 *               typed with `as const` so the array remains a tuple (which
 *               TanStack's structural matcher relies on for key equality).
 *
 * Usage:
 *   useQuery({ queryKey: queryKeys.admin.users(), queryFn: ... })
 *   useMutation({ ..., onSuccess: () => {
 *     queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
 *   }})
 *   queryClient.setQueryData(queryKeys.admin.settings(), updatedRow);
 *
 * Adding a new key:
 *   1. Add a method to the appropriate namespace (or create a new
 *      namespace if it doesn't fit). Follow the existing pattern:
 *      `name: (params?) => [...nsAll, 'literal', ...params] as const`
 *   2. Use it at the call site. TS will catch missing args.
 *
 * Self-reference note:
 *   The methods reference `queryKeys.<ns>.all` inside their own object
 *   literal. TypeScript allows this because the method bodies execute
 *   AFTER the object is fully defined; they're never evaluated during
 *   the literal's construction. This is the pattern recommended in
 *   TanStack Query's own docs.
 */

export const queryKeys = {
  // ── Admin panel resources ──────────────────────────────────────────
  admin: {
    all: ["admin"] as const,
    users: () => [...queryKeys.admin.all, "users"] as const,
    functions: () => [...queryKeys.admin.all, "functions"] as const,
    designations: () => [...queryKeys.admin.all, "designations"] as const,
    settings: () => [...queryKeys.admin.all, "settings"] as const,
  },

  // ── Dashboard summaries ────────────────────────────────────────────
  // `summary()` is the Staff/Mentor personal summary. `hrSummary(fy)`
  // is the HR org-wide rollup, parameterized by fiscal start year so
  // each FY has its own cache entry.
  dashboard: {
    all: ["dashboard"] as const,
    summary: () => [...queryKeys.dashboard.all, "summary"] as const,
    hrSummary: (fy: number | null) =>
      [...queryKeys.dashboard.all, "hr-summary", fy] as const,
  },

  // ── Mentor's mentees ───────────────────────────────────────────────
  // `summaries` is the mentor's roster (used by both /my-mentees and the
  // MentorDashboard — cross-page cache sharing).
  // `pairings` is HR_MyOrg's org-wide grouped view (every mentor + their
  // mentees nested).
  // `detail(id)` is the per-mentee profile (dynamic key — each mentee
  // gets its own cache entry; switching between two mentees is instant
  // on revisit).
  mentees: {
    all: ["mentees"] as const,
    summaries: () => [...queryKeys.mentees.all, "summaries"] as const,
    pairings: () => [...queryKeys.mentees.all, "pairings"] as const,
    detail: (id: number) =>
      [...queryKeys.mentees.all, "detail", id] as const,
  },

  // ── Annual review rows ─────────────────────────────────────────────
  // `mine` = the caller's own history. `org` = HR's view of every
  // review across the org (was `'all'` in the inline-keys era; renamed
  // to `'org'` to disambiguate from the factory's `.all` broadcast
  // accessor — see PR #23 doc Part 2 for the rationale).
  annualReviews: {
    all: ["annual-reviews"] as const,
    mine: () => [...queryKeys.annualReviews.all, "mine"] as const,
    /** HR_MyOrg's org-wide "All Reviews" cache entry. Filters are baked
     *  into the key (PR #43, doc 26) so each filter combination is its
     *  own paginated cache entry. Passing `{}` (or no argument) is the
     *  "no filter" universe — TanStack Query deep-equals the key, so
     *  `org()` and `org({})` resolve to the same entry. Existing
     *  broadcast invalidations on `queryKeys.annualReviews.all` still
     *  catch every filter-variant of this key. */
    org: (filters: Record<string, string | undefined> = {}) =>
      [...queryKeys.annualReviews.all, "org", filters] as const,
    /** Mentor's mentees' annual reviews. Filter set baked into the key
     *  (PR #46, doc 29) so each filter combination is its own cache
     *  entry; broadcast invalidation on `annualReviews.all` catches
     *  every variant. */
    mentees: (filters: Record<string, string | number | undefined> = {}) =>
      [...queryKeys.annualReviews.all, "mentees", filters] as const,
    /** Management Review calibration grid — every annual review in the
     *  active FY for HR to publish management ratings on. Filter set
     *  baked into the key (PR #46, doc 29). */
    calibration: (filters: Record<string, string | undefined> = {}) =>
      [...queryKeys.annualReviews.all, "calibration", filters] as const,
    /** Per-review detail (full text + ratings), dynamic key. Used by
     *  the ManagementReview Rate modal to load self + mentor narratives
     *  alongside the rating selector. */
    detail: (id: number) =>
      [...queryKeys.annualReviews.all, "detail", id] as const,
  },

  // ── Goal rows ──────────────────────────────────────────────────────
  // `mine(type)` covers both annual and project goal types — parameter
  // is part of the key, so switching tabs lazily creates a new cache
  // entry. `org` is HR's view (renamed from `'all'`, see above).
  goals: {
    all: ["goals"] as const,
    mine: (type: "annual" | "project" = "annual") =>
      [...queryKeys.goals.all, "mine", type] as const,
    /** HR_MyOrg's "All Goals" cache entry. Filters are baked into the
     *  key (PR #44, doc 27) so each filter combination is its own
     *  paginated cache entry. Same shape as `annualReviews.org` (doc
     *  26). Broadcast invalidations on `queryKeys.goals.all` still
     *  catch every filter-variant of this key. */
    org: (filters: Record<string, string | number | undefined> = {}) =>
      [...queryKeys.goals.all, "org", filters] as const,
    mentees: () => [...queryKeys.goals.all, "mentees"] as const,
  },

  // ── Profile-scoped resources (role expectations, etc.) ─────────────
  profile: {
    all: ["profile"] as const,
    expectations: () => [...queryKeys.profile.all, "expectations"] as const,
  },

  // ── System settings (public read view) ─────────────────────────────
  // The org-wide settings endpoint (/settings/) every page reads to
  // render banners, gates, and cycle text. Distinct from
  // `admin.settings()` (which hits the HR-only /admin/settings endpoint
  // with extra fields like simulation_allowed) — different responses,
  // different cache entries. After a save on /admin/settings, the
  // AdminPanel mutation invalidates both keys.
  systemSettings: {
    all: ["system-settings"] as const,
    current: () => [...queryKeys.systemSettings.all, "current"] as const,
  },

  // ── Project review rows ────────────────────────────────────────────
  // The five page-level reads on /project-reviews. The PM and secondary
  // mutation flows live in child tabs (PrimaryEvaluationTab,
  // SecondaryEvalTab) which will add their own keys (pmQueue, single
  // review detail) when those components are migrated in their own PRs.
  //
  // Note: this namespace's `roleExpectations` is project-scoped (covers
  // exp_task_execution, exp_ownership, etc.) and is distinct from
  // `profile.expectations` which is the annual-goal role-level
  // expectation. Separate endpoints, separate cache entries.
  projectReviews: {
    all: ["project-reviews"] as const,
    mine: () => [...queryKeys.projectReviews.all, "mine"] as const,
    mentees: () => [...queryKeys.projectReviews.all, "mentees"] as const,
    /** HR's "All Reviews" cache entry. Filters are baked into the key
     *  (PR #45, doc 28) so each filter combination is its own
     *  paginated cache entry. Same shape as `annualReviews.org()` and
     *  `goals.org()`. Broadcast invalidations on `projectReviews.all`
     *  still catch every variant. */
    org: (filters: Record<string, string | undefined> = {}) =>
      [...queryKeys.projectReviews.all, "org", filters] as const,
    /** PM's queue of pending evaluations on their projects. Consumed by
     *  PrimaryEvaluationTab; not pre-warmed by any parent (the PM tab
     *  is the first thing that asks for it). */
    pmQueue: () => [...queryKeys.projectReviews.all, "pm-queue"] as const,
    /** Secondary evaluator's queue. The ProjectReviews page (PR #07)
     *  fires a probe query on this key for tab-visibility; when
     *  SecondaryEvalTab mounts it reads the same cache entry — the
     *  probe pre-warmed it. Cache-warming probe pattern, doc #07. */
    secondaryQueue: () =>
      [...queryKeys.projectReviews.all, "secondary-queue"] as const,
    roleExpectations: () =>
      [...queryKeys.projectReviews.all, "role-expectations"] as const,
    /** Per-review detail (full ProjectReviewResponse including
     *  secondary_evaluations list). Used by MenteeProjectsTab's
     *  impact-statement modal — fetched on demand when the modal
     *  opens, since row data only carries the lightweight summary. */
    detail: (id: number) =>
      [...queryKeys.projectReviews.all, "detail", id] as const,
  },
} as const;
