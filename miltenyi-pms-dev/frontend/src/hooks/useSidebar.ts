import { useContext } from "react";
import { SidebarContext } from "../contexts/SidebarContext";

/**
 * Read/write the app sidebar's collapsed state.
 *
 *   const { collapsed, setCollapsed } = useSidebar();
 *
 * Throws at dev time if used outside `<SidebarProvider>`.
 */
export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a <SidebarProvider>");
  }
  return ctx;
}
