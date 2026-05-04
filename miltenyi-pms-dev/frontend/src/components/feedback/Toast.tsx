import { CheckCircle, Info, X } from "lucide-react";
import type { ToastVariant } from "../../contexts/ToastContext";

interface ToastProps {
  readonly message: string;
  readonly variant: ToastVariant;
  readonly onDismiss: () => void;
}

const VARIANT_STYLES: Record<
  ToastVariant,
  { icon: typeof CheckCircle; bg: string; border: string; text: string }
> = {
  success: {
    icon: CheckCircle,
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
  },
  info: {
    icon: Info,
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
  },
};

/**
 * Single toast entry. Visual concerns only — lifecycle (auto-dismiss) is owned
 * by ToastProvider so the same timer can be reset when a new toast replaces
 * the current one.
 */
export function Toast({ message, variant, onDismiss }: ToastProps) {
  const style = VARIANT_STYLES[variant];
  const Icon = style.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto flex items-center gap-3 rounded-lg border ${style.bg} ${style.border} px-4 py-2.5 shadow-lg min-w-[240px] max-w-sm animate-[fadeIn_0.2s_ease-out]`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${style.text}`} aria-hidden="true" />
      <p className={`flex-1 text-sm font-medium ${style.text}`}>{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        className={`${style.text} opacity-60 hover:opacity-100 transition-opacity`}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
