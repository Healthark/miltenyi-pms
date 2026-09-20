/** The System Settings switch: a brand-coloured toggle button, on its own
 *  (`Switch`, for table cells) or with a label and description (`ToggleRow`). */
export function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: Readonly<{ checked: boolean; onChange: (val: boolean) => void; disabled?: boolean; ariaLabel?: string }>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
        checked ? "bg-brand" : "bg-slate-300 dark:bg-slate-400"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-slate-100 shadow transition duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export interface ToggleRowProps {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (val: boolean) => void;
  readonly disabled?: boolean;
}

export function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-main">{label}</p>
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={label} />
    </div>
  );
}
