import { Skeleton } from "@/components/ui/skeleton";
import { ConversationAvatar } from "@/components/chat/ConversationAvatar";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, MoreVertical, Search } from "lucide-react";

interface ChatPageSkeletonProps {
  /**
   * Optional label for the header (shown as a plain skeleton block by default).
   * Passing a string paints the title text instantly for optimistic navigation
   * — e.g. from a push-notification tap where we already know the thread name.
   */
  title?: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  /**
   * Avatar for the thread. Rendered only when `title` is known, so the header
   * settles in one step instead of swapping a grey circle for a real face.
   */
  avatarUrl?: string | null;
  /** Shape/iconography to use for the avatar (defaults to a plain circle). */
  avatarType?: "club" | "team" | "group" | "league" | "dm" | "broadcast" | "support";
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
export function ChatPageSkeleton({
  title,
  subtitle,
  avatarUrl,
  avatarType = "group",
  bubbleCount = 6,
}: ChatPageSkeletonProps) {
  const rows = Array.from({ length: bubbleCount }, (_, i) => i);
  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      {/* Header shell — matches ChatHeaderShell layout */}
      <div data-chat-chrome="true" className="shrink-0 border-b bg-background px-2.5 py-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 min-h-14">
        <div className="h-12 w-12 shrink-0 flex items-center justify-center text-muted-foreground">
          <ChevronLeft className="h-5 w-5" />
        </div>
        <div className="flex min-w-0 items-center gap-2.5">
        {title ? (
          <ConversationAvatar type={avatarType} name={title} avatarUrl={avatarUrl} className="h-9 w-9 shrink-0" />
        ) : (
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          {title ? (
            <div className="flex min-w-0 items-center gap-1">
              <div className="text-[15px] font-semibold truncate">{title}</div>
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>
          ) : (
            <Skeleton className="h-3.5 w-32" />
          )}
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {subtitle || (avatarType === "dm" ? "Direct message" : avatarType === "team" ? "Team chat" : avatarType === "club" ? "Club chat" : avatarType === "league" ? "Mini-league chat" : avatarType === "support" ? "Support" : avatarType === "broadcast" ? "Announcements" : "Group chat")}
          </div>
        </div>
        </div>
        {/* Paint familiar chrome, but never grant actions from a remembered label. */}
        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="ghost" size="icon" className="h-9 w-9 disabled:opacity-100" disabled aria-label="Search messages" title="Search messages">
            <Search className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 disabled:opacity-100" disabled aria-label="Chat menu" title="Chat menu">
            <MoreVertical className="h-4 w-4" />
          </Button>
        </div>
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
