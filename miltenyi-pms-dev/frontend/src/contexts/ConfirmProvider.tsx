import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ConfirmContext,
  type ConfirmContextValue,
  type ConfirmOptions,
} from "./ConfirmContext";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";

interface ConfirmProviderProps {
  readonly children: ReactNode;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

/**
 * Promise-based confirmation dialog. Each call to `confirm()` opens the
 * dialog and returns a promise that resolves to `true` when the user clicks
 * the confirm button, `false` when they cancel, press Esc, or click the
 * backdrop. Only one dialog can be open at a time — a second call before the
 * first resolves rejects the first with `false`, preventing stuck promises.
 */
export function ConfirmProvider({ children }: ConfirmProviderProps) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // A ref so the resolve handler closure always sees the latest pending
  // promise even inside handlers captured by React's effect deps.
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        // A new confirm while one is pending: auto-resolve the existing one
        // as cancel so it doesn't hang, then open the new one.
        if (pendingRef.current) {
          pendingRef.current.resolve(false);
        }
        setPending({ options, resolve });
      }),
    [],
  );

  const resolveWith = useCallback((value: boolean) => {
    const current = pendingRef.current;
    if (current) {
      current.resolve(value);
    }
    setPending(null);
  }, []);

  const value = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialog
          title={pending.options.title}
          message={pending.options.message}
          variant={pending.options.variant ?? "default"}
          confirmText={pending.options.confirmText ?? "Confirm"}
          cancelText={pending.options.cancelText ?? "Cancel"}
          onConfirm={() => resolveWith(true)}
          onCancel={() => resolveWith(false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}
