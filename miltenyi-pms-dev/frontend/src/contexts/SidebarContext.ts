import { createContext } from "react";

/**
 * Layout chrome state — sidebar collapse + right-inset reservation.
 *
 *   - `collapsed` / `setCollapsed`: the app sidebar's collapsed/expanded
 *     state, lifted out of `Sidebar.tsx` so other surfaces can shrink the
 *     chrome on demand. Used by `EvalDrawer` to auto-collapse when the
 *     drawer opens.
 *   - `rightInsetPx` / `setRightInsetPx`: pixels of right-side space the
 *     `<main>` content area should leave reserved for an open right-side
 *     drawer (e.g. `EvalDrawer`). The drawer itself is `position: fixed`,
 *     so without this the page content would slide underneath. The drawer
 *     calls `setRightInsetPx(width)` on mount and `setRightInsetPx(null)`
 *     on unmount; `AppShell`'s `<main>` reads it and applies a matching
 *     `padding-right` so the underlying page reflows narrower.
 */
export interface SidebarContextValue {
  readonly collapsed: boolean;
  readonly setCollapsed: (val: boolean) => void;
  readonly rightInsetPx: number | null;
  readonly setRightInsetPx: (val: number | null) => void;
}

// Undefined sentinel forces consumers through `useSidebar`, which throws a
// dev-time error if used outside the Provider — same pattern the
// `useConfirm` hook uses.
export const SidebarContext = createContext<SidebarContextValue | undefined>(
  undefined,
);
