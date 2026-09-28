import { Baby, Check, DollarSign, Loader2, MessageSquare } from "lucide-react";
import { EventGuestsManager } from "@/components/EventGuestsManager";
import { TrainingDefaultControl } from "@/components/event/TrainingDefaultControl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  isParentFirstEvent,
  resolveRsvpAudience,
  shouldPromptPlayer,
  shouldPromptSelf,
} from "@/lib/rsvpAudience";

type RsvpStatus = "going" | "maybe" | "not_going";
type RsvpOption = { value: RsvpStatus; label: string; icon: string };

type EventRsvpResponseSectionProps = {
  event: any;
  userId: string | undefined;
  useIcpLab: boolean;
  isMiniLeagueEvent: boolean;
  hasRestrictedEventRoles: boolean;
  teamPlayerAdultIds: Set<unknown> | undefined;
  clubPlayerAdultIds: Set<unknown> | undefined;
  childrenOnTeam: any[] | undefined;
  childRsvps: any[];
  myRsvp: any;
  rsvps: any[] | undefined;
  myMiniLeaguePlayers: any[] | undefined;
  rsvpOptions: RsvpOption[];
  attendanceActionsDisabled: boolean;
  showPaymentStatus: boolean | null | undefined;
  userHasPaid: boolean;
  eventPrice: number | null | undefined;
  isProcessingPayment: boolean;
  canManageEvent: boolean;
  childRsvpMutation: any;
  rsvpMutation: any;
  localAttendanceMutation: any;
  parentLeaguePlayerRsvpMutation: any;
  setNoteTarget: (target: {
    kind: "self" | "child";
    childId?: string;
    subjectName: string;
  }) => void;
  handlePayNow: () => void;
};

