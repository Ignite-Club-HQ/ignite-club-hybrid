import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft } from "lucide-react";

interface ChatPageSkeletonProps {
  /**
   * Optional label for the header (shown as a plain skeleton block by default).
   * Passing a string paints the title text instantly for optimistic navigation
   * — e.g. from a push-notification tap where we already know the thread name.
   */
  title?: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  /** How many placeholder bubbles to render. Defaults to 6. */
  bubbleCount?: number;
}

/**
 * Full chat-layout skeleton shown during cold-start / auth resolution.
 *
 * This is a *static* structure — no Virtuoso, no scroll behaviour, no
 * animated data. When the real messages arrive, the parent unmounts this
 * component and mounts the real chat scroller in a single atomic swap so
 * Virtuoso paints once at the correct bottom-pinned position.
 *
 * Do NOT try to "progressively fill" this skeleton with real messages —
 * that would cause the re-measure flicker documented in
 * mem://features/chat/virtuoso-identity-stability.
 */
export function ChatPageSkeleton({ title, subtitle, bubbleCount = 6 }: ChatPageSkeletonProps) {
  const rows = Array.from({ length: bubbleCount }, (_, i) => i);
  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Header shell — matches ChatHeaderShell layout */}
      <div className="shrink-0 border-b bg-background px-3 py-2 flex items-center gap-3">
        <div className="h-9 w-9 flex items-center justify-center text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </div>
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1 min-w-0 space-y-1.5">
          {title ? (
            <div className="text-sm font-semibold truncate">{title}</div>
          ) : (
            <Skeleton className="h-3.5 w-32" />
          )}
          {subtitle ? (
            <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
          ) : (
            <Skeleton className="h-2.5 w-20" />
          )}
        </div>
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>

      {/* Message list placeholders — bottom-aligned to mimic pinned-to-bottom Virtuoso */}
      <div className="flex-1 min-h-0 flex flex-col justify-end overflow-hidden px-3 py-4 gap-3">
        {rows.map((i) => {
          const mine = i % 3 === 0;
          const widths = ["w-40", "w-56", "w-64", "w-32", "w-48", "w-52"];
          const w = widths[i % widths.length];
          return (
            <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <Skeleton className={`h-10 ${w} rounded-2xl`} />
            </div>
          );
        })}
      </div>

      {/* Composer shell */}
      <div className="shrink-0 border-t bg-background px-3 py-2 flex items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-10 flex-1 rounded-full" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
    </div>
  );
}
