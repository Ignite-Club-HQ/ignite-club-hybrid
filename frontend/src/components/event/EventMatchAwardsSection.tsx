import { Lock, Trophy } from "lucide-react";
import MatchCaptainSelector from "@/components/MatchCaptainSelector";
import MatchGoalkeepersSelector from "@/components/MatchGoalkeepersSelector";
import PlayerOfMatchSelector from "@/components/PlayerOfMatchSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type EventMatchAwardsSectionProps = {
  event: any;
  eventId: string;
  rsvps: any[];
  childrenOnTeam: any[] | undefined;
  canManageEvent: boolean;
  canAwardDutyPoints: boolean;
  showProUpgrade: boolean;
  onUpgrade: () => void;
};

export function EventMatchAwardsSection({
  event,
  eventId,
  rsvps,
  childrenOnTeam,
  canManageEvent,
  canAwardDutyPoints,
  showProUpgrade,
  onUpgrade,
}: EventMatchAwardsSectionProps) {
  if (event.type !== "game" || !event.team_id) return null;

  const sport = (event.clubs?.sport || "").toLowerCase();
  const hasGoalkeeper = [
    "soccer",
    "football",
    "futsal",
    "netball",
    "hockey",
    "handball",
    "water polo",
    "waterpolo",
    "lacrosse",
    "rugby",
  ].some((keyword) => sport.includes(keyword));

  return (
    <>
      <Separator />
      <MatchCaptainSelector
        eventId={eventId}
        teamId={event.team_id}
        isAdmin={canManageEvent}
        rsvps={rsvps}
      />
      {hasGoalkeeper && (
        <MatchGoalkeepersSelector
          eventId={eventId}
          teamId={event.team_id}
          isAdmin={canManageEvent}
          rsvps={rsvps}
        />
      )}
      {canAwardDutyPoints && (
        <PlayerOfMatchSelector
          eventId={eventId}
          clubId={event.club_id}
          teamId={event.team_id}
          isAdmin={canManageEvent}
          rsvps={rsvps}
          childrenOnTeam={childrenOnTeam}
        />
      )}

      {showProUpgrade && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="h-5 w-5 text-amber-500" />
              Player of the Match
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-start gap-2">
              <Lock className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Player of the Match is a Pro feature</p>
                <p className="text-xs text-muted-foreground">
                  Upgrade to Pro to select and award Player of the Match, complete with points, vouchers, and automatic notifications.
                </p>
              </div>
            </div>
            {event.club_id && (
              <Button size="sm" onClick={onUpgrade} className="gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Upgrade to Pro
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
