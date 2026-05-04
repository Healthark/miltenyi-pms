import { useContext } from "react";
import { AuthContext, type AuthContextType } from "../contexts/AuthContext";

/**
 * Typed hook for consuming auth state. Throws at development time if called
 * outside <AuthProvider> — this surfaces structural bugs immediately rather
 * than silently returning undefined in production.
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error(
      "[useAuth] must be called within an <AuthProvider>. " +
        "Ensure <AuthProvider> wraps your component tree in main.tsx.",
    );
  }

  return context;
}
