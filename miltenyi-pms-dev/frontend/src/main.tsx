import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AuthProvider } from "@/contexts/AuthProvider";
import { ThemeProvider } from "@/contexts/ThemeProvider";
import { SystemSettingsProvider } from "@/contexts/SystemSettingsProvider";
import { ToastProvider } from "@/contexts/ToastProvider";
import { SnackbarProvider } from "@/contexts/SnackbarProvider";
import { ConfirmProvider } from "@/contexts/ConfirmProvider";
import { queryClient } from "@/lib/queryClient";
import App from "@/App";
import "@/index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root not found. Check your index.html.");
}

// Mount order: StrictMode → QueryClientProvider → AuthProvider →
// ThemeProvider → SystemSettings → feedback providers → App.
//
// QueryClientProvider sits OUTSIDE AuthProvider on purpose: AuthProvider
// (and any future hook that wants to invalidate the cache on
// logout/login) needs `useQueryClient()` to work, which requires the
// provider above it in the tree.
//
// ThemeProvider sits inside AuthProvider so it can read the
// authenticated user's saved theme preference; feedback providers
// (Toast/Snackbar/Confirm) sit innermost so any component anywhere
// in the tree can trigger them without prop drilling.
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <SystemSettingsProvider>
            <ToastProvider>
              <SnackbarProvider>
                <ConfirmProvider>
                  <App />
                </ConfirmProvider>
              </SnackbarProvider>
            </ToastProvider>
          </SystemSettingsProvider>
        </ThemeProvider>
      </AuthProvider>
      {/* Floating dev-only panel that shows every cached query, its
          status (fresh / stale / fetching), its data, and lets you
          invalidate or refetch by hand. Vite's `import.meta.env.DEV`
          is statically replaced at build time, so the entire
          <ReactQueryDevtools> subtree is dead-code-eliminated from
          production bundles. */}
      {import.meta.env.DEV && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-right" />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
