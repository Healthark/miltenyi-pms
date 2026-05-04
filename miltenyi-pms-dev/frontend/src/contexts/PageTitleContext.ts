import { createContext } from "react";

/**
 * Pages can push a dynamic title (e.g. a mentee's name) so the Topbar
 * shows "My Mentees / Arjun Patel" instead of the raw URL segment.
 * `null` means "no override — use the URL-derived default".
 */
export interface PageTitleContextValue {
  readonly override: string | null;
  readonly setOverride: (title: string | null) => void;
}

export const PageTitleContext = createContext<PageTitleContextValue>({
  override: null,
  setOverride: () => {},
});
