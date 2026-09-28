/** Compact "x ago" / "in x" strings for short admin UI labels. */
export function formatRelativePast(when: Date | string): string {
  const d = typeof when === "string" ? new Date(when) : when;
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 60_000) return "just now";
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatRelativeFuture(when: Date | string): string {
  const d = typeof when === "string" ? new Date(when) : when;
  const diffMs = d.getTime() - Date.now();
  if (diffMs <= 0) return "now";
  const mins = Math.max(1, Math.round(diffMs / 60_000));
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
