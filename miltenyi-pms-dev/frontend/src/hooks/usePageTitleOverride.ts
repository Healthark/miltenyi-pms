import { useContext, useEffect } from "react";
import { PageTitleContext } from "../contexts/PageTitleContext";

/**
 * Pushes a dynamic page title into the Topbar for the current page, and
 * clears it on unmount. Pass `null` or an empty string to fall back to the
 * URL-derived default.
 */
export function usePageTitleOverride(title: string | null): void {
  const { setOverride } = useContext(PageTitleContext);
  useEffect(() => {
    setOverride(title && title.trim() ? title : null);
    return () => setOverride(null);
  }, [title, setOverride]);
}
