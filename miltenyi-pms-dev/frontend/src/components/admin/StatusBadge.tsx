interface StatusBadgeProps {
  readonly isDeleted: boolean;
}

export function StatusBadge({ isDeleted }: StatusBadgeProps) {
  return isDeleted ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600">
      <span
        className="h-1.5 w-1.5 rounded-full bg-red-500"
        aria-hidden="true"
      />
      Deactivated
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-600">
      <span
        className="h-1.5 w-1.5 rounded-full bg-green-500"
        aria-hidden="true"
      />
      Active
    </span>
  );
}
