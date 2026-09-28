import { Badge } from "@/components/ui/badge";
import { detectTeamColor } from "@/lib/teamColor";

interface TeamChipProps {
  teamName?: string | null;
  /** Used when there is no team (e.g. club-wide events). */
  fallbackLabel?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /**
   * When true, renders the team identity as a primary title (no chip background,
   * larger weight) — meant to be the strongest scanning anchor on event cards.
   */
  asTitle?: boolean;
}

function isLightHex(hex: string) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.85;
}

/**
 * Team identity chip used across all event cards. The team is the primary
 * scanning anchor — it should be the most prominent text on the card.
 */
export function TeamChip({ teamName, fallbackLabel = "Club event", size = "md", className = "", asTitle = false }: TeamChipProps) {
  const label = teamName || fallbackLabel;
  const teamColor = teamName ? detectTeamColor(teamName) : null;
  const lightColor = teamColor ? isLightHex(teamColor.hex) : false;

  // ── Title variant: no chip background, larger weight, just dot + name ──
  if (asTitle) {
    const titleSize =
      size === "lg"
        ? "text-[17px]"
        : size === "sm"
          ? "text-[13px]"
          : "text-[15px]";
    const dotSize = size === "lg" ? "h-2.5 w-2.5" : "h-2 w-2";
    return (
      <h3
        className={`font-bold leading-tight text-foreground inline-flex items-center gap-2 min-w-0 max-w-full ${titleSize} ${className}`}
      >
        {teamColor && (
          <span
            className={`inline-block rounded-full shrink-0 ${dotSize}`}
            style={{
              backgroundColor: teamColor.hex,
              boxShadow: lightColor
                ? `0 0 0 1px hsl(var(--border)), 0 0 0 2px hsl(var(--background))`
                : `0 0 0 1.5px ${teamColor.hex}66`,
            }}
            aria-hidden="true"
          />
        )}
        <span className="truncate">{label}</span>
      </h3>
    );
  }

  const sizeClass =
    size === "lg"
      ? "text-sm h-7 px-3 gap-2"
      : size === "sm"
        ? "text-[11px] h-5 px-2 gap-1.5"
        : "text-[12px] h-6 px-2.5 gap-1.5";

  const chipStyle = teamColor && !lightColor
    ? {
        backgroundColor: `${teamColor.hex}26`,
        color: teamColor.hex,
        borderColor: `${teamColor.hex}66`,
      }
    : undefined;

  const baseClass = teamColor
    ? lightColor
      ? "font-bold bg-muted text-foreground border border-border max-w-full truncate inline-flex items-center"
      : "font-bold border max-w-full truncate inline-flex items-center"
    : "font-bold bg-primary/10 text-primary border border-primary/20 max-w-full truncate inline-flex items-center";

  return (
    <Badge
      variant="secondary"
      style={chipStyle}
      className={`${baseClass} ${sizeClass} ${className}`}
    >
      {teamColor && (
        <span
          className="inline-block h-2 w-2 rounded-full shrink-0"
          style={{
            backgroundColor: teamColor.hex,
            boxShadow: lightColor
              ? `0 0 0 1px hsl(var(--border))`
              : `0 0 0 1px ${teamColor.hex}99`,
          }}
        />
      )}
      <span className="truncate">{label}</span>
    </Badge>
  );
}

/**
 * Returns the team color hex for use as a left rail / accent on a card.
 * Falls back to null when no color can be detected — callers should default
 * to `--primary` in that case.
 */
export function getTeamRailColor(teamName?: string | null): string | null {
  if (!teamName) return null;
  const c = detectTeamColor(teamName);
  return c?.hex || null;
}
