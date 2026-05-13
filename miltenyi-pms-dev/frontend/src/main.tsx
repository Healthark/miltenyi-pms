import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "@/contexts/AuthProvider";
import { ThemeProvider } from "@/contexts/ThemeProvider";
import { SystemSettingsProvider } from "@/contexts/SystemSettingsProvider";
import { ToastProvider } from "@/contexts/ToastProvider";
import { SnackbarProvider } from "@/contexts/SnackbarProvider";
import { ConfirmProvider } from "@/contexts/ConfirmProvider";
import App from "@/App";
import "@/index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root not found. Check your index.html.");
}

// Mount order: StrictMode → AuthProvider → ThemeProvider → SystemSettings
// → feedback providers → App. ThemeProvider sits inside AuthProvider so it
// can read the authenticated user's saved theme preference; feedback
// providers (Toast/Snackbar/Confirm) sit innermost so any component
// anywhere in the tree can trigger them without prop drilling.
createRoot(root).render(
  <StrictMode>
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
  </StrictMode>,
);
