import { useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trophy, Download, Share2, Star, Save, Check, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Sport-agnostic player row used in the summary table.
 * Both basketball & netball boards map their internal Player objects to this.
 */
export interface SummaryPlayerStat {
  id: string;
  name: string;
  /** Total seconds played */
  secondsPlayed: number;
  /** Optional per-sport extras (basketball) */
  points?: number;
  fouls?: number;
  isFouledOut?: boolean;
  isInjured?: boolean;
  /** Position(s) played for the quick subtitle */
  finalPosition?: string | null;
}

export interface PerQuarterScore {
  quarter: number;
  home: number;
  away: number;
}

export interface GameSummaryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sport: "basketball" | "netball";
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  perQuarter: PerQuarterScore[];
  players: SummaryPlayerStat[];
  /** Optional MVP — player.id from `players` */
  mvpPlayerId?: string | null;
  /** Allow coach to set / change MVP from inside the summary. */
  onSelectMvp?: (playerId: string | null) => void;
  /** Read-only mode hides MVP edit + sharing. */
  readOnly?: boolean;
  /** Optional manual save-to-history callback. When provided, a "Save to history" button appears. */
  onSaveNow?: () => Promise<void> | void;
  /** When true, the save button shows a "Saved" check state (parent controls). */
  isSaved?: boolean;
}

