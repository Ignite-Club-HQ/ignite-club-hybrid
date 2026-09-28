import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Flame,
  Trophy,
  ChevronDown,
  Loader2,
  ClipboardList,
  MessageCircle,
  Camera,
  CalendarCheck,
  Award,
  Gift,
  Sparkles,
  ListFilter,
  ImagePlus,
} from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCountUp } from "@/hooks/useCountUp";
import { cn } from "@/lib/utils";
import type { SeasonStatus } from "@/hooks/useClubSeasons";

export type PointsActivityItem = {
  id: string;
  type: "earned" | "spent";
  points: number;
  name: string;
  context: string;
  date: string;
  eventId?: string;
  sourceType?: string | null;
};

interface PointsActivityFeedProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  items: PointsActivityItem[];
  balance: number;
  earned: number;
  spent: number;
  rank?: { rank: number; total: number; points?: number } | null;
  seasons?: { id: string; name: string; status: SeasonStatus }[];
  selectedSeasonId: string;
  onSeasonChange: (id: string) => void;
  showSeasonFilter: boolean;
  untrackedNote?: string | null;
}

function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Translate raw description / source_type into an action-based label
 * that emphasises the *behaviour* rather than the system event.
 */
function humaniseAction(item: PointsActivityItem): { label: string; Icon: typeof Flame; tone: string } {
  const src = item.sourceType ?? "";
  const name = item.name ?? "";

  if (item.type === "spent") {
    return { label: `Redeemed: ${name || "Reward"}`, Icon: Gift, tone: "text-rose-600 bg-rose-500/10" };
  }

  switch (src) {
    case "chat_engagement":
      return { label: "Posted in team chat", Icon: MessageCircle, tone: "text-sky-600 bg-sky-500/10" };
    case "weekly_chat_streak":
      return { label: "Weekly chat streak 🔥", Icon: Flame, tone: "text-orange-600 bg-orange-500/10" };
    case "photo_upload":
      return { label: "Shared a team photo", Icon: ImagePlus, tone: "text-violet-600 bg-violet-500/10" };
    case "weekly_photo_streak":
      return { label: "Weekly photo streak 🔥", Icon: Flame, tone: "text-orange-600 bg-orange-500/10" };
    case "photo_comment":
      return { label: "Commented on a photo", Icon: Camera, tone: "text-fuchsia-600 bg-fuchsia-500/10" };
    case "early_rsvp":
      return { label: "RSVP'd early to event", Icon: CalendarCheck, tone: "text-emerald-600 bg-emerald-500/10" };
    case "attendance":
      return { label: "Attended event", Icon: CalendarCheck, tone: "text-emerald-600 bg-emerald-500/10" };
    case "duty":
      return { label: name || "Completed a duty", Icon: ClipboardList, tone: "text-amber-600 bg-amber-500/10" };
    case "player_of_match":
      return { label: "Player of the Match", Icon: Trophy, tone: "text-yellow-600 bg-yellow-500/10" };
    case "admin_award":
      return { label: name || "Admin awarded points", Icon: Award, tone: "text-primary bg-primary/10" };
    default:
      return { label: name || "Earned points", Icon: Sparkles, tone: "text-primary bg-primary/10" };
  }
}

export function PointsActivityFeed({
  open,
  onOpenChange,
  loading,
  items,
  balance,
  earned,
  spent,
  rank,
  seasons = [],
  selectedSeasonId,
  onSeasonChange,
  showSeasonFilter,
  untrackedNote,
}: PointsActivityFeedProps) {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const animatedBalance = useCountUp(balance);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-3 cursor-pointer hover:bg-muted/40 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Flame className="h-5 w-5 text-primary" />
                  Points History
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">How you're earning points</p>
              </div>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform shrink-0 mt-1",
                  open ? "" : "-rotate-90",
                )}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        {/* Always-visible summary */}
        <CardContent className="pt-0 pb-3 space-y-3">
          <div className="rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/10 p-4">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-primary tabular-nums">{animatedBalance}</span>
              <span className="text-sm text-muted-foreground">pts</span>
            </div>
            <p className="text-xs font-medium text-muted-foreground mt-0.5">Current Balance</p>
            <div className="flex items-center gap-2 text-xs mt-2">
              <span className="text-emerald-600 font-medium">+{earned} earned</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-muted-foreground">{spent} spent</span>
            </div>
          </div>

          {rank && (
            <button
              type="button"
              onClick={() => navigate("/leaderboard")}
              className="w-full flex items-center gap-3 rounded-lg border bg-card p-3 text-left hover:bg-accent transition-colors touch-manipulation"
            >
              <div className="h-9 w-9 rounded-full bg-yellow-500/15 text-yellow-600 flex items-center justify-center shrink-0">
                <Trophy className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">
                  You're {getOrdinal(rank.rank)} out of {rank.total} member{rank.total !== 1 ? "s" : ""}
                </p>
                {rank.rank > 1 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tap to see the leaderboard
                  </p>
                )}
                {rank.rank === 1 && (
                  <p className="text-xs text-emerald-600 mt-0.5 font-medium">You're leading the pack 🏆</p>
                )}
              </div>
            </button>
          )}

          {untrackedNote && (
            <p className="text-[11px] text-muted-foreground text-center">{untrackedNote}</p>
          )}
        </CardContent>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-3">
            {showSeasonFilter && (
              <div className="flex items-center gap-2">
                <ListFilter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Select value={selectedSeasonId} onValueChange={onSeasonChange}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="All time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All time</SelectItem>
                    {seasons.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.status === "active" ? " · Current" : s.status === "archived" ? " · Archived" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : items.length > 0 ? (
              <>
                <ul className="divide-y divide-border/60 rounded-lg border bg-card/40">
                  {(showAll ? items : items.slice(0, 5)).map((item, idx) => {
                    const { label, Icon, tone } = humaniseAction(item);
                    const isEarned = item.type === "earned";
                    const clickable = !!item.eventId;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => clickable && navigate(`/events/${item.eventId}`)}
                          disabled={!clickable}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                            clickable && "hover:bg-muted/50 cursor-pointer",
                            !clickable && "cursor-default",
                            idx === 0 && "animate-fade-in",
                          )}
                        >
                          <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0", tone)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate leading-tight">{label}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {item.context} · {format(new Date(item.date), "d MMM")}
                            </p>
                          </div>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-xs shrink-0 tabular-nums",
                              isEarned
                                ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15"
                                : "bg-rose-500/15 text-rose-600 hover:bg-rose-500/15",
                            )}
                          >
                            {isEarned ? "+" : "−"}
                            {item.points} pts
                          </Badge>
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {items.length > 5 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => setShowAll(!showAll)}
                  >
                    {showAll ? "Show less" : `Show all ${items.length} activities`}
                  </Button>
                )}
              </>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">No activity yet</p>
                <p className="text-xs mt-1">RSVP to events, chat with your team, or share photos to start earning.</p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
