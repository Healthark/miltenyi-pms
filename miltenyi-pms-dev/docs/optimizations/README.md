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
| [01](./01-bundle-splitting-and-lazy-routes.md) | Bundle splitting + lazy routes + vendor chunks | _pending_ | Initial JS download: **185 KB → 67 KB** gzip (−64%) before vendor chunks; per-deploy invalidation **−87%** after vendor chunks |

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
