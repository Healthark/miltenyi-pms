/**
 * EvalDrawer — right-anchored drawer shell for the mentor's annual
 * evaluation form. Used on a mentee's Annual Summary tab so the mentor
 * can read goal H1/H2 reviews + project ratings on the left while
 * writing the year-end evaluation on the right.
 *
 * Behaviour notes:
 *   - No backdrop. The page underneath stays interactable (mentor can
 *     scroll the Annual Summary). Outside-click does NOT close — only
 *     Cancel / X / Esc / Submit.
 *   - On mount: collapses the app sidebar AND publishes the drawer's
 *     measured width via `setRightInsetPx`. AppShell's <main> applies a
 *     matching `padding-right` so the underlying page reflows narrower
 *     and nothing gets hidden behind the drawer. Both are restored on
 *     unmount.
 *   - z-40, lower than ConfirmDialog's z-70 — Submit-confirm still
 *     stacks correctly above the drawer.
 *   - Width: ~35% of viewport on desktop with a 28rem floor, full-width
 *     on mobile.
 *   - Auto-save-on-implicit-close lives in `EvalForm`'s cleanup effect:
 *     when the parent component unmounts (e.g. mentee tab switched from
 *     Annual Summary to Projects), unsaved edits get persisted as a
 *     draft via fire-and-forget `onSaveDraft`.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useSidebar } from "../../hooks/useSidebar";
import { EvalForm, type EvalFormProps } from "./EvalForm";

export function EvalDrawer(props: EvalFormProps) {
  const { collapsed, setCollapsed, setRightInsetPx } = useSidebar();
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Snapshot the sidebar state on mount so we can restore it when the
  // drawer closes. Avoids "always expanded after every drawer use" if
  // the user prefers a collapsed sidebar.
  const previousCollapsedRef = useRef(collapsed);
  useEffect(() => {
    previousCollapsedRef.current = collapsed;
    setCollapsed(true);
    return () => {
      setCollapsed(previousCollapsedRef.current);
    };
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Publish the drawer's actual rendered width via a ResizeObserver so
  // <main>'s padding-right tracks any responsive width changes.
  useEffect(() => {
    const node = drawerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setRightInsetPx(entry.contentRect.width);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      setRightInsetPx(null);
    };
  }, [setRightInsetPx]);

  // Esc closes the drawer (parent handles whatever close means).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [props]);

  return createPortal(
    <div
      ref={drawerRef}
      className="fixed top-0 right-0 z-40 h-screen w-full md:w-[35vw] md:min-w-[28rem] bg-surface shadow-2xl border-l border-border flex flex-col overflow-x-hidden animate-in slide-in-from-right duration-200"
      role="dialog"
      aria-modal="true"
      // Match the `zoom: 0.9` applied to <main> in App.tsx so the drawer
      // contents render at the same effective scale as the page behind
      // it. The drawer is portaled into <body>, outside <main>, so it
      // doesn't inherit that zoom automatically. Height is inflated by
      // 1/0.9 so the post-zoom used height lands at 100vh — without
      // this `h-screen` (100vh) becomes 90vh used, leaving white space
      // below the drawer.
      style={{ zoom: 0.9, height: "calc(100vh / 0.9)" }}
    >
      <EvalForm {...props} />
    </div>,
    document.body,
  );
}
