import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "./contexts/AuthProvider";
import { SystemSettingsProvider } from "./contexts/SystemSettingsProvider";
import { ToastProvider } from "./contexts/ToastProvider";
import { SnackbarProvider } from "./contexts/SnackbarProvider";
import { ConfirmProvider } from "./contexts/ConfirmProvider";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element #root not found. Check your index.html.");
}

// Mount order: StrictMode → AuthProvider → SystemSettings → feedback providers
// → App. Feedback providers (Toast/Snackbar/Confirm) sit innermost so any
// component anywhere in the tree can trigger them without prop drilling.
createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <SystemSettingsProvider>
        <ToastProvider>
          <SnackbarProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </SnackbarProvider>
        </ToastProvider>
      </SystemSettingsProvider>
    </AuthProvider>
  </StrictMode>,
);
