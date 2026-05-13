import { useContext } from "react";
import { ThemeContext, type ThemeContextValue } from "@/contexts/ThemeContext";

/**
 * Access the current theme + toggle helpers. Throws when called outside
 * the ThemeProvider so misuse fails loudly during development.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error("useTheme must be used inside a <ThemeProvider>.");
  }
  return ctx;
}
