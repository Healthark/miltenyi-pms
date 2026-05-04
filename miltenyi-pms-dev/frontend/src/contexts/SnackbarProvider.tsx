import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  SnackbarContext,
  type SnackbarContextValue,
  type SnackbarVariant,
} from "./SnackbarContext";
import { Snackbar } from "../components/feedback/Snackbar";

const AUTO_DISMISS_MS = 6000;

interface SnackbarEntry {
  id: number;
  message: string;
  variant: SnackbarVariant;
}

interface SnackbarProviderProps {
  readonly children: ReactNode;
}

/**
 * Manages a stack of top-right snackbars. Each entry has an independent
 * auto-dismiss timer; users can also dismiss manually with the X button.
 * New entries append to the bottom of the stack so the newest failure is
 * always closest to where the user's eye was drawn (by the top entry).
 */
export function SnackbarProvider({ children }: SnackbarProviderProps) {
  const [entries, setEntries] = useState<SnackbarEntry[]>([]);
  const timersRef = useRef<Map<number, number>>(new Map());
  const seqRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timerId = timersRef.current.get(id);
    if (timerId !== undefined) {
      globalThis.clearTimeout(timerId);
      timersRef.current.delete(id);
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: SnackbarVariant) => {
      seqRef.current += 1;
      const id = seqRef.current;
      setEntries((prev) => [...prev, { id, message, variant }]);
      const timerId = globalThis.setTimeout(() => {
        timersRef.current.delete(id);
        setEntries((prev) => prev.filter((e) => e.id !== id));
      }, AUTO_DISMISS_MS);
      timersRef.current.set(id, timerId);
    },
    [],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => globalThis.clearTimeout(t));
      timers.clear();
    };
  }, []);

  const value = useMemo<SnackbarContextValue>(
    () => ({
      error: (message) => show(message, "error"),
      warn: (message) => show(message, "warn"),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      {entries.length > 0 &&
        createPortal(
          <div
            className="pointer-events-none fixed top-4 right-4 z-[60] flex flex-col gap-2"
            aria-live="assertive"
          >
            {entries.map((e) => (
              <Snackbar
                key={e.id}
                message={e.message}
                variant={e.variant}
                onDismiss={() => dismiss(e.id)}
              />
            ))}
          </div>,
          document.body,
        )}
    </SnackbarContext.Provider>
  );
}
