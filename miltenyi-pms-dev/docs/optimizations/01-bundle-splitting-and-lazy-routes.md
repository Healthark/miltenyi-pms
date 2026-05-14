# 01 — Bundle splitting, lazy routes, and vendor chunks

> **PR:** _pending_
> **Files changed:** `frontend/vite.config.ts`, `frontend/src/App.tsx`, plus 2 unrelated TS-error fixes (`SystemSettingsTab.tsx`, `MenteeAnnualSummaryTab.tsx`) that were blocking the build, plus new `frontend/analyze-bundle.cjs` helper script.
> **Headline result:** Initial JS download dropped **185 KB → 67 KB gzip** after `React.lazy`. After adding vendor chunks the first-load came back up to **~115 KB** but per-deploy invalidation dropped to **~10–25 KB** (from 185 KB).

---

## TL;DR — what we did and why

We had one giant JavaScript file (`index.js` at 774 KB raw / 185 KB gzip) that contained every page, every component, every npm dependency, fused together. Every user — even one who only visits the dashboard — downloaded the entire app on first paint.

We split it into:
1. **Per-page chunks** that load on demand (a Staff user never downloads AdminPanel's code)
2. **Stable vendor chunks** for React, axios, lucide-react (these change rarely, so the browser keeps them cached across our deploys)
3. **The app shell** (auth, routing, sidebar, topbar, Login) which stays eager because we need it immediately

We also installed `rollup-plugin-visualizer` so we can *see* what's in the bundle. Future bundle work starts by reading the visualizer output.

---

## Part 1 — Why this matters

### The cost of a single bundle

Every byte of JavaScript shipped to the browser has three costs:

1. **Network transfer** — the browser must download it. On a slow 4G connection, 200 KB of JS can take 2-3 seconds before *anything* can render.
2. **Parse + compile** — even after download, the browser must parse the JS into an AST and compile it to bytecode. This blocks the main thread. On a mid-range Android device, parsing 200 KB of JS can take ~100ms.
3. **Memory** — every byte stays in memory for the lifetime of the tab.

If you ship code a user will never run, you're paying all three costs for nothing.

### The signal we noticed

Vite itself was warning us:

```
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
```

That's Vite's built-in `chunkSizeWarningLimit` (default 500 KB) firing. The fix it suggests in its own message is exactly what we did.

---

## Part 2 — Concept primer

These are the ideas we used. Each one is small. Together they're a complete bundle-optimization vocabulary.

### Bundle vs. chunk

- A **bundle** is the total set of JS files your app ships. Historically (pre-2019) it was one file. Today it's a *graph* of files.
- A **chunk** is one file in that graph. After our work we have ~25 chunks; we used to have 1.
- **Code splitting** is the technique of breaking one bundle into multiple chunks.

### What `import` actually does at build time

When Vite sees:
```ts
import { AdminPanel } from "@/pages/AdminPanel";
```
This is a **static import**. Vite reads `AdminPanel.tsx`, recursively reads everything it imports, and bakes the entire dependency tree into the output JS file *that contains this import*. By default, that's the main bundle. The browser must have AdminPanel's code before it can even evaluate this `import` statement.

When Vite sees:
```ts
const AdminPanel = lazy(() => import("@/pages/AdminPanel"));
```
This is a **dynamic import** (the `import()` with parens, not the static `import` keyword). The arrow function isn't called at build time — Vite recognizes the syntax as a code-split point. It emits `AdminPanel-[hash].js` as a **separate chunk**, and at runtime, when the arrow function is finally called (by React.lazy when it renders the component), the browser fetches that chunk over the network and evaluates it.

**The mental model:** `import()` is a runtime function that returns a Promise. The bundler sees it and says "this code might not be needed; let me put it in its own file."

### Tree shaking

When you write:
```ts
import { Plus, Save } from "lucide-react";
```
Tree-shaking is the bundler's ability to look at lucide-react (which has ~1500 icons), see that you only use `Plus` and `Save`, and ship *only those two icons* — not the whole package. The "tree" is the dependency graph; "shaking" means letting dead branches (unused exports) fall off.

Tree-shaking requires the package to ship **ES modules** (the modern `import`/`export` syntax). Older packages that ship **CommonJS** (`require()` / `module.exports`) can't be tree-shaken because CommonJS exports are computed at runtime, not statically analyzable.

**This is why `lucide-react` is only 22 KB gzip in our bundle even though the package has 1500+ icons** — they ship as separate ES modules and we only import the ones we use.

**Practical rule:** prefer libraries that say "ESM-only" or "tree-shake friendly" in their README. If a library is CommonJS-only, you eat the whole library.

### Minification vs. compression (gzip / brotli)

These are two different steps and both happen:

- **Minification** (build-time) — variable names get shortened (`reviewerId` → `r`), whitespace is removed, dead code is eliminated. Reduces source by ~30-50%.
- **Compression** (transport-time) — the HTTP server (Vercel / Render / nginx) gzips or brotlis the file before sending it. The browser decompresses it. JS compresses extremely well (~3-4× shrink) because it has lots of repeated tokens.

Vite's build output shows both numbers:
```
dist/assets/index.js   774.25 kB │ gzip: 185.37 kB
```
774 KB is post-minification raw. 185 KB is what the user actually downloads (gzip). **Always quote the gzip number** when discussing perf — it's what the user pays.

### React.lazy and Suspense

`React.lazy(() => import("./Foo"))` returns a special component. The first time React tries to render it:
- It calls the arrow function → starts the dynamic import
- The Promise is in-flight → React **throws** (literally — a Promise is thrown as an exception)
- The nearest `<Suspense fallback={...}>` boundary catches it and renders the fallback
- When the Promise resolves, React re-renders and shows the real component

So a `<Suspense>` boundary is **required** to use `React.lazy`. Without it, React crashes with "A component suspended while responding to synchronous input."

You can have **nested** Suspense boundaries. React picks the *nearest* one to the suspending component. This is what we use to keep the sidebar visible during page navigation — see "Suspense placement" below.

### Manual vendor chunks

By default, Vite/Rollup chunks code by tracking what's imported where. It's smart but conservative — it auto-extracts shared modules but doesn't proactively group "stable" vs "volatile" code.

**Manual chunking** is when you override that and say "regardless of import graph, put `react`, `react-dom`, and `react-router-dom` in a chunk called `react-vendor`."

**Why bother?** Cache busting. When you deploy, every chunk that contains *any changed byte* gets a new content hash:
```
index-CF_sM1du.js  →  index-AbCd1234.js
```
The browser sees a new filename, treats it as a new resource, and re-downloads it. If React itself is baked into `index.js`, then *every code deploy invalidates React*. The user's browser has to re-download 30+ KB of React it already has, just because we fixed a typo in a button.

If React lives in its own `react-vendor.js` chunk, that chunk's content hash doesn't change unless we upgrade React. Browsers cache it for months. Code deploys only invalidate the small app chunks.

**The trade:** the first-time visitor downloads vendor chunks eagerly (slightly larger initial load), but every repeat visitor — and every visitor after every code deploy — pays nothing for the vendor parts.

---

## Part 3 — The work, step by step

### Step 0 (prep) — Fix two pre-existing TS errors

The production build (`tsc -b && vite build`) failed before we could even measure a baseline. Two pre-existing TS errors had slipped into main because the dev server (`vite dev`) skips `tsc` and only Vite's loader runs.

**Lesson:** Dev-server-only TS checking is a footgun. The CI build is the source of truth; if it doesn't run on push, errors accumulate. Adding `tsc --noEmit` to the lint pipeline (or pre-commit) would catch this.

**Fixes (one line each):**

```diff
# frontend/src/components/admin/SystemSettingsTab.tsx
- import { useCallback, useState } from "react";
+ import { useCallback } from "react";
```

```diff
# frontend/src/components/mentees/MenteeAnnualSummaryTab.tsx
  none: {
    label: "Not started",
    cls: "bg-slate-100 text-slate-600",
  },
+ not_started: {
+   label: "Not started",
+   cls: "bg-slate-100 text-slate-600",
+ },
  draft: {
```
`ReviewStatus` had gained a `"not_started"` value in a prior change; the Record map needed a matching entry.

---

### Step 1 — Establish the baseline

You can't optimize what you can't measure. Before any code change, we ran:

```bash
cd frontend
npm run build
```

Output:
```
dist/index.html                   0.51 kB │ gzip:   0.33 kB
dist/assets/index-BEw5KjcP.css   66.78 kB │ gzip:  12.17 kB
dist/assets/index-DAzA21FC.js   774.25 kB │ gzip: 185.37 kB    ← ⚠️ one chunk
```

Three observations:

1. **Total JS download: 185 KB gzip.** That's everything in one file. A user visiting `/login` downloads code for `/admin` they may never visit.
2. **CSS is fine.** Tailwind's purge already keeps it under control.
3. **Vite is yelling at us.** The 500 KB warning was triggered, and Vite's own suggested fixes are the ones we'll apply.

**The discipline:** never start optimizing until you have a baseline number. Otherwise "I optimized it" is folklore, not measurement. The whole point of this exercise is to *prove* an improvement, not just hope for one.

---

### Step 2 — Install the bundle visualizer

The text output above tells us *how big* but not *what's inside*. We need an X-ray.

```bash
npm install --save-dev rollup-plugin-visualizer
```

Then wire it into `vite.config.ts`:

```ts
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Bundle X-ray: emits dist/stats.html after every `npm run build`.
    // Open it in a browser to see a treemap of every module + its gzip
    // / brotli size. Build-only, never shipped to the user.
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
  // ...
})
```

After the next build, `dist/stats.html` is an interactive treemap. Boxes nested in boxes, sized proportionally by gzip bytes. Open it in any browser.

**A small helper** for reading the data from the command line (the analyzer's HTML embeds the raw data as a JS object): we also added `frontend/analyze-bundle.cjs`, a one-shot Node script that parses `dist/stats.html` and prints a sorted table grouped by npm package / `src/` folder. Run with `node analyze-bundle.cjs` after a build.

#### What the analyzer told us (baseline)

```
GROUP                                  GZIP        RAW   FILES
---------------------------------------------------------------
npm:react-dom                         85.01 KB   447.96 KB     4
src:components                       137.15 KB   582.21 KB    78
src:pages                             41.68 KB   207.63 KB    16
npm:axios                             32.13 KB    83.08 KB    49
npm:react-router                      21.86 KB    88.76 KB     1
npm:lucide-react                      21.69 KB    32.93 KB    87
npm:react                              4.70 KB    15.96 KB     4
```

**Numbers to internalize:**

- **`react-dom` is ~half the JS weight.** This is the floor. You can't get under it without changing framework. (Preact is the most popular swap, ~10 KB. Not doing it.)
- **`lucide-react`: 87 icon files, 22 KB total.** This is what *good* tree-shaking looks like. If lucide-react had shipped as CommonJS, this would be 400-500 KB. Always prefer ES-module packages.
- **`src:pages` is 42 KB, all eager.** This is the prize. Code splitting moves this out of the initial bundle.

> ⚠️ The analyzer's per-module numbers don't sum to the dist file size. The analyzer measures each module *before* the chunk's final whole-file gzip; the dist size is the chunk gzipped as one unit (which compresses better because of shared tokens). Treat the analyzer numbers as **relative shares**, not absolute KBs.

---

### Step 3 — Code-split routes with `React.lazy`

#### Our wrinkle: named vs default exports

Most React tutorials show `React.lazy` with default-exported components:
```tsx
export default function MyPage() { ... }
const MyPage = lazy(() => import("./MyPage"));   // works
```

Our pages use **named exports** for code-search hygiene (you can grep for the exact component name):
```tsx
export function AnnualGoals() { ... }
```

Two clean options to bridge this:

- **Option A:** Change every page to `export default`. Touches 13 page files.
- **Option B:** Wrap with a tiny adapter in `App.tsx`. One-line change per page, no other file touched.

We went with **B**. Lower blast radius, easier to revert, doesn't require touching pages that have nothing to do with bundle optimization.

The adapter looks like this:

```tsx
const AnnualGoals = lazy(() =>
  import("@/pages/AnnualGoals").then((m) => ({ default: m.AnnualGoals })),
);
```

Read it as: "lazy-load this module, then map its named export `AnnualGoals` to the shape `{ default: ... }` that `React.lazy` requires."

For pages that already used `export default` (`AdminPanel`, `Unauthorized`), we skip the `.then()` adapter:
```tsx
const AdminPanel = lazy(() => import("@/pages/AdminPanel"));
```

#### What stays eager (and why)

We intentionally **did not** lazy-load `Login`. The very first thing an unauthenticated user sees is the login form. Making it lazy would force them to wait for a chunk to download *before they can even see a form*. That's the opposite of what we want for the first paint.

`ProtectedRoute` is also small and used by every protected route — keeping it eager saves a tiny round-trip on every route change.

Everything else (12 protected pages + ChangePassword/ResetPassword/Unauthorized) becomes lazy.

#### Suspense placement

Suspense boundaries are where React renders the fallback while a lazy chunk loads. **Where you put the boundary matters** because it controls *what unmounts during the load*.

We placed **two** boundaries deliberately:

```tsx
// Inside MainContent — wraps the <Outlet /> that renders matched routes
<Suspense fallback={<PageLoader />}>
  <Outlet />
</Suspense>
```
This is the inner boundary. When the user navigates from `/dashboard` to `/admin`, only the **content area** unmounts and shows the spinner. The sidebar and topbar stay visible because they're outside this boundary. Crucial for UX continuity — without this, the entire app shell would flash on every navigation.

```tsx
// At the top of App() — wraps everything
<Suspense fallback={<PageLoader />}>
  <Routes>
    {/* all routes */}
  </Routes>
</Suspense>
```
This is the outer safety net. It catches lazy public routes (`Unauthorized`, `ResetPassword`, `ChangePassword`) that don't sit inside `AppShell`. Nested Suspense boundaries are fine — React picks the *nearest* one for any given suspending component, so the inner one wins for protected pages.

#### The `PageLoader` fallback

Small, subtle, doesn't look like an error:
```tsx
function PageLoader() {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <div
        role="status"
        aria-label="Loading page"
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500"
      />
    </div>
  );
}
```

**Accessibility note:** `role="status"` + `aria-label` tells screen readers the spinner is a loading indicator. Don't ship spinners without these — assistive tech otherwise announces nothing.

#### Build result after code-splitting

```
dist/assets/index-CF_sM1du.js            218.67 kB │ gzip: 67.62 kB    ← main chunk shrunk
dist/assets/AnnualGoals-DGLv8sAi.js       74.97 kB │ gzip: 14.84 kB
dist/assets/ProjectReviews-CizmZsdR.js    72.44 kB │ gzip: 12.72 kB
dist/assets/AdminPanel-t7hoaqM9.js        65.27 kB │ gzip: 15.55 kB
dist/assets/MenteeDetail-CCGzdMZi.js      61.68 kB │ gzip: 13.15 kB
dist/assets/Dashboard-CZ9jLou7.js         50.25 kB │ gzip:  9.24 kB
dist/assets/chunk-QFMPRPBF-...js          42.35 kB │ gzip: 15.00 kB    ← Vite auto-extracted
dist/assets/AnnualReviews-DO2wBFjk.js     39.35 kB │ gzip:  7.74 kB
... 30+ smaller chunks for individual icons and shared components
```

**Initial JS for a Dashboard visit: 67.62 KB gzip** (was 185.37 KB). That's a **−64%** reduction.

`chunk-QFMPRPBF` is *Vite's automatic shared chunk extraction*. It noticed that some components (EvalDrawer, Combobox, shared review widgets) were imported by 2+ lazy pages, and extracted them into a shared chunk so they're only downloaded once. We didn't ask for this — it's a free smart-bundler behaviour.

---

### Step 4 — Manual vendor chunks

After code-splitting, our bundle still has a problem: when we deploy code changes, `index.js` re-hashes. That 67 KB main chunk contains React, react-dom, react-router, axios, and lucide icons used by the sidebar — none of which we changed. The browser re-downloads them anyway.

We fix that by manually grouping the stable deps into vendor chunks.

#### The Vite 8 / Rolldown gotcha

The `manualChunks` API used to be an object:
```ts
manualChunks: {
  'react-vendor': ['react', 'react-dom'],
}
```
This still works in Rollup. **Vite 8 (using Rolldown) only accepts the function form**:
```ts
manualChunks(id) {
  if (id.includes('node_modules/react/')) return 'react-vendor';
}
```
The function receives the **absolute file path** of each module and returns the chunk name (or `undefined` to let the bundler decide).

Don't go down the rabbit hole I did — the build error was misleading:
```
Object literal may only specify known properties, and ''react-vendor'' does not exist in type 'ManualChunksFunction'.
```

The TS error tells you the object form isn't valid in this version. The fix is the function form.

#### Our chunking strategy

We split into three vendor chunks:

```ts
manualChunks(id) {
  if (id.includes('node_modules')) {
    if (
      /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)
    ) {
      return 'react-vendor';
    }
    if (/[\\/]node_modules[\\/]axios[\\/]/.test(id)) {
      return 'http-vendor';
    }
    if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
      return 'icons-vendor';
    }
  }
  return undefined;
}
```

| Chunk | Contents | Why a chunk |
|---|---|---|
| `react-vendor` | react, react-dom, react-router, scheduler | Framework tier. Almost never changes. ~72 KB gzip. |
| `http-vendor` | axios | Stable for months at a time. ~16 KB. |
| `icons-vendor` | lucide-react | Stable. Also rolls 80+ tiny per-icon chunks into one cacheable file (trades per-icon code-splitting for fewer HTTP requests). ~9 KB. |
| _everything else_ | App code + minor deps | Vite's default chunking — auto-split per route, auto-extracted shared chunks |

**Why we did NOT make a single `vendor.js` for all node_modules:** modern Vite/Rolldown already auto-extracts shared chunks for dynamic imports. Forcing every package into one mega-chunk defeats that. We only override for the framework-tier stable deps where stability beats granularity.

**Note on the regex:** `[\\/]` matches both `/` (Linux/macOS) and `\` (Windows). Module IDs are absolute paths and Windows paths use backslashes — without the alternation, the build silently misses on Windows.

---

## Part 4 — Final scorecard

### Files changed

| File | Lines | What |
|---|---|---|
| `frontend/vite.config.ts` | +30 | visualizer plugin + manual chunks |
| `frontend/src/App.tsx` | ~+60 / -12 | 12 pages converted to `React.lazy`, 2 Suspense boundaries added, `PageLoader` component |
| `frontend/src/components/admin/SystemSettingsTab.tsx` | -1 | unused `useState` import |
| `frontend/src/components/mentees/MenteeAnnualSummaryTab.tsx` | +4 | missing `not_started` status pill |
| `frontend/analyze-bundle.cjs` | +new | helper script to parse `dist/stats.html` |
| `frontend/package.json` + lockfile | +1 dev dep | `rollup-plugin-visualizer` |

### Numbers that moved

| Metric | Baseline | After lazy routes | After + vendor chunks |
|---|---|---|---|
| Initial JS download (`/dashboard`) | **185 KB** | **67 KB** | **~115 KB** |
| Number of JS chunks | 1 | ~42 | ~25 |
| Vite chunk-size warning | ⚠️ firing | ✅ clean | ✅ clean |
| Per-deploy invalidation* | ~185 KB | ~67 KB | **~10–25 KB** |
| Admin code downloaded by Staff users | 15 KB (wasted) | **0 KB** | **0 KB** |

*Per-deploy invalidation = the bytes a repeat visitor must re-download when we ship a code-only change (no library upgrades).

### Final chunk layout

```
┌── STABLE VENDOR CHUNKS (cached across deploys) ────────┐
│  react-vendor.js          71.79 KB gzip                │
│  http-vendor.js           15.86 KB gzip                │
│  icons-vendor.js           8.96 KB gzip                │
├── APP SHELL (changes per deploy) ──────────────────────┤
│  index.js                 10.08 KB gzip                │   ← App + ProtectedRoute + contexts + Sidebar + Topbar + Login
├── LAZY PAGE CHUNKS (load on demand) ───────────────────┤
│  Dashboard                 8.37 KB    AnnualReviews     7.65 KB
│  ManagementReview          4.05 KB    MyMentees         4.05 KB
│  AnnualGoals              14.35 KB    ProjectReviews   12.34 KB
│  AdminPanel               14.91 KB    MenteeDetail     12.98 KB
│  Profile                   1.33 KB    Unauthorized      0.57 KB
│  ChangePassword            0.54 KB    ResetPassword     1.85 KB
└────────────────────────────────────────────────────────┘
```

---

## Part 5 — Trade-offs we deliberately made

### First-load got slightly *worse* after vendor chunks. Why ship it?

After step 3 (lazy routes only), initial Dashboard load was ~76 KB gzip. After step 4 (vendor chunks), it's ~115 KB. The vendor chunks all load eagerly on first visit because the app shell and sidebar use icons, axios, and React, so the browser must pull them in.

We made it worse on purpose. Here's the calculation:

| Visitor type | Without vendor chunks | With vendor chunks |
|---|---|---|
| First-time visitor | 76 KB | 115 KB (**+40 KB**) |
| Returns next day, no deploys | 0 KB (cached) | 0 KB (cached) |
| Returns next day, we deployed | **67 KB re-downloaded** | **10 KB re-downloaded** (**−57 KB**) |

For Miltenyi PMS — an internal HR tool where users log in daily and we deploy weekly — the second-and-third rows happen *far* more often than the first row. The vendor-chunk trade is correct.

**If we were a public landing page** where most visitors are one-time, the trade would be wrong. We'd skip vendor chunking and let Vite's automatic splitting minimize first-load only.

**The lesson:** "optimization" is never universal. It depends on the user behaviour you optimize for. Always know which metric you're moving and which audience you're serving.

### The 30+ tiny lucide icon chunks

Before vendor chunking, Vite emitted each lucide icon as its own chunk (e.g. `user-x.js` at 0.30 KB raw). That's perfect granular splitting *in theory*. In practice:
- Each chunk is an HTTP request (cheap with HTTP/2 multiplexing, but still not free)
- They overlap a lot — the same icon is needed by 3 pages

Rolling all icons into `icons-vendor.js` (8.96 KB) trades granularity for fewer requests and full cacheability. For our use case (internal app, returning users) the trade is net positive.

### `analyze-bundle.cjs` is a `.cjs` (CommonJS) on purpose

Our `package.json` has `"type": "module"`, which makes plain `.js` files ESM. But the analyzer script uses `require()` and lives outside the bundled app. Renaming to `.cjs` tells Node "treat this as CommonJS regardless of the package's default" — simplest fix without restructuring.

---

## Part 6 — How to read `dist/stats.html`

After every `npm run build`, open `frontend/dist/stats.html` in a browser. You'll see a treemap:

- **Each box is a module or chunk.** Box area = its byte size.
- **Nested boxes** show the dependency hierarchy. A chunk box contains all the modules in it.
- **Hover** for the exact gzip / brotli / raw sizes.
- **Click** to zoom into a chunk and see its modules.
- The dropdown in the top-right toggles between **rendered** (raw), **gzip**, and **brotli** sizes.

When you're looking for "why is my bundle big":
1. Switch to gzip view
2. Look for the biggest box you don't recognize
3. Hover it — figure out which package it came from
4. Decide: do we actually need this? Is there a smaller alternative?

When you're looking for "what's in chunk X":
1. Click into chunk X
2. Read off the modules inside

---

## Part 7 — What you should now know cold

After studying this doc you should be able to:

1. Explain why static `import` is bundled and dynamic `import()` is split.
2. Explain why `React.lazy` requires a `Suspense` boundary above it, and where to place the boundary for good UX.
3. Explain what tree-shaking is and why ESM-only libraries tree-shake better than CommonJS.
4. Read a Vite build output and identify which chunks are vendor vs. app vs. lazy-loaded.
5. Justify a `manualChunks` strategy based on **what changes together** and **what caches well**.
6. Use `rollup-plugin-visualizer` to investigate any "why is the bundle big" question.
7. Know that the right strategy depends on user behaviour (first-time vs returning) and that "performance" isn't a single number.

---

## Part 8 — What's deliberately *not* done here

These are next optimizations from the audit, intentionally separate from this PR so the changes stay focused:

- **Server-state caching** (TanStack Query) — biggest "feels snappy" win, dedups API calls, gives us SWR semantics
- **Pagination on HR tables** — the "All Goals" and "All Reviews" views fetch the entire org. Needs backend coordination.
- **List virtualization** (`react-window`) — for tables that stay big even after pagination
- **Re-render hygiene** — splitting hot contexts, `React.memo` on row components, targeted `useMemo` for derived lists

Each will get its own numbered doc in this folder.

---

## Part 9 — Verification checklist

If you want to re-prove the result yourself:

```bash
cd frontend
git stash                              # revert lazy/vendor changes locally
npm run build                          # capture baseline numbers
git stash pop                          # re-apply
npm run build                          # capture after numbers
node analyze-bundle.cjs                # see the per-group breakdown
open dist/stats.html                   # visual confirmation
```

If a Staff user opens the app:
1. Open DevTools → Network → JS filter
2. Hard-refresh on `/dashboard`
3. Confirm: `react-vendor`, `http-vendor`, `icons-vendor`, `index`, `Dashboard` chunks load. AdminPanel does **not**.
4. Navigate to `/profile` — confirm only the Profile chunk loads (and shared bits if any).
5. Confirm sidebar/topbar stay visible during navigation; only the content area shows the loading spinner.

If an HR user opens the app:
1. Same as above but visit `/admin`.
2. Confirm AdminPanel chunk loads only when you click into Admin.
