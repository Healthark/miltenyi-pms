import { useCallback, useMemo, useState, type ReactNode } from "react";
import { SidebarContext, type SidebarContextValue } from "./SidebarContext";

interface SidebarProviderProps {
  readonly children: ReactNode;
}

/**
 * Owns the boolean that drives the app sidebar's collapsed/expanded state.
 * Default expanded so users land on the familiar layout; the EvalDrawer (or
 * any future surface) can collapse it on demand.
 */
export function SidebarProvider({ children }: SidebarProviderProps) {
  const [collapsed, setCollapsedState] = useState(false);
  const [rightInsetPx, setRightInsetPxState] = useState<number | null>(null);

  const setCollapsed = useCallback((val: boolean) => {
    setCollapsedState(val);
  }, []);
  const setRightInsetPx = useCallback((val: number | null) => {
    setRightInsetPxState(val);
  }, []);

  const value = useMemo<SidebarContextValue>(
    () => ({ collapsed, setCollapsed, rightInsetPx, setRightInsetPx }),
    [collapsed, setCollapsed, rightInsetPx, setRightInsetPx],
  );

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  );
}
