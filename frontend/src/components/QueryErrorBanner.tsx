import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState } from "react";

/**
 * Visible "Tap to retry" banner for screens where a key query timed out
 * or failed. We surface this only when at least one supplied query is in
 * an error state — successful or still-loading queries render nothing.
 *
 * Used by Schedule + Messages pages where a hung PostgREST GET (now
 * aborted at 15s by the global fetch interceptor) would otherwise leave
 * the user staring at stale cached data with no way to recover until the
 * next visibility/reconnect tick.
 */
export interface QueryErrorBannerProps {
  /** True when one or more underlying queries failed (after the global retry). */
  hasError: boolean;
  /** Called when the user taps retry. Should refetch the failed queries. */
  onRetry: () => void | Promise<void>;
  /** Optional override copy. */
  message?: string;
  className?: string;
}

export function QueryErrorBanner({ hasError, onRetry, message, className }: QueryErrorBannerProps) {
  const [retrying, setRetrying] = useState(false);
  if (!hasError) return null;

  const handle = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      // Small delay so the spin animation is visible even on fast retries.
      setTimeout(() => setRetrying(false), 600);
    }
  };

  return (
    <button
      type="button"
      onClick={handle}
      className={cn(
        "w-full flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/15 transition-colors touch-manipulation",
        className,
      )}
      aria-label="Retry loading"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="truncate">
          {message ?? "Couldn't load latest data. Tap to retry."}
        </span>
      </div>
      <span className="flex items-center gap-1 shrink-0 font-medium">
        <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
        Retry
      </span>
    </button>
  );
}
