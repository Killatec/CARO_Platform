interface PendingOverlayProps {
  isPending: boolean;
}

export function PendingOverlay({ isPending }: PendingOverlayProps) {
  if (!isPending) return null;
  return (
    <span
      data-testid="pending-overlay"
      className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse ml-1"
      aria-label="Write in progress"
    />
  );
}
