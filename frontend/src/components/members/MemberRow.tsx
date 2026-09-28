import { Check } from "lucide-react";
import { Avatar, AvatarImage } from "@/components/ui/avatar";
import { HighlightedText } from "@/components/vault/HighlightedText";
import { cn } from "@/lib/utils";
import {
  avatarGradient,
  avatarInitials,
  ROLE_BADGE_CLASS,
  type MemberIdentity,
} from "@/lib/memberIdentity";

export interface MemberRowProps {
  name: string;
  avatarUrl?: string | null;
  identity: MemberIdentity;
  selected: boolean;
  query?: string;
  onToggle: () => void;
}

/**
 * Lightweight, scannable picker row. WhatsApp/Discord-like:
 * - colored fallback avatar
 * - bold name with highlighted matches
 * - compact secondary context line ("Coach • U7 Red", "Parent of Noah")
 * - small role chip
 * - whole-row selection state with animated checkmark
 */
export function MemberRow({
  name,
  avatarUrl,
  identity,
  selected,
  query,
  onToggle,
}: MemberRowProps) {
  const { primaryRole, roleLabel, contextLine } = identity;
  const initials = avatarInitials(name);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all touch-manipulation active:scale-[0.99] border",
        selected
          ? "bg-primary/10 border-primary/40 shadow-sm"
          : "border-transparent hover:bg-muted/60",
      )}
    >
      <div className="relative shrink-0">
        <Avatar
          className={cn(
            "h-11 w-11 ring-2 transition-all",
            selected ? "ring-primary" : "ring-transparent",
          )}
        >
          {avatarUrl ? (
            <AvatarImage src={avatarUrl} />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-sm font-semibold text-white"
              style={{ background: avatarGradient(name) }}
              aria-hidden
            >
              {initials}
            </div>
          )}
        </Avatar>
        {primaryRole && (
          <span
            aria-hidden
            className={cn(
              "absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background",
              primaryRole === "coach" || primaryRole === "team_admin"
                ? "bg-accent"
                : primaryRole === "player"
                  ? "bg-emerald-500"
                  : primaryRole === "parent"
                    ? "bg-sky-500"
                    : "bg-primary",
            )}
          />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <HighlightedText
            text={name}
            query={query}
            className="font-medium text-sm truncate text-foreground"
          />
          {primaryRole && (
            <span
              className={cn(
                "shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md border",
                ROLE_BADGE_CLASS[primaryRole],
              )}
            >
              {roleLabel}
            </span>
          )}
        </div>
        {contextLine && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            <HighlightedText text={contextLine} query={query} />
          </p>
        )}
      </div>

      <div
        aria-hidden
        className={cn(
          "h-6 w-6 rounded-full border-2 shrink-0 flex items-center justify-center transition-all",
          selected
            ? "bg-primary border-primary scale-100"
            : "border-muted-foreground/30 scale-95",
        )}
      >
        <Check
          className={cn(
            "h-3.5 w-3.5 text-primary-foreground transition-all",
            selected ? "opacity-100 scale-100" : "opacity-0 scale-50",
          )}
          strokeWidth={3}
        />
      </div>
    </button>
  );
}
