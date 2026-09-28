import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Trophy,
  Target,
  Plus,
  X,
  ChevronDown,
  Share2,
  StickyNote,
  Square,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { getSportScoreConfig, type SportScoreConfig } from "@/lib/sportScoreConfig";
import { formatResultSentence } from "@/lib/matchResultFormat";

/**
 * MatchResultSheet — sport-aware mobile-first result entry.
 *
 * The required path is always *enter two numbers → Save*. Per-player
 * stats, cards, awards, sport-specific extras (cricket wickets, AFL
 * behinds, volleyball/tennis per-set scores) live behind a single
 * "Add match statistics" disclosure so coaches can finish in seconds.
 *
 * Persistence: writes to `game_results` using the convention documented
 * in sportScoreConfig.ts.
 */

interface MatchResultSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  teamId: string;
  teamName: string;
  opponent: string | null;
  sport: string | null | undefined;
  /** Pre-expand the stats accordion (used by the post-save "Enter
   *  statistics" quick action). */
  defaultStatsOpen?: boolean;
}

interface RosterPlayer { id: string; name: string }
interface PlayerStatRow {
  id: string;
  name: string;
  goals: number;
  yellow?: number;
  red?: number;
  award?: string;
}
interface SetScore { home: string; away: string }

const OWN_ID = "__own__";
const DRAFT_KEY = (eventId: string) => `ignite_match_draft_${eventId}`;
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True when a non-empty, non-stale unsaved result draft exists for this
 * fixture. Surfaced on the result card so a typed-but-never-saved score
 * can't silently disappear from reports.
 */
export function hasUnsavedMatchResultDraft(eventId: string): boolean {
  try {
    const raw = localStorage.getItem(DRAFT_KEY(eventId));
    if (!raw) return false;
    const d = JSON.parse(raw) as { savedAt?: number; homeScore?: string; awayScore?: string };
    if (Date.now() - (d.savedAt || 0) > DRAFT_TTL_MS) return false;
    return !!(d.homeScore || d.awayScore);
  } catch {
    return false;
  }
}

interface DraftShape {
  homeScore: string;
  awayScore: string;
  homeMeta: Record<string, string>;
  awayMeta: Record<string, string>;
  sets: SetScore[];
  scorers: PlayerStatRow[];
  notes: string;
  savedAt: number;
}

const safeParseInt = (s: string, fallback = 0) => {
  const n = parseInt(s, 10);
  return isNaN(n) ? fallback : n;
};

