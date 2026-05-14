# Frontend Optimizations

A running log of every production-readiness change we make to the frontend, written for *learning*. Each doc walks you through:

- **The problem** — what was wrong and how to recognize it in any project
- **The concepts** — what the underlying web/React/build-tool idea actually is
- **The change** — exactly what we edited, with diffs
- **The measurement** — before/after numbers so the improvement is real, not folklore
- **The trade-offs** — what we gave up to get the win

Read top-to-bottom in numeric order if you're learning the topic for the first time. Jump to a single file if you're refreshing your memory.

---

## Index

| # | Title | PR | Headline metric |
|---|---|---|---|
| [01](./01-bundle-splitting-and-lazy-routes.md) | Bundle splitting + lazy routes + vendor chunks | [#18](https://github.com/Healthark/miltenyi-pms/pull/18) | Initial JS download: **185 KB → 67 KB** gzip (−64%) before vendor chunks; per-deploy invalidation **−87%** after vendor chunks |
| [02](./02-server-state-caching.md) | Server-state caching with TanStack Query | [#19](https://github.com/Healthark/miltenyi-pms/pull/19) | Cache + dedup + stale-while-revalidate on three Dashboard variants; +10 KB gzip vendor cost for the foundation |
| [03](./03-admin-panel-mutations.md) | AdminPanel mutations with `useMutation` + `invalidateQueries` | [#20](https://github.com/Healthark/miltenyi-pms/pull/20) | 4 user mutations + 1 settings mutation migrated; cross-component refresh, mutate vs mutateAsync, setQueryData vs invalidate |
| [04](./04-annual-reviews-migration.md) | AnnualReviews + TeamReviewTab migration: role-gated queries with `enabled` | [#21](https://github.com/Healthark/miltenyi-pms/pull/21) | Two role-gated queries, two write mutations, one cross-key invalidation pattern (`['annual-reviews', 'mine'\|'all']`) |
| [05](./05-annual-goals-migration.md) | AnnualGoals migration with broadcast-key invalidation + `setQueryData` hot path | [#22](https://github.com/Healthark/miltenyi-pms/pull/22) | 3 queries, 5 mutations, broadcast invalidation via `['goals']` parent key, criterion-toggle hot path uses `setQueryData` for instant feedback |
| [06](./06-query-keys-factory.md) | Query keys factory: single source of truth for every cache key | [#23](https://github.com/Healthark/miltenyi-pms/pull/23) | New `src/lib/queryKeys.ts` typed factory; ~25 call sites migrated; literal `'all'` renamed to `'org'` in two namespaces for clarity |
| [07](./07-project-reviews-migration.md) | ProjectReviews migration: 5 role-gated queries + cache-warming probe pattern | [#24](https://github.com/Healthark/miltenyi-pms/pull/24) | 5 useQuery calls (4 role-gated, 1 universal probe); `hasSecondaryWork` derived from cached data instead of a separate state flag |
| [08](./08-mentee-pages-migration.md) | MyMentees + MenteeDetail: dynamic-key queries, cross-page cache sharing, finishing deferred mentor-eval mutations | [#25](https://github.com/Healthark/miltenyi-pms/pull/25) | 3 queries (one with dynamic `menteeId` key), 2 mutations finally landed (mentor eval submit + draft save), `isPending` vs `isFetching` distinction makes the `silent: true` reload pattern unnecessary |
| [09](./09-management-review-migration.md) | ManagementReview: on-demand modal-driven query + the rating-publish mutation | [#26](https://github.com/Healthark/miltenyi-pms/pull/26) | Last page-level migration. 2 queries (grid + dynamic-key detail), 1 mutation. The Rate-modal detail query is `enabled`-gated on the modal being open — pattern for "fetch only when user opens this surface" |
| [10](./10-goal-approval-flow-migration.md) | Goal-approval child components: TeamGoalsTab + MenteeGoalsTab | [#27](https://github.com/Healthark/miltenyi-pms/pull/27) | First child-component PR after the page-level milestone. 1 query + 7 mutations migrated; MenteeGoalsTab swaps `onReload` prop for `menteeId` + self-managed cache invalidation; CriteriaChecklist stays imperative on purpose (hot-path concern) |
| [11](./11-project-review-writes-migration.md) | Project-review writes: PrimaryEvaluationTab + SecondaryEvalTab | [#28](https://github.com/Healthark/miltenyi-pms/pull/28) | 3 queries + 6 mutations across two PM/Secondary tabs. **Cache-warming probe payoff** finally realized: PR #07's secondary-queue probe was warming this very tab's cache entry |
| [12](./12-mentee-projects-tab-migration.md) | MenteeProjectsTab: last `onReload` bridge unwound, both PM and Secondary flows in one component | [#29](https://github.com/Healthark/miltenyi-pms/pull/29) | 2 queries (1 dynamic-key on-demand) + 6 mutations. The bridge callback pattern from PR #25 fully unwinds — `reloadDetail` deleted from MenteeDetail. Render-time derivation replaces useState+useEffect for one-way data flow |
| [13](./13-use-review-details-migration.md) | `useReviewDetails` hook: useReducer → useQuery | [#30](https://github.com/Healthark/miltenyi-pms/pull/30) | Custom hook internals migrated; preserves the public `{ details, isFetching, error }` contract so consumers don't change. EvalDrawer needed no migration (pure presentational shell — its mutations were already done in PR #25). Bundle: ProjectReviews −0.16 KB gzip |
| [14](./14-system-settings-provider-migration.md) | **SystemSettingsProvider: context-cache → useQuery (rollout complete 🏁)** | [#31](https://github.com/Healthark/miltenyi-pms/pull/31) | Final TanStack Query migration. Replaces hand-rolled useState+useEffect+useCallback machinery with `useQuery`; preserves `{ settings, isLoading, error, refreshSettings }` context API so 23 consumers and 1 mutation call site (AdminPanel) need zero changes |
| [15](./15-virtualization-management-review.md) | **Virtualization (theme #2 opener): ManagementReview calibration grid** | [#32](https://github.com/Healthark/miltenyi-pms/pull/32) | New theme arc — scaling. Installed `@tanstack/react-virtual`, refactored ManagementReview's table to a CSS-Grid + virtualized div structure. At 1000 staff: renders ~27 rows in DOM instead of 1000. Bundle: +5.86 KB gzip (vendor-cached one-time cost) |
| [16](./16-variable-height-virtualization.md) | Variable-height virtualization: AnnualReviews AllReviewsTab | _pending_ | `measureElement` pattern — rows have inline expanded narrative panels (variable text length). ResizeObserver fires → virtualizer total updates → scrollbar adjusts. Bundle: +0.40 KB gzip (library already installed in PR #15) |

---

## Conventions

- **Numbered prefix** = the chronological order we made the change. Read 01 before 02 before 03 — each builds vocabulary used in the next.
- **All measurements are gzipped** unless explicitly labelled "raw". Gzip is what the user's browser actually downloads, so it's the number that matters.
- **Code blocks** in these docs are snapshots from the PR. The live code may have evolved; check git history if you need the exact diff.
- **"Why we did X and not Y"** sections call out the choices we considered and rejected. They matter as much as the choices we shipped — they're the part you'll forget by next year.

## Where the tooling lives

- `frontend/vite.config.ts` — build config (chunking strategy, visualizer plugin)
- `frontend/analyze-bundle.cjs` — small Node script that parses `dist/stats.html` into a readable summary table. Run with `node analyze-bundle.cjs` after a build.
- `frontend/dist/stats.html` — interactive treemap of the latest build. Open in any browser. **Regenerated every `npm run build`.**

## How to verify any optimization claim in these docs

```bash
cd frontend
npm run build            # writes dist/assets/*.js and dist/stats.html
node analyze-bundle.cjs  # prints the per-group size breakdown
```

The build output already prints per-chunk gzip sizes. The visualizer adds the *what's inside each chunk* view.
