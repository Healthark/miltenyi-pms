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
  mentees: {
    all: ["mentees"] as const,
    summaries: () => [...queryKeys.mentees.all, "summaries"] as const,
  },

  // ── Annual review rows ─────────────────────────────────────────────
  // `mine` = the caller's own history. `org` = HR's view of every
  // review across the org (was `'all'` in the inline-keys era; renamed
  // to `'org'` to disambiguate from the factory's `.all` broadcast
  // accessor — see PR #23 doc Part 2 for the rationale).
  annualReviews: {
    all: ["annual-reviews"] as const,
    mine: () => [...queryKeys.annualReviews.all, "mine"] as const,
    org: () => [...queryKeys.annualReviews.all, "org"] as const,
    mentees: () => [...queryKeys.annualReviews.all, "mentees"] as const,
  },

  // ── Goal rows ──────────────────────────────────────────────────────
  // `mine(type)` covers both annual and project goal types — parameter
  // is part of the key, so switching tabs lazily creates a new cache
  // entry. `org` is HR's view (renamed from `'all'`, see above).
  goals: {
    all: ["goals"] as const,
    mine: (type: "annual" | "project" = "annual") =>
      [...queryKeys.goals.all, "mine", type] as const,
    org: () => [...queryKeys.goals.all, "org"] as const,
    mentees: () => [...queryKeys.goals.all, "mentees"] as const,
  },

  // ── Profile-scoped resources (role expectations, etc.) ─────────────
  profile: {
    all: ["profile"] as const,
    expectations: () => [...queryKeys.profile.all, "expectations"] as const,
  },
} as const;
