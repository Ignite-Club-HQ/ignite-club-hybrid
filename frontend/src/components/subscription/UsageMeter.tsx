import { Crown, RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface UsageMeterProps {
  label: string;
  used: number;
  limit: number;
  /** Format used/limit as bytes (MB) instead of integer counts. */
  bytes?: boolean;
  /** When at cap, show an inline upgrade affordance pointing here. */
  clubId?: string | null;
  /** Optional benefit-led message shown under the meter when at cap. */
  capMessage?: string;
  /**
   * When the current Free-tier cycle resets. Surfaced as a "Resets in X days"
   * hint so users know when uploads/polls become available again.
   * Prominent when at cap; subtle at all usage levels below it.
   */
  resetAt?: Date | null;
  className?: string;
}

const formatBytesMB = (b: number) =>
  b >= 1024 * 1024 * 1024
    ? `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`
    : `${(b / (1024 * 1024)).toFixed(b < 100 * 1024 ? 2 : 0)} MB`;

const fmt = (v: number, bytes?: boolean) => (bytes ? formatBytesMB(v) : `${v}`);

export function formatResetHint(resetAt: Date): string {
  const now = Date.now();
  const diffMs = resetAt.getTime() - now;
  const dateLabel = resetAt.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (diffMs <= 0) return `Resets shortly (${dateLabel})`;
  const hours = Math.round(diffMs / (1000 * 60 * 60));
  if (hours < 24) {
    return `Resets in ${hours} ${hours === 1 ? "hour" : "hours"} (${dateLabel})`;
  }
  const days = Math.round(hours / 24);
  return `Resets in ${days} ${days === 1 ? "day" : "days"} (${dateLabel})`;
}

/**
 * Compact inline progress + label. Used to surface Free-tier caps on the
 * media gallery, vault files tab, and poll dialog without resorting to a
 * full-page lock screen.
 */
export function UsageMeter({
  label,
  used,
  limit,
  bytes,
  clubId,
  capMessage,
  resetAt,
  className,
}: UsageMeterProps) {
  const navigate = useNavigate();
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atCap = used >= limit;
  const showResetHint = !!resetAt;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-3 py-2.5 space-y-2 text-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span
          className={cn(
            "tabular-nums text-xs",
            atCap ? "text-destructive font-semibold" : "text-muted-foreground",
          )}
        >
          {fmt(used, bytes)} / {fmt(limit, bytes)}
        </span>
      </div>
      <Progress value={pct} className="h-1.5" />

      {atCap && capMessage && (
        <p className="text-xs text-muted-foreground pt-1">{capMessage}</p>
      )}

      {showResetHint && resetAt && (
        <p
          className={cn(
            "flex items-center gap-1.5 text-xs pt-0.5",
            atCap ? "text-foreground/80 font-medium" : "text-muted-foreground",
          )}
        >
          <RefreshCw className="h-3 w-3 shrink-0" />
          {formatResetHint(resetAt)}
        </p>
      )}

      {clubId && (
        <button
          type="button"
          onClick={() => navigate(`/clubs/${clubId}/upgrade`)}
          className={cn(
            "inline-flex items-center gap-1.5",
            atCap
              ? "text-xs font-semibold text-primary hover:underline"
              : "text-[11px] text-muted-foreground/60 hover:text-primary transition-colors"
          )}
        >
          <Crown className={cn(atCap ? "h-3.5 w-3.5" : "h-3 w-3")} />
          {atCap ? "Upgrade to Pro" : "Upgrade for unlimited"}
        </button>
      )}
    </div>
  );
}