export function EventRsvpResponseSection({
  event,
  userId,
  useIcpLab,
  isMiniLeagueEvent,
  hasRestrictedEventRoles,
  teamPlayerAdultIds,
  clubPlayerAdultIds,
  childrenOnTeam,
  childRsvps,
  myRsvp,
  rsvps,
  myMiniLeaguePlayers,
  rsvpOptions,
  attendanceActionsDisabled,
  showPaymentStatus,
  userHasPaid,
  eventPrice,
  isProcessingPayment,
  canManageEvent,
  childRsvpMutation,
  rsvpMutation,
  localAttendanceMutation,
  parentLeaguePlayerRsvpMutation,
  setNoteTarget,
  handlePayNow,
}: EventRsvpResponseSectionProps) {
  const audience = resolveRsvpAudience(
    event.rsvp_audience,
    event.teams?.default_rsvp_audience,
  );
  const viewerIsAdultPlayer = !!userId && (
    event.team_id
      ? !!teamPlayerAdultIds?.has(userId)
      : !!clubPlayerAdultIds?.has(userId)
  );
  const promptParent = isMiniLeagueEvent || shouldPromptSelf(audience, viewerIsAdultPlayer);
  const promptPlayer = isMiniLeagueEvent || shouldPromptPlayer(audience);

  const childrenBlock = (
    !isMiniLeagueEvent &&
    promptPlayer &&
    !hasRestrictedEventRoles &&
    childrenOnTeam &&
    childrenOnTeam.length > 0
  ) ? (() => {
    const unrespondedChildren = childrenOnTeam.filter(
      (child) => !childRsvps.find((rsvp) => rsvp.child_id === child.id),
    );
    const unrespondedCount = unrespondedChildren.length;
    const goingCount = childRsvps.filter((rsvp) => rsvp.status === "going").length;
    const maybeCount = childRsvps.filter((rsvp) => rsvp.status === "maybe").length;
    return (
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50 bg-muted/30">
          <Baby className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Children's RSVP</h2>
          <div className="ml-auto flex items-center gap-2 text-xs">
            {unrespondedCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-destructive">
                <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
                </span>
                {unrespondedCount === 1 && childrenOnTeam.length === 1
                  ? `${unrespondedChildren[0].name} awaiting`
                  : `${unrespondedCount} awaiting`}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {goingCount > 0 && `${goingCount} going`}
                {maybeCount > 0 && `${goingCount > 0 ? " · " : ""}${maybeCount} maybe`}
              </span>
            )}
          </div>
        </div>
        <div className="space-y-3 p-3">
          {childrenOnTeam.map((child) => {
            const childRsvp = childRsvps.find((rsvp) => rsvp.child_id === child.id);
            return (
              <div key={child.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                        {child.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{child.name}</span>
                    {!childRsvp && (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-destructive"
                        aria-label="Awaiting your response"
                      >
                        <span className="relative inline-flex h-1.5 w-1.5" aria-hidden>
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-destructive" />
                        </span>
                        Awaiting response
                      </span>
                    )}
                  </div>
                  {childRsvp && (
                    <div className="flex items-center gap-1.5">
                      {childRsvp.source === "default" && (
                        <span
                          title="Auto-applied from training default. Tap a button to confirm."
                          className="rounded-full bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5"
                        >
                          Auto
                        </span>
                      )}
                      <Badge variant={childRsvp.status === "going" ? "default" : "secondary"} className="text-xs">
                        {childRsvp.status === "going" ? "Going" : childRsvp.status === "maybe" ? "Maybe" : "Not Going"}
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {rsvpOptions.map(({ value, label, icon }) => (
                    <Button
                      key={value}
                      variant={childRsvp?.status === value ? "default" : "outline"}
                      size="sm"
                      className="flex flex-col h-auto py-2"
                      onClick={() => childRsvpMutation.mutate({ childId: child.id, status: value, childName: child.name })}
                      disabled={childRsvpMutation.isPending || attendanceActionsDisabled}
                    >
                      <span>{icon}</span>
                      <span className="text-xs">{label}</span>
                    </Button>
                  ))}
                </div>
                {childRsvp && (
                  <button
                    type="button"
                    onClick={() => setNoteTarget({ kind: "child", childId: child.id, subjectName: child.name })}
                    className="flex w-full items-start gap-2 rounded-lg border border-dashed border-border/70 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted/40 touch-manipulation"
                  >
                    <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span className={childRsvp.notes ? "text-foreground" : undefined}>
                      {childRsvp.notes || "Add a note…"}
                    </span>
                  </button>
                )}
                <TrainingDefaultControl
                  teamId={event.team_id ?? null}
                  childId={child.id}
                  subjectName={child.name}
                  currentRsvpStatus={childRsvp?.status ?? null}
                  isTraining={event.type === "training"}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  })() : null;

  const parentFirstHeading = isParentFirstEvent(event);
  const parentBlock = promptParent ? (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className={isMiniLeagueEvent ? "text-lg font-semibold" : ((childrenBlock && !parentFirstHeading) ? "text-sm font-semibold text-muted-foreground uppercase tracking-wide" : "text-lg font-semibold")}>
          {isMiniLeagueEvent ? "Attendance" : "Your RSVP"}
        </h2>
        {myRsvp?.source === "default" && (
          <span
            title="Auto-applied from your training default. Tap a button to confirm."
            className="rounded-full bg-primary/15 text-primary text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5"
          >
            Auto
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {rsvpOptions.map(({ value, label, icon }) => (
          <Button
            key={value}
            variant={myRsvp?.status === value ? "default" : "outline"}
            className="flex flex-col h-auto py-3"
            onClick={() => myRsvp?.status !== value && rsvpMutation.mutate(value)}
            disabled={rsvpMutation.isPending || attendanceActionsDisabled || myRsvp?.status === value}
          >
            <span className="text-lg">{icon}</span>
            <span className="text-xs mt-1">{label}</span>
          </Button>
        ))}
      </div>
      <TrainingDefaultControl
        teamId={event.team_id ?? null}
        userId={userId ?? null}
        subjectName="You"
        currentRsvpStatus={myRsvp?.status ?? null}
        isTraining={event.type === "training"}
      />
      {useIcpLab && myRsvp && (
        <Button
          variant="outline"
          onClick={() => localAttendanceMutation.mutate(!String(myRsvp.notes ?? "").startsWith("Present"))}
          disabled={localAttendanceMutation.isPending}
        >
          {localAttendanceMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {String(myRsvp.notes ?? "").startsWith("Present") ? "Mark absent" : "Mark present"}
        </Button>
      )}
      {myRsvp && (
        <button
          type="button"
          onClick={() => setNoteTarget({ kind: "self", subjectName: "You" })}
          className="flex w-full items-start gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/40 touch-manipulation"
        >
          <MessageSquare className="h-4 w-4 mt-0.5 shrink-0" />
          <span className={myRsvp.notes ? "text-foreground" : undefined}>
            {myRsvp.notes || "Add a note…"}
          </span>
        </button>
      )}
      {showPaymentStatus && myRsvp?.status === "going" && (
        <Card className={userHasPaid ? "border-green-500/30 bg-green-500/5" : "border-warning/30 bg-warning/5"}>
          <CardContent className="p-4">
            {userHasPaid ? (
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-full bg-green-500/20">
                  <Check className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-green-600">Payment Complete</p>
                  <p className="text-sm text-muted-foreground">You've paid ${Number(eventPrice).toFixed(2)} for this event</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-warning/20">
                    <DollarSign className="h-5 w-5 text-warning" />
                  </div>
                  <div>
                    <p className="font-medium">Payment Required</p>
                    <p className="text-sm text-muted-foreground">${Number(eventPrice).toFixed(2)} per person</p>
                  </div>
                </div>
                <Button onClick={handlePayNow} disabled={isProcessingPayment} className="shrink-0">
                  {isProcessingPayment ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <DollarSign className="h-4 w-4 mr-2" />
                      Pay Now
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  ) : null;

  const parentFirst = isParentFirstEvent(event);

  return (
    <>
      <section className="space-y-4">
        {parentFirst ? parentBlock : childrenBlock}
        {childrenBlock && parentBlock && <Separator />}
        {parentFirst ? childrenBlock : parentBlock}

        {isMiniLeagueEvent && myMiniLeaguePlayers && myMiniLeaguePlayers.length > 0 && (
          <div className="pt-2">
            <Separator />
            <div className="mt-3 rounded-xl border border-border/50 bg-muted/20 p-3 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Baby className="h-4 w-4 text-primary" />
                Your players
              </h3>
              {myMiniLeaguePlayers.map((player) => {
                const playerRsvp = rsvps?.find((rsvp) => rsvp.mini_league_player_id === player.id);
                return (
                  <div key={player.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                            {player.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm font-medium">{player.name}</span>
                      </div>
                      {playerRsvp && (
                        <Badge variant={playerRsvp.status === "going" ? "default" : "secondary"} className="text-xs">
                          {playerRsvp.status === "going" ? "Going" : playerRsvp.status === "maybe" ? "Maybe" : "Not Going"}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {rsvpOptions.map(({ value, label, icon }) => (
                        <Button
                          key={value}
                          variant={playerRsvp?.status === value ? "default" : "outline"}
                          size="sm"
                          className="flex flex-col h-auto py-2"
                          onClick={() => parentLeaguePlayerRsvpMutation.mutate({ playerId: player.id, status: value })}
                          disabled={parentLeaguePlayerRsvpMutation.isPending || attendanceActionsDisabled}
                        >
                          <span>{icon}</span>
                          <span className="text-xs">{label}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {event.type === "social" && event.allow_guests && myRsvp?.status === "going" && (
        <EventGuestsManager
          eventId={event.id}
          clubId={event.club_id}
          maxGuestsPerMember={event.max_guests_per_member || 2}
          isAdmin={canManageEvent}
        />
      )}
    </>
  );
}