export function MatchResultSheet({
  open,
  onOpenChange,
  eventId,
  teamId,
  teamName,
  opponent,
  sport,
  defaultStatsOpen = false,
}: MatchResultSheetProps) {
  const config = useMemo(() => getSportScoreConfig(sport), [sport]);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [homeScore, setHomeScore] = useState("");
  const [awayScore, setAwayScore] = useState("");
  // Sport-specific secondary stats per team (object form).
  const [homeMeta, setHomeMeta] = useState<Record<string, string>>({});
  const [awayMeta, setAwayMeta] = useState<Record<string, string>>({});
  // Volleyball / tennis per-set list (array form).
  const [sets, setSets] = useState<SetScore[]>([]);
  const [scorers, setScorers] = useState<PlayerStatRow[]>([]);
  const [pendingScorerId, setPendingScorerId] = useState("");
  const [notes, setNotes] = useState("");
  const [statsOpen, setStatsOpen] = useState(defaultStatsOpen);
  const [saving, setSaving] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  const homeFocusRef = useRef<HTMLInputElement | null>(null);

  // ── Existing saved row ─────────────────────────────────────────────
  const { data: result, isLoading } = useQuery({
    queryKey: ["match-result", eventId],
    queryFn: async () => {
      const { data } = await supabase
        .from("game_results")
        .select(
          "id, home_score, away_score, home_label, away_label, saved_by, player_stats, period_scores, notes"
        )
        .eq("event_id", eventId)
        .maybeSingle();
      return data;
    },
    enabled: !!eventId,
  });

  // ── Roster (lazy, only when sheet open) ────────────────────────────
  const { data: roster } = useQuery({
    queryKey: ["match-result-roster", teamId],
    queryFn: async (): Promise<RosterPlayer[]> => {
      const [childrenRes, rolesRes] = await Promise.all([
        supabase
          .from("child_team_assignments")
          .select("child_id, children(id, name)")
          .eq("team_id", teamId),
        supabase
          .from("user_roles")
          .select("user_id, role")
          .eq("team_id", teamId)
          .eq("role", "player"),
      ]);
      const children = (childrenRes.data || [])
        .map((r: any) => r.children)
        .filter(Boolean) as RosterPlayer[];
      const userIds = (rolesRes.data || []).map((r: any) => r.user_id);
      let adults: RosterPlayer[] = [];
      if (userIds.length) {
        const { data: profiles } = await selectCachedProfilesByIds(userIds);
        adults = (profiles || []).map((p: any) => ({
          id: p.id,
          name: p.display_name || "Player",
        }));
      }
      const seen = new Set<string>();
      const all = [...children, ...adults].filter((p) => {
        if (!p?.id || seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      all.sort((a, b) => a.name.localeCompare(b.name));
      return all;
    },
    enabled: !!teamId && open,
  });

  // ── Hydrate on open ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    // Prefer draft if it's newer than the saved row.
    let usedDraft = false;
    try {
      const raw = localStorage.getItem(DRAFT_KEY(eventId));
      if (raw) {
        const d = JSON.parse(raw) as DraftShape;
        const stale = Date.now() - (d.savedAt || 0) > DRAFT_TTL_MS;
        if (!stale) {
          setHomeScore(d.homeScore ?? "");
          setAwayScore(d.awayScore ?? "");
          setHomeMeta(d.homeMeta || {});
          setAwayMeta(d.awayMeta || {});
          setSets(d.sets || []);
          setScorers(d.scorers || []);
          setNotes(d.notes || "");
          setDraftRestored(true);
          usedDraft = true;
        } else {
          localStorage.removeItem(DRAFT_KEY(eventId));
        }
      }
    } catch {/* ignore corrupt draft */}

    if (!usedDraft) {
      setHomeScore(result?.home_score?.toString() ?? "");
      setAwayScore(result?.away_score?.toString() ?? "");

      const ps = result?.period_scores as any;
      if (Array.isArray(ps)) {
        setSets(
          ps.map((s: any) => ({
            home: String(s?.home ?? ""),
            away: String(s?.away ?? ""),
          }))
        );
        setHomeMeta({});
        setAwayMeta({});
      } else if (ps && typeof ps === "object") {
        const toStr = (src: any) => {
          const out: Record<string, string> = {};
          for (const s of config.secondaryStats || []) {
            const v = src?.[s.key];
            if (v !== undefined && v !== null && v !== "") out[s.key] = String(v);
          }
          return out;
        };
        setHomeMeta(toStr(ps.home));
        setAwayMeta(toStr(ps.away));
        setSets([]);
      } else {
        setHomeMeta({});
        setAwayMeta({});
        setSets([]);
      }

      const existing: PlayerStatRow[] = Array.isArray(result?.player_stats)
        ? (result!.player_stats as any[])
            .filter((p) => p && p.id)
            .map((p) => ({
              id: String(p.id),
              name: String(p.name || "Player"),
              goals: Number(p.goals) || 0,
              yellow: Number(p.yellow) || 0,
              red: Number(p.red) || 0,
            }))
        : [];
      setScorers(existing.filter((p) => (p.goals ?? 0) > 0 || p.yellow || p.red));
      setNotes((result?.notes as string) || "");
      setDraftRestored(false);
    }

    setStatsOpen(defaultStatsOpen);
    setPendingScorerId("");
  }, [open, result, eventId, config, defaultStatsOpen]);

  // Autofocus the first numeric input shortly after open so the keypad
  // appears without an extra tap. Delay matches the drawer open anim.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => homeFocusRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, [open]);

  // ── Draft autosave (debounced) ─────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      try {
        const d: DraftShape = {
          homeScore,
          awayScore,
          homeMeta,
          awayMeta,
          sets,
          scorers,
          notes,
          savedAt: Date.now(),
        };
        // Skip writing an "empty" draft so we don't fight a fresh open.
        const empty =
          !homeScore && !awayScore && !notes &&
          scorers.length === 0 && sets.length === 0 &&
          Object.keys(homeMeta).length === 0 && Object.keys(awayMeta).length === 0;
        if (empty) return;
        localStorage.setItem(DRAFT_KEY(eventId), JSON.stringify(d));
      } catch {/* quota or json */}
    }, 1500);
    return () => clearTimeout(t);
  }, [open, eventId, homeScore, awayScore, homeMeta, awayMeta, sets, scorers, notes]);

  // ── Derived ────────────────────────────────────────────────────────
  const labelHome = result?.home_label || teamName;
  const savedAway = result?.away_label;
  const labelAway =
    opponent ||
    (savedAway && savedAway.toLowerCase() !== "opponent" ? savedAway : "Opponent");

  // AFL: total points = goals*6 + behinds. Auto-derive from secondaryStats
  // so coaches only enter G + B per team.
  const aflHomeTotal = useMemo(() => {
    if (config.scoreLayout !== "afl") return null;
    const g = safeParseInt(homeMeta.goals || "0");
    const b = safeParseInt(homeMeta.behinds || "0");
    return g * 6 + b;
  }, [config.scoreLayout, homeMeta]);
  const aflAwayTotal = useMemo(() => {
    if (config.scoreLayout !== "afl") return null;
    const g = safeParseInt(awayMeta.goals || "0");
    const b = safeParseInt(awayMeta.behinds || "0");
    return g * 6 + b;
  }, [config.scoreLayout, awayMeta]);

  // Volleyball/Tennis: derive sets won from set scores if provided.
  const setsWonHome = useMemo(
    () => sets.reduce((n, s) => n + (safeParseInt(s.home) > safeParseInt(s.away) ? 1 : 0), 0),
    [sets]
  );
  const setsWonAway = useMemo(
    () => sets.reduce((n, s) => n + (safeParseInt(s.away) > safeParseInt(s.home) ? 1 : 0), 0),
    [sets]
  );

  // Effective scores actually saved.
  const effectiveHome =
    config.scoreLayout === "afl"
      ? aflHomeTotal ?? 0
      : config.scoreLayout === "sets" && sets.length > 0
        ? setsWonHome
        : safeParseInt(homeScore || "0");
  const effectiveAway =
    config.scoreLayout === "afl"
      ? aflAwayTotal ?? 0
      : config.scoreLayout === "sets" && sets.length > 0
        ? setsWonAway
        : safeParseInt(awayScore || "0");

  const previewSentence = useMemo(() => {
    if (!homeScore && !awayScore && sets.length === 0 && config.scoreLayout !== "afl") return null;
    if (config.scoreLayout === "afl" && !aflHomeTotal && !aflAwayTotal) return null;
    return formatResultSentence({
      config,
      homeLabel: labelHome,
      awayLabel: labelAway,
      homeScore: effectiveHome,
      awayScore: effectiveAway,
      periodScores:
        config.scoreLayout === "sets"
          ? sets.map((s) => ({ home: safeParseInt(s.home), away: safeParseInt(s.away) }))
          : { home: { ...homeMeta }, away: { ...awayMeta } },
    });
  }, [config, labelHome, labelAway, effectiveHome, effectiveAway, sets, homeMeta, awayMeta, homeScore, awayScore, aflHomeTotal, aflAwayTotal]);

  const totalAttributedGoals = scorers.reduce((sum, s) => sum + (s.goals || 0), 0);
  const overAttributed =
    config.supportsScorers &&
    totalAttributedGoals > effectiveHome &&
    effectiveHome >= 0;

  const availableToAdd = (roster || []).filter(
    (p) => !scorers.some((s) => s.id === p.id)
  );

  // ── Mutators ───────────────────────────────────────────────────────
  const addScorer = () => {
    if (!pendingScorerId) return;
    const isOwn = pendingScorerId === OWN_ID;
    const player = isOwn
      ? { id: OWN_ID, name: `Own ${config.unit} (opposition)` }
      : roster?.find((p) => p.id === pendingScorerId);
    if (!player) return;
    setScorers((prev) => {
      const existing = prev.find((s) => s.id === player.id);
      if (existing)
        return prev.map((s) =>
          s.id === player.id ? { ...s, goals: s.goals + 1 } : s
        );
      return [...prev, { id: player.id, name: player.name, goals: 1 }];
    });
    setPendingScorerId("");
  };
  const adjustGoals = (id: string, delta: number) =>
    setScorers((prev) =>
      prev
        .map((s) => (s.id === id ? { ...s, goals: Math.max(0, s.goals + delta) } : s))
        .filter((s) => s.goals > 0 || (s.yellow ?? 0) > 0 || (s.red ?? 0) > 0)
    );
  const removeScorer = (id: string) =>
    setScorers((prev) => prev.filter((s) => s.id !== id));

  const addSet = () => setSets((p) => [...p, { home: "", away: "" }]);
  const removeSet = (i: number) =>
    setSets((p) => p.filter((_, idx) => idx !== i));
  const updateSet = (i: number, side: "home" | "away", v: string) =>
    setSets((p) => p.map((s, idx) => (idx === i ? { ...s, [side]: v } : s)));

  const handleDiscardDraft = () => {
    try { localStorage.removeItem(DRAFT_KEY(eventId)); } catch {/* ignore */}
    setDraftRestored(false);
    setHomeScore(result?.home_score?.toString() ?? "");
    setAwayScore(result?.away_score?.toString() ?? "");
    setScorers([]);
    setNotes((result?.notes as string) || "");
    setHomeMeta({});
    setAwayMeta({});
    setSets([]);
  };

  // ── Save ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;
    if (effectiveHome < 0 || effectiveAway < 0) {
      toast({ title: "Invalid score", description: "Scores can't be negative.", variant: "destructive" });
      return;
    }
    if (overAttributed) {
      toast({
        title: "Too many scorers",
        description: `You attributed ${totalAttributedGoals} ${config.unitPlural} but ${labelHome} scored ${effectiveHome}.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      // Build period_scores payload by layout.
      let periodScoresPayload: any = [];
      if (config.scoreLayout === "sets") {
        periodScoresPayload = sets
          .filter((s) => s.home !== "" || s.away !== "")
          .map((s) => ({ home: safeParseInt(s.home), away: safeParseInt(s.away) }));
      } else if ((config.secondaryStats?.length ?? 0) > 0) {
        const toNum = (src: Record<string, string>) => {
          const out: Record<string, number> = {};
          for (const s of config.secondaryStats || []) {
            const raw = (src[s.key] ?? "").trim();
            if (raw === "") continue;
            const n = parseInt(raw, 10);
            if (!isNaN(n) && n >= 0) out[s.key] = Math.min(n, s.max);
          }
          return out;
        };
        periodScoresPayload = { home: toNum(homeMeta), away: toNum(awayMeta) };
      }

      // player_stats payload — scorers + cards only.
      const playerStatsPayload: any[] = scorers.map((s) => ({
        id: s.id,
        name: s.name,
        goals: s.goals,
        ...(s.yellow ? { yellow: s.yellow } : {}),
        ...(s.red ? { red: s.red } : {}),
      }));

      const payload = {
        team_id: teamId,
        event_id: eventId,
        sport: config.key,
        home_label: teamName,
        away_label: opponent || "Opponent",
        home_score: effectiveHome,
        away_score: effectiveAway,
        period_scores: periodScoresPayload,
        player_stats: playerStatsPayload as any,
        notes: notes.trim() ? notes.trim() : null,
        saved_by: user.id,
      };
      const { error } = await supabase
        .from("game_results")
        .upsert(payload, { onConflict: "event_id" });
      if (error) throw error;

      // Clear draft on success.
      try { localStorage.removeItem(DRAFT_KEY(eventId)); } catch {/* ignore */}

      const sentence = formatResultSentence({
        config,
        homeLabel: labelHome,
        awayLabel: labelAway,
        homeScore: effectiveHome,
        awayScore: effectiveAway,
        periodScores: periodScoresPayload,
      });

      toast({
        title: "Result saved",
        description: sentence,
        action: (
          <button
            type="button"
            onClick={() => {
              const text = sentence;
              if ((navigator as any).share) {
                (navigator as any).share({ text }).catch(() => {/* dismissed */});
              } else if (navigator.clipboard) {
                navigator.clipboard.writeText(text);
                toast({ title: "Copied to clipboard" });
              }
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
          >
            <Share2 className="h-3 w-3" /> Share
          </button>
        ) as any,
      });

      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: ["match-result", eventId] });
      queryClient.invalidateQueries({ queryKey: ["match-score", eventId] });
      queryClient.invalidateQueries({ queryKey: ["team-game-events", teamId] });
      queryClient.invalidateQueries({ queryKey: ["player-stats-report-extras", teamId] });
    } catch (err) {
      const msg = (err as Error).message;
      toast({
        title: "Couldn't save result",
        description: /row-level security/i.test(msg)
          ? "Only admins, coaches, or the assigned Subs Manager can record the result."
          : msg,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) return null;
  const hasSavedRow = !!result;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className="w-[calc(100vw-1rem)] max-w-md p-0 gap-0 max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col sm:top-1/2 sm:-translate-y-1/2"
      >
        <ResponsiveDialogHeader className="px-4 pt-4 pb-3 border-b">
          <ResponsiveDialogTitle className="text-base sm:text-lg flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Trophy className="h-4 w-4" />
            </span>
            {hasSavedRow ? `Edit ${config.title}` : config.entryTitle}
          </ResponsiveDialogTitle>
          {draftRestored && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Badge variant="secondary" className="font-normal">Draft restored</Badge>
              <button
                type="button"
                onClick={handleDiscardDraft}
                className="text-muted-foreground underline-offset-2 hover:underline"
              >
                Discard draft
              </button>
            </div>
          )}
        </ResponsiveDialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-4 space-y-4">
            {/* Primary score block */}
            <PrimaryScoreBlock
              config={config}
              labelHome={labelHome}
              labelAway={labelAway}
              homeScore={homeScore}
              awayScore={awayScore}
              setHomeScore={setHomeScore}
              setAwayScore={setAwayScore}
              homeMeta={homeMeta}
              awayMeta={awayMeta}
              setHomeMeta={setHomeMeta}
              setAwayMeta={setAwayMeta}
              sets={sets}
              setSets={setSets}
              addSet={addSet}
              removeSet={removeSet}
              updateSet={updateSet}
              setsWonHome={setsWonHome}
              setsWonAway={setsWonAway}
              aflHomeTotal={aflHomeTotal}
              aflAwayTotal={aflAwayTotal}
              homeInputRef={homeFocusRef}
            />

            {previewSentence && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-medium text-foreground">
                {previewSentence}
              </div>
            )}

            {/* Stats disclosure */}
            {config.optionalSections.length > 0 && (
              <button
                type="button"
                // Prevent focus shift so the on-screen keyboard stays up
                // and the score input keeps caret/focus when toggling.
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => e.preventDefault()}
                onTouchStart={(e) => e.stopPropagation()}
                onClick={() => setStatsOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2.5 text-sm font-medium hover:bg-muted/40 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" /> Add match statistics
                </span>
                <ChevronDown className={cn("h-4 w-4 transition-transform", statsOpen && "rotate-180")} />
              </button>
            )}

            {statsOpen && (
              <div className="space-y-5 pt-1">
                {config.optionalSections.includes("scorers") && config.supportsScorers && (
                  <ScorersSection
                    config={config}
                    scorers={scorers}
                    pendingScorerId={pendingScorerId}
                    setPendingScorerId={setPendingScorerId}
                    addScorer={addScorer}
                    adjustGoals={adjustGoals}
                    removeScorer={removeScorer}
                    availableToAdd={availableToAdd}
                    rosterCount={roster?.length ?? 0}
                    effectiveHome={effectiveHome}
                    totalAttributedGoals={totalAttributedGoals}
                    overAttributed={overAttributed}
                    labelHome={labelHome}
                  />
                )}

                {config.optionalSections.includes("cards") && (
                  <CardsSection
                    scorers={scorers}
                    setScorers={setScorers}
                    roster={roster || []}
                  />
                )}

                {config.optionalSections.includes("notes") && (
                  <NotesSection notes={notes} setNotes={setNotes} />
                )}
              </div>
            )}
          </div>
        </ScrollArea>

        <ResponsiveDialogFooter className="px-4 py-3 border-t bg-background/95 backdrop-blur pb-safe gap-2 flex-row sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || overAttributed}
            className="flex-[2] sm:flex-none h-11 text-base font-semibold"
          >
            {saving ? "Saving…" : "Save result"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

// ────────────────────────────────────────────────────────────────────
// Primary score block — switches on config.scoreLayout
// ────────────────────────────────────────────────────────────────────
interface PrimaryProps {
  config: SportScoreConfig;
  labelHome: string;
  labelAway: string;
  homeScore: string;
  awayScore: string;
  setHomeScore: (v: string) => void;
  setAwayScore: (v: string) => void;
  homeMeta: Record<string, string>;
  awayMeta: Record<string, string>;
  setHomeMeta: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setAwayMeta: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sets: SetScore[];
  setSets: React.Dispatch<React.SetStateAction<SetScore[]>>;
  addSet: () => void;
  removeSet: (i: number) => void;
  updateSet: (i: number, side: "home" | "away", v: string) => void;
  setsWonHome: number;
  setsWonAway: number;
  aflHomeTotal: number | null;
  aflAwayTotal: number | null;
  homeInputRef: React.MutableRefObject<HTMLInputElement | null>;
}

function PrimaryScoreBlock(p: PrimaryProps) {
  const { config, labelHome, labelAway } = p;

  // AFL: two pairs with auto total
  if (config.scoreLayout === "afl") {
    return (
      <div className="space-y-3">
        <TeamLabels home={labelHome} away={labelAway} />
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
          <AflTeamColumn
            side="home"
            meta={p.homeMeta}
            setMeta={p.setHomeMeta}
            total={p.aflHomeTotal ?? 0}
          />
          <div className="text-lg font-bold text-muted-foreground">–</div>
          <AflTeamColumn side="away" meta={p.awayMeta} setMeta={p.setAwayMeta} total={p.aflAwayTotal ?? 0} />
        </div>
      </div>
    );
  }

  // Cricket: runs + wickets per team (+ optional overs)
  if (config.scoreLayout === "cricket") {
    return (
      <div className="space-y-3">
        <TeamLabels home={labelHome} away={labelAway} />
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
          <CricketTeamColumn
            side="home"
            runs={p.homeScore}
            setRuns={p.setHomeScore}
            meta={p.homeMeta}
            setMeta={p.setHomeMeta}
            sport={config}
          />
          <div className="pb-3 text-lg font-bold text-muted-foreground">vs</div>
          <CricketTeamColumn
            side="away"
            runs={p.awayScore}
            setRuns={p.setAwayScore}
            meta={p.awayMeta}
            setMeta={p.setAwayMeta}
            sport={config}
          />
        </div>
      </div>
    );
  }


  // Sets layout (volleyball / tennis)
  if (config.scoreLayout === "sets") {
    return (
      <div className="space-y-3">
        <TeamLabels home={labelHome} away={labelAway} />
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <BigScoreInput
            id="home-sets"
            value={p.sets.length > 0 ? String(p.setsWonHome) : p.homeScore}
            onChange={p.setHomeScore}
            readOnly={p.sets.length > 0}
            label="Sets"
            inputRef={p.homeInputRef}
            max={config.maxScore}
          />
          <div className="pb-4 text-xl font-bold text-muted-foreground">–</div>
          <BigScoreInput
            id="away-sets"
            value={p.sets.length > 0 ? String(p.setsWonAway) : p.awayScore}
            onChange={p.setAwayScore}
            readOnly={p.sets.length > 0}
            label="Sets"
            max={config.maxScore}
          />
        </div>

        <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Set-by-set scores (optional)</span>
            <Button type="button" size="sm" variant="ghost" onClick={p.addSet} className="h-7 px-2">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add set
            </Button>
          </div>
          {p.sets.length === 0 ? (
            <p className="text-xs text-muted-foreground">Add per-set scores to auto-fill sets won.</p>
          ) : (
            <div className="space-y-1.5">
              {p.sets.map((s, i) => (
                <div key={i} className="grid grid-cols-[24px_1fr_auto_1fr_28px] items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">S{i + 1}</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={s.home}
                    onChange={(e) => p.updateSet(i, "home", e.target.value)}
                    placeholder="0"
                    className="h-9 text-center font-semibold"
                  />
                  <span className="text-muted-foreground text-sm">–</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={s.away}
                    onChange={(e) => p.updateSet(i, "away", e.target.value)}
                    placeholder="0"
                    className="h-9 text-center font-semibold"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => p.removeSet(i)}
                    className="h-7 w-7"
                    aria-label="Remove set"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Default: one pair + optional secondary stats per team
  return (
    <div className="space-y-3">
      <TeamLabels home={labelHome} away={labelAway} />
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
        <BigScoreInput
          id="home-score"
          value={p.homeScore}
          onChange={p.setHomeScore}
          label={config.teamScoreLabel}
          inputRef={p.homeInputRef}
          max={config.maxScore}
        />
        <div className="pb-4 text-xl font-bold text-muted-foreground">–</div>
        <BigScoreInput
          id="away-score"
          value={p.awayScore}
          onChange={p.setAwayScore}
          label={config.teamScoreLabel}
          max={config.maxScore}
        />
      </div>

      {(config.secondaryStats?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {config.secondaryStats!.map((s) => (
            <div key={s.key} className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
              <SmallStatInput
                id={`home-${s.key}`}
                label={s.label}
                value={p.homeMeta[s.key] ?? ""}
                onChange={(v) => p.setHomeMeta((m) => ({ ...m, [s.key]: v }))}
                max={s.max}
              />
              <div className="pb-2 text-xs font-semibold text-muted-foreground">{s.short}</div>
              <SmallStatInput
                id={`away-${s.key}`}
                label={s.label}
                value={p.awayMeta[s.key] ?? ""}
                onChange={(v) => p.setAwayMeta((m) => ({ ...m, [s.key]: v }))}
                max={s.max}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeamLabels({ home, away }: { home: string; away: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
      <p className="text-sm font-semibold truncate">{home}</p>
      <span className="text-xs uppercase tracking-wider text-muted-foreground">vs</span>
      <p className="text-sm font-semibold truncate text-right">{away}</p>
    </div>
  );
}

function BigScoreInput({
  id, value, onChange, label, inputRef, max, readOnly,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
  max: number;
  readOnly?: boolean;
}) {
  return (
    <div className="min-w-0">
      <Input
        id={id}
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        className={cn(
          "text-center text-3xl sm:text-4xl font-black h-16 sm:h-20 tabular-nums px-1",
          readOnly && "bg-muted/40"
        )}
        placeholder="0"
      />
      <Label htmlFor={id} className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center mt-1">
        {label}
      </Label>
    </div>
  );
}

function SmallStatInput({
  id, label, value, onChange, max,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void; max: number;
}) {
  return (
    <div className="min-w-0">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        className="text-center text-base font-semibold h-10 px-1 tabular-nums"
        placeholder="0"
      />
      <Label htmlFor={id} className="text-[10px] uppercase tracking-wider text-muted-foreground block text-center mt-1">
        {label}
      </Label>
    </div>
  );
}

function AflTeamColumn({
  side, meta, setMeta, total,
}: {
  side: "home" | "away";
  meta: Record<string, string>;
  setMeta: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  total: number;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <SmallStatInput
          id={`${side}-goals`}
          label="Goals"
          value={meta.goals ?? ""}
          onChange={(v) => setMeta((m) => ({ ...m, goals: v }))}
          max={40}
        />
        <SmallStatInput
          id={`${side}-behinds`}
          label="Behinds"
          value={meta.behinds ?? ""}
          onChange={(v) => setMeta((m) => ({ ...m, behinds: v }))}
          max={40}
        />
      </div>
      <div className="text-center">
        <div className="text-2xl font-black tabular-nums">{total}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
      </div>
    </div>
  );
}

function CricketTeamColumn({
  side, runs, setRuns, meta, setMeta, sport,
}: {
  side: "home" | "away";
  runs: string;
  setRuns: (v: string) => void;
  meta: Record<string, string>;
  setMeta: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  sport: SportScoreConfig;
}) {
  return (
    <div className="space-y-2 min-w-0">
      <BigScoreInput
        id={`${side}-runs`}
        value={runs}
        onChange={setRuns}
        label="Runs"
        max={sport.maxScore}
      />
      <div className="grid grid-cols-2 gap-2">
        <SmallStatInput
          id={`${side}-wkts`}
          label="Wickets"
          value={meta.wickets ?? ""}
          onChange={(v) => setMeta((m) => ({ ...m, wickets: v }))}
          max={10}
        />
        <SmallStatInput
          id={`${side}-overs`}
          label="Overs"
          value={meta.overs ?? ""}
          onChange={(v) => setMeta((m) => ({ ...m, overs: v }))}
          max={100}
        />
      </div>
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────
// Optional sections
// ────────────────────────────────────────────────────────────────────
function ScorersSection({
  config, scorers, pendingScorerId, setPendingScorerId, addScorer,
  adjustGoals, removeScorer, availableToAdd, rosterCount, effectiveHome,
  totalAttributedGoals, overAttributed, labelHome,
}: {
  config: SportScoreConfig;
  scorers: PlayerStatRow[];
  pendingScorerId: string;
  setPendingScorerId: (v: string) => void;
  addScorer: () => void;
  adjustGoals: (id: string, delta: number) => void;
  removeScorer: (id: string) => void;
  availableToAdd: RosterPlayer[];
  rosterCount: number;
  effectiveHome: number;
  totalAttributedGoals: number;
  overAttributed: boolean;
  labelHome: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-sm">
          <Target className="h-4 w-4 text-primary" /> {config.scorersLabel}
        </Label>
        <span className={cn(
          "text-xs tabular-nums",
          overAttributed ? "text-destructive font-medium" : "text-muted-foreground"
        )}>
          {totalAttributedGoals}{effectiveHome >= 0 && ` / ${effectiveHome}`}
        </span>
      </div>

      <div className="flex gap-2">
        <Select value={pendingScorerId} onValueChange={setPendingScorerId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={`Add ${config.unit} scorer…`} />
          </SelectTrigger>
          <SelectContent className="max-h-64 z-[1000010]">
            {config.allowOwnGoal && !scorers.some((s) => s.id === OWN_ID) && (
              <SelectItem value={OWN_ID}>Own {config.unit} (opposition)</SelectItem>
            )}
            {availableToAdd.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                {rosterCount ? "All players added" : "No players found"}
              </div>
            ) : (
              availableToAdd.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        <Button type="button" size="icon" variant="outline" onClick={addScorer} disabled={!pendingScorerId} aria-label="Add scorer">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {scorers.length > 0 && (
        <div className="space-y-1.5">
          {scorers.filter((s) => s.goals > 0).map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-md border p-2">
              <span className="flex-1 text-sm truncate">{s.name}</span>
              <div className="flex items-center gap-1">
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => adjustGoals(s.id, -1)}>–</Button>
                <span className="w-6 text-center text-sm font-semibold tabular-nums">{s.goals}</span>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => adjustGoals(s.id, +1)}>+</Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => removeScorer(s.id)} aria-label="Remove">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {overAttributed && (
        <p className="text-xs text-destructive">
          You've attributed more {config.unitPlural} than {labelHome} scored.
        </p>
      )}
    </section>
  );
}

function CardsSection({
  scorers, setScorers, roster,
}: {
  scorers: PlayerStatRow[];
  setScorers: React.Dispatch<React.SetStateAction<PlayerStatRow[]>>;
  roster: RosterPlayer[];
}) {
  const [pendingId, setPendingId] = useState("");

  const adjust = (id: string, key: "yellow" | "red", delta: number) =>
    setScorers((prev) =>
      prev
        .map((s) =>
          s.id === id ? { ...s, [key]: Math.max(0, (s[key] ?? 0) + delta) } : s
        )
        .filter((s) => s.goals > 0 || (s.yellow ?? 0) > 0 || (s.red ?? 0) > 0)
    );

  const addCardedPlayer = () => {
    if (!pendingId) return;
    const player = roster.find((p) => p.id === pendingId);
    if (!player) return;
    setScorers((prev) => {
      if (prev.some((s) => s.id === pendingId)) return prev;
      return [...prev, { id: player.id, name: player.name, goals: 0, yellow: 1 }];
    });
    setPendingId("");
  };

  const withCards = scorers.filter((s) => (s.yellow ?? 0) > 0 || (s.red ?? 0) > 0);
  const available = roster.filter((p) => !scorers.some((s) => s.id === p.id));

  return (
    <section className="space-y-2">
      <Label className="flex items-center gap-1.5 text-sm">
        <Square className="h-4 w-4 fill-yellow-400 text-yellow-500" /> Cards
      </Label>
      <div className="flex gap-2">
        <Select value={pendingId} onValueChange={setPendingId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Add a carded player…" />
          </SelectTrigger>
          <SelectContent className="max-h-64 z-[1000010]">
            {available.length === 0 ? (
              <div className="px-2 py-3 text-xs text-muted-foreground">All players added</div>
            ) : (
              available.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)
            )}
          </SelectContent>
        </Select>
        <Button type="button" size="icon" variant="outline" onClick={addCardedPlayer} disabled={!pendingId}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {withCards.length > 0 && (
        <div className="space-y-1.5">
          {withCards.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-md border p-2">
              <span className="flex-1 text-sm truncate">{s.name}</span>
              <CardCounter
                color="yellow"
                value={s.yellow ?? 0}
                onMinus={() => adjust(s.id, "yellow", -1)}
                onPlus={() => adjust(s.id, "yellow", +1)}
              />
              <CardCounter
                color="red"
                value={s.red ?? 0}
                onMinus={() => adjust(s.id, "red", -1)}
                onPlus={() => adjust(s.id, "red", +1)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CardCounter({
  color, value, onMinus, onPlus,
}: { color: "yellow" | "red"; value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={onMinus}>–</Button>
      <Square
        className={cn(
          "h-3.5 w-3.5",
          color === "yellow" ? "fill-yellow-400 text-yellow-500" : "fill-red-500 text-red-600"
        )}
      />
      <span className="w-4 text-center text-xs font-semibold tabular-nums">{value}</span>
      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={onPlus}>+</Button>
    </div>
  );
}

function NotesSection({ notes, setNotes }: { notes: string; setNotes: (v: string) => void }) {
  return (
    <section className="space-y-2">
      <Label className="flex items-center gap-1.5 text-sm">
        <StickyNote className="h-4 w-4 text-primary" /> Match notes
      </Label>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything worth remembering — key moments, weather, conditions…"
        rows={3}
        maxLength={500}
        className="resize-none"
      />
      <p className="text-[10px] text-muted-foreground text-right tabular-nums">{notes.length}/500</p>
    </section>
  );
}

export default MatchResultSheet;
