import { format } from "date-fns";
import { Check, CheckCircle2, Circle, Loader2, Lock, Plus, Trash2, UserPlus } from "lucide-react";
import { AddDutySheet } from "@/components/AddDutySheet";
import { AssignDutySheet } from "@/components/AssignDutySheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMatchArrivalDate } from "@/lib/matchArrivalTime";

type MutationHandle<T> = {
  mutate: (variables: T) => void;
  isPending: boolean;
};

type EventDutiesSectionProps = {
  event: any;
  duties: any[] | undefined;
  userId: string | undefined;
  members: any[] | undefined;
  miniLeagueDutyAssignees: any[] | undefined;
  isMiniLeagueEvent: boolean;
  isAdmin: boolean;
  showProUpgrade: boolean;
  canAwardDutyPoints: boolean;
  onUpgrade: () => void;
  addDutyOpen: boolean;
  setAddDutyOpen: (open: boolean) => void;
  assignDialogOpen: boolean;
  setAssignDialogOpen: (open: boolean) => void;
  selectedDutyId: string | null;
  setSelectedDutyId: (dutyId: string | null) => void;
  selectedUserId: string;
  setSelectedUserId: (userId: string) => void;
  addDutyMutation: MutationHandle<{ dutyName: string; startTime?: string; endTime?: string }>;
  claimDutyMutation: MutationHandle<string>;
  completeDutyMutation: MutationHandle<string>;
  uncompleteDutyMutation: MutationHandle<string>;
  deleteDutyMutation: MutationHandle<string>;
  assignDutyMutation: MutationHandle<string | null>;
};

export function EventDutiesSection({
  event,
  duties,
  userId,
  members,
  miniLeagueDutyAssignees,
  isMiniLeagueEvent,
  isAdmin,
  showProUpgrade,
  canAwardDutyPoints,
  onUpgrade,
  addDutyOpen,
  setAddDutyOpen,
  assignDialogOpen,
  setAssignDialogOpen,
  selectedDutyId,
  setSelectedDutyId,
  selectedUserId,
  setSelectedUserId,
  addDutyMutation,
  claimDutyMutation,
  completeDutyMutation,
  uncompleteDutyMutation,
  deleteDutyMutation,
  assignDutyMutation,
}: EventDutiesSectionProps) {
  const showDuties = event.type === "game" && !isMiniLeagueEvent && canAwardDutyPoints;

  return (
    <>
      {showProUpgrade && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Duty Roster</h2>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Lock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Match-day duties are a Pro feature</p>
                <p className="text-xs text-muted-foreground">
                  Upgrade to Pro to add and assign duties like Canteen/BBQ, Umpire/Referee, Snacks, Linesperson, Scorer and more — with automatic reminders and points for volunteers.
                </p>
              </div>
            </div>
            {event.club_id && (
              <Button size="sm" onClick={onUpgrade} className="gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                Upgrade to Pro
              </Button>
            )}
          </div>
        </section>
      )}

      {showDuties && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Duty Roster</h2>
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setAddDutyOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add Duty
              </Button>
            )}
          </div>

          <AddDutySheet
            open={addDutyOpen}
            onOpenChange={setAddDutyOpen}
            onAddDuty={(dutyName, opts) => addDutyMutation.mutate({
              dutyName,
              startTime: opts?.startTime,
              endTime: opts?.endTime,
            })}
            isPending={addDutyMutation.isPending}
            isMiniLeague={!!event.mini_league_id}
            context="session"
            sport={event.clubs?.sport ?? null}
          />
          {duties?.length === 0 ? (
            <p className="text-muted-foreground text-sm">No duties assigned for this event</p>
          ) : (
            <div className="space-y-2">
              {duties?.map((duty) => (
                <Card key={duty.id} className={duty.status === "completed" ? "opacity-60" : ""}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {duty.status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground" />
                      )}
                      <div>
                        <p className="font-medium">{duty.name}</p>
                        {duty.start_time && (
                          <p className="text-xs text-muted-foreground whitespace-nowrap">
                            {format(new Date(duty.start_time), "h:mm a")}
                            {duty.end_time ? ` – ${format(new Date(duty.end_time), "h:mm a")}` : ""}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {duty.profiles?.display_name ?? "Unassigned"}
                        </p>
                        {duty.status === "completed" && (duty.assigned_to === userId || isAdmin) && (
                          <button
                            type="button"
                            onClick={() => uncompleteDutyMutation.mutate(duty.id)}
                            disabled={uncompleteDutyMutation.isPending}
                            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground mt-0.5 disabled:opacity-50"
                          >
                            {uncompleteDutyMutation.isPending ? "Reopening…" : "Marked by mistake? Reopen"}
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {isAdmin && duty.status === "open" && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setSelectedDutyId(duty.id);
                              setSelectedUserId(duty.assigned_to || "");
                              setAssignDialogOpen(true);
                            }}
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteDutyMutation.mutate(duty.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                      {duty.status === "open" && !duty.assigned_to && !isAdmin && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => claimDutyMutation.mutate(duty.id)}
                          disabled={claimDutyMutation.isPending}
                        >
                          Claim
                        </Button>
                      )}
                      {duty.status === "open" && (duty.assigned_to === userId || isAdmin) && (() => {
                        const earliest = event.type === "game"
                          ? (getMatchArrivalDate(event) ?? new Date(event.start_time || event.event_date))
                          : new Date(event.start_time || event.event_date);
                        const tooEarly = !Number.isNaN(earliest.getTime()) && new Date() < earliest;
                        return (
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              size="sm"
                              onClick={() => completeDutyMutation.mutate(duty.id)}
                              disabled={completeDutyMutation.isPending || tooEarly}
                              title={tooEarly ? `Available from ${format(earliest, "EEE d MMM, h:mm a")}` : undefined}
                            >
                              {completeDutyMutation.isPending ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                "Complete"
                              )}
                            </Button>
                            {tooEarly && (
                              <span className="text-[10px] text-muted-foreground">
                                Available {format(earliest, "EEE d MMM, h:mm a")}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      {duty.status === "completed" && (
                        <Badge variant="secondary" className="bg-primary/20 text-primary gap-1">
                          <Check className="h-3 w-3" />
                          Completed
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      <AssignDutySheet
        open={assignDialogOpen}
        onOpenChange={setAssignDialogOpen}
        dutyName={duties?.find((duty) => duty.id === selectedDutyId)?.name || "Duty"}
        currentAssignee={selectedUserId || null}
        members={(isMiniLeagueEvent ? miniLeagueDutyAssignees : members)?.map((member) => ({
          id: member.id,
          display_name: member.display_name,
          avatar_url: member.avatar_url,
        })) || []}
        onAssign={(assignedUserId) => assignDutyMutation.mutate(assignedUserId)}
        isPending={assignDutyMutation.isPending}
      />
    </>
  );
}
