import { formatDistanceToNowStrict } from "date-fns";

/**
 * Returns compact relative time like "13h ago", "2d ago", "5m ago"
 */
export function formatTimeShort(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const result = formatDistanceToNowStrict(d, { addSuffix: true });
  // "13 hours ago" → "13h ago", "2 days ago" → "2d ago", etc.
  return result
    .replace(/ seconds?/, "s")
    .replace(/ minutes?/, "m")
    .replace(/ hours?/, "h")
    .replace(/ days?/, "d")
    .replace(/ weeks?/, "w")
    .replace(/ months?/, "mo")
    .replace(/ years?/, "y");
}