const fmtTime = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export default function GameSummaryDialog({
  open,
  onOpenChange,
  sport,
  homeLabel,
  awayLabel,
  homeScore,
  awayScore,
  perQuarter,
  players,
  mvpPlayerId,
  onSelectMvp,
  readOnly = false,
  onSaveNow,
  isSaved = false,
}: GameSummaryProps) {
  const { toast } = useToast();
  const cardRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const result = useMemo(() => {
    if (homeScore > awayScore) return "WIN";
    if (homeScore < awayScore) return "LOSS";
    return "DRAW";
  }, [homeScore, awayScore]);

  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) => {
      // Top scorers first, then most minutes
      const ap = a.points ?? 0;
      const bp = b.points ?? 0;
      if (ap !== bp) return bp - ap;
      return b.secondsPlayed - a.secondsPlayed;
    });
  }, [players]);

  const mvp = useMemo(
    () => players.find((p) => p.id === mvpPlayerId) ?? null,
    [players, mvpPlayerId]
  );

  const renderToCanvas = async (): Promise<HTMLCanvasElement> => {
    // Render the visible card via html-to-image; loaded lazily so the dialog
    // stays light when never opened.
    const { toCanvas } = await import("html-to-image");
    if (!cardRef.current) throw new Error("Card not mounted");
    return toCanvas(cardRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      // Use a real bg colour rather than `var(--background)` so PNGs aren't
      // transparent on light/dark exports.
      backgroundColor:
        getComputedStyle(document.documentElement)
          .getPropertyValue("--background")
          .trim()
          ? `hsl(${getComputedStyle(document.documentElement)
              .getPropertyValue("--background")
              .trim()})`
          : "#ffffff",
    });
  };

  const handleDownload = async () => {
    try {
      setBusy(true);
      const canvas = await renderToCanvas();
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/png")
      );
      if (!blob) throw new Error("Could not encode PNG");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeAway = awayLabel.replace(/[^\w-]+/g, "_");
      a.href = url;
      a.download = `${homeLabel.replace(/[^\w-]+/g, "_")}_vs_${safeAway}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Saved", description: "Summary image downloaded." });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    try {
      setBusy(true);
      const canvas = await renderToCanvas();
      const blob: Blob | null = await new Promise((res) =>
        canvas.toBlob((b) => res(b), "image/png")
      );
      if (!blob) throw new Error("Could not encode PNG");
      const file = new File([blob], "game-summary.png", { type: "image/png" });
      const shareData: ShareData = {
        title: `${homeLabel} ${homeScore}–${awayScore} ${awayLabel}`,
        text: `Final: ${homeLabel} ${homeScore}–${awayScore} ${awayLabel}${
          mvp ? ` · MVP ${mvp.name}` : ""
        }`,
        files: [file],
      };
      // Some browsers don't support file sharing — fall back to text-only
      // share, then to clipboard, then to download.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share(shareData);
      } else if (navigator.share) {
        await navigator.share({ title: shareData.title, text: shareData.text });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${shareData.title}\n${shareData.text}`);
        toast({ title: "Copied to clipboard" });
      } else {
        await handleDownload();
      }
    } catch (e) {
      // User-cancelled share is not an error worth surfacing.
      const msg = e instanceof Error ? e.message : "Unknown error";
      if (!/abort/i.test(msg)) {
        toast({ title: "Share failed", description: msg, variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col gap-3 p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            Game summary
          </DialogTitle>
          <DialogDescription className="text-xs">
            Review final stats, pick a Player of the Match, and share.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 px-4">
          {/* Card that gets exported */}
          <div
            ref={cardRef}
            className="rounded-xl border bg-card text-card-foreground p-4 space-y-4"
          >
            {/* Score header */}
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                Full time · {sport === "basketball" ? "Basketball" : "Netball"}
              </p>
              <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="text-right">
                  <p className="text-xs text-muted-foreground truncate">{homeLabel}</p>
                  <p className="text-3xl font-black tabular-nums">{homeScore}</p>
                </div>
                <p className="text-xs text-muted-foreground">vs</p>
                <div className="text-left">
                  <p className="text-xs text-muted-foreground truncate">{awayLabel}</p>
                  <p className="text-3xl font-black tabular-nums">{awayScore}</p>
                </div>
              </div>
              <p
                className={
                  "mt-1 inline-block text-[10px] font-bold px-2 py-0.5 rounded-full " +
                  (result === "WIN"
                    ? "bg-primary/15 text-primary"
                    : result === "LOSS"
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground")
                }
              >
                {result}
              </p>
            </div>

            {/* Per-quarter strip */}
            {perQuarter.length > 0 && (
              <div className="grid grid-cols-4 gap-1 text-center">
                {perQuarter.map((q) => (
                  <div key={q.quarter} className="rounded-md bg-muted/40 py-1">
                    <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                      Q{q.quarter}
                    </p>
                    <p className="text-xs font-semibold tabular-nums">
                      {q.home}–{q.away}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* MVP */}
            {mvp && (
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
                <Star className="h-4 w-4 text-primary fill-primary" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-widest text-primary font-bold">
                    Player of the Match
                  </p>
                  <p className="text-sm font-semibold truncate">
                    {mvp.name}
                    {mvp.points != null && mvp.points > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                        · {mvp.points} pts
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* Player stats */}
            <div>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
                Player stats
              </p>
              <div className="space-y-1">
                {sortedPlayers.map((p) => {
                  const isMvp = p.id === mvpPlayerId;
                  return (
                    <div
                      key={p.id}
                      className={
                        "flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs " +
                        (isMvp ? "bg-primary/10" : "bg-muted/30")
                      }
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isMvp && <Star className="h-3 w-3 text-primary fill-primary shrink-0" />}
                        <span className="font-medium truncate">{p.name}</span>
                        {p.finalPosition && (
                          <span className="text-[9px] text-muted-foreground shrink-0">
                            · {p.finalPosition}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] tabular-nums shrink-0">
                        <span className="text-muted-foreground" title="Time on court">
                          {fmtTime(p.secondsPlayed)}
                        </span>
                        {sport === "basketball" && (
                          <>
                            <span className="font-semibold" title="Points">
                              {p.points ?? 0}p
                            </span>
                            <span
                              className={
                                "text-[10px] " +
                                (p.isFouledOut
                                  ? "text-destructive font-semibold"
                                  : "text-muted-foreground")
                              }
                              title="Fouls"
                            >
                              {p.fouls ?? 0}F
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* MVP picker — outside the exported card */}
          {!readOnly && onSelectMvp && (
            <div className="mt-3 pb-2">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">
                Pick Player of the Match
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sortedPlayers.map((p) => {
                  const isMvp = p.id === mvpPlayerId;
                  return (
                    <Button
                      key={p.id}
                      type="button"
                      variant={isMvp ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => onSelectMvp(isMvp ? null : p.id)}
                    >
                      {isMvp && <Star className="h-3 w-3 mr-1 fill-current" />}
                      {p.name.split(" ")[0]}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
        </ScrollArea>

        <div className="flex flex-col gap-2 px-4 pb-4 pt-1 border-t">
          {!readOnly && onSaveNow && (
            <Button
              variant={isSaved ? "secondary" : "default"}
              className="w-full"
              onClick={async () => {
                if (saving || isSaved) return;
                setSaving(true);
                try {
                  await onSaveNow();
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving || busy}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : isSaved ? (
                <Check className="h-4 w-4 mr-1.5" />
              ) : (
                <Save className="h-4 w-4 mr-1.5" />
              )}
              {isSaved ? "Saved to history" : "Save to history"}
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={handleDownload} disabled={busy}>
              <Download className="h-4 w-4 mr-1.5" />
              Download
            </Button>
            <Button className="flex-1" onClick={handleShare} disabled={busy}>
              <Share2 className="h-4 w-4 mr-1.5" />
              Share
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
