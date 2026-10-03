import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, Check, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { withFeatureBackend } from "@/live/featureRouter";
import { setLiveGroupDuty, removeLiveGroupDuty, listLiveGroupDuties } from "@/live/features/events";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { toast } from "sonner";
import { AddDutySheet } from "@/components/AddDutySheet";
import { cn } from "@/lib/utils";

interface GroupDuty {
  id: string;
  name: string;
  assigned_to: string | null;
  status: "pending" | "confirmed" | "completed";
  points: number;
  assignee?: { display_name: string } | null;
}

interface MatchDutiesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  miniLeagueId: string;
  /** Pre-select a duty for assignment (quick-assign from badge) */
  initialDutyId?: string | null;
}

type View = "list" | "assign";

export function MatchDutiesDialog({
  open,
  onOpenChange,
  groupId,
  groupName,
  miniLeagueId,
  initialDutyId,
}: MatchDutiesDialogProps) {
  const queryClient = useQueryClient();
  const [isDutySheetOpen, setIsDutySheetOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const [selectedDuty, setSelectedDuty] = useState<GroupDuty | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Fetch group duties
  const { data: duties, isLoading: dutiesLoading } = useQuery({
    queryKey: ["event-group-duties", groupId],
    queryFn: () =>
      withFeatureBackend("events", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("event_group_duties")
            .select("*, assignee:profiles!event_group_duties_assigned_to_fkey(display_name)")
            .eq("group_id", groupId)
            .order("created_at");
          if (error) throw error;
          return data as GroupDuty[];
        },
        // Hybrid routing: events_domain's EventGroupDuty is keyed by
        // (group_id, duty name) with no row id/points/profile join — the
        // duty name doubles as the id and assignee display names aren't
        // resolvable without a canister-side profile lookup.
        icp: async (ctx) => {
          const rows = await listLiveGroupDuties(ctx, groupId);
          return rows.map((row) => {
            const assignedTo = row.account_id[0] ?? null;
            return {
              id: row.duty,
              name: row.duty,
              assigned_to: assignedTo,
              status: assignedTo ? "confirmed" : "pending",
              points: 0,
              assignee: null,
            } satisfies GroupDuty;
          });
        },
      }),
    enabled: open && !!groupId,
  });

  // Auto-open assign view when initialDutyId is provided
  const handledInitialRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && initialDutyId && duties && handledInitialRef.current !== initialDutyId) {
      const duty = duties.find(d => d.id === initialDutyId);
      if (duty) {
        setSelectedDuty(duty);
        setSelectedUserId(duty.assigned_to);
        setView("assign");
        handledInitialRef.current = initialDutyId;
      }
    }
    if (!open) {
      handledInitialRef.current = null;
    }
  }, [open, initialDutyId, duties]);

  // Fetch league members for duty assignment
  const { data: leagueMembers } = useQuery({
    queryKey: ["mini-league-duty-assignees", miniLeagueId],
    queryFn: () =>
      withFeatureBackend("mini_leagues", {
        supabase: async () => {
          const { data: league, error: leagueError } = await supabase
            .from("mini_leagues")
            .select("club_id")
            .eq("id", miniLeagueId)
            .single();
          if (leagueError) throw leagueError;

          const { data: playersData, error: playersError } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", miniLeagueId)
            .not("parent_user_id", "is", null);
          if (playersError) throw playersError;

          const parentIds = [...new Set(playersData?.map(p => p.parent_user_id).filter(Boolean) as string[])];

          const { data: adminRoles, error: rolesError } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin"]);
          if (rolesError) throw rolesError;

          const adminIds = adminRoles?.map(r => r.user_id) || [];
          const allUserIds = [...new Set([...parentIds, ...adminIds])];
          if (!allUserIds.length) return [];

          const { data: profiles, error: profilesError } = await selectCachedProfilesByIds(allUserIds);
          if (profilesError) throw profilesError;

          return (profiles || []).slice().sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
        },
        // Gated: resolving duty assignees requires joining club_admin/
        // league_admin roles (user_roles) and Supabase profile rows by uuid,
        // neither of which has a canister equivalent. Rather than invent
        // data, ICP-routed sessions see an empty assignee list here.
        icp: async () => [] as Array<{ id: string; display_name: string | null; avatar_url: string | null }>,
      }),
    enabled: open && !!miniLeagueId,
  });

  // Add duty mutation
  const addDutyMutation = useMutation({
    mutationFn: async (name: string) => {
      // Hybrid routing: the canister's set_group_duty creates-or-updates a
      // group duty row keyed by (group_id, duty name) — a direct match for
      // adding a new unassigned duty here.
      const addedOnIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          await setLiveGroupDuty(ctx, groupId, name, null);
          return true;
        },
      });
      if (addedOnIcp) return;

      const { error } = await supabase.from("event_group_duties").insert({
        group_id: groupId,
        name,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
      setIsDutySheetOpen(false);
      toast.success("Duty added");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Assign duty mutation
  const assignDutyMutation = useMutation({
    mutationFn: async ({ dutyId, assignedTo }: { dutyId: string; assignedTo: string | null }) => {
      // Hybrid routing: the canister's set_group_duty takes an optional
      // account, so both assigning and unassigning (assignedTo === null)
      // map directly onto it — keyed by group + duty name.
      const assignedOnIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          const duty = duties?.find((candidate) => candidate.id === dutyId);
          if (!duty?.name) throw new Error("Duty not found");
          await setLiveGroupDuty(ctx, groupId, duty.name, assignedTo);
          return true;
        },
      });
      if (assignedOnIcp) {
        queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
        setView("list");
        setSelectedDuty(null);
        toast.success("Duty updated");
        return;
      }

      const { error } = await supabase
        .from("event_group_duties")
        .update({ assigned_to: assignedTo, status: assignedTo ? "confirmed" : "pending" })
        .eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
      setView("list");
      setSelectedDuty(null);
      toast.success("Duty updated");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Delete duty mutation
  const deleteDutyMutation = useMutation({
    mutationFn: async (dutyId: string) => {
      // Hybrid routing: the canister's remove_group_duty is keyed by
      // group + duty name, so it covers both assigned and unassigned duties.
      const duty = duties?.find((candidate) => candidate.id === dutyId);
      if (duty?.name) {
        const removedOnIcp = await withFeatureBackend("events", {
          supabase: () => false,
          icp: async (ctx) => {
            await removeLiveGroupDuty(ctx, groupId, duty.name);
            return true;
          },
        });
        if (removedOnIcp) return;
      }

      const { error } = await supabase.from("event_group_duties").delete().eq("id", dutyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-group-duties", groupId] });
      toast.success("Duty removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setView("list");
      setSelectedDuty(null);
      setSelectedUserId(null);
    }
    onOpenChange(isOpen);
  };

  const openAssignView = (duty: GroupDuty) => {
    setSelectedDuty(duty);
    setSelectedUserId(duty.assigned_to);
    setView("assign");
  };

  const handleAssign = () => {
    if (selectedDuty) {
      assignDutyMutation.mutate({
        dutyId: selectedDuty.id,
        assignedTo: selectedUserId,
      });
    }
  };

  return (
    <>
      <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
        <ResponsiveDialogContent className="sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              {view === "assign" && selectedDuty
                ? `Assign: ${selectedDuty.name}`
                : `${groupName} — Duties`}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          <div className="flex-1 overflow-y-auto max-h-[60vh]">
            {view === "list" ? (
              /* ── DUTY LIST VIEW ── */
              <div className="px-1">
                {dutiesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : duties?.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-muted-foreground mb-4">No duties yet</p>
                    <Button variant="outline" onClick={() => setIsDutySheetOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add First Duty
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 py-2 px-2">
                    {duties?.map((duty) => (
                      <div
                        key={duty.id}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-xl"
                      >
                        <button
                          type="button"
                          className="flex items-center gap-3 flex-1 text-left touch-manipulation"
                          onClick={() => openAssignView(duty)}
                        >
                          <div className={cn(
                            "w-2.5 h-2.5 rounded-full shrink-0",
                            duty.status === "completed" ? "bg-green-500" :
                            duty.status === "confirmed" ? "bg-primary" : "bg-muted-foreground"
                          )} />
                          <div>
                            <p className="font-medium text-sm">{duty.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {duty.assignee?.display_name || "Tap to assign"}
                            </p>
                          </div>
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive shrink-0"
                          onClick={() => deleteDutyMutation.mutate(duty.id)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* ── ASSIGN VIEW (inline, no extra sheet) ── */
              <div className="space-y-3 py-2 px-3">
                {/* Unassigned option */}
                <button
                  type="button"
                  onClick={() => setSelectedUserId(null)}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                    "touch-manipulation",
                    selectedUserId === null
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:border-primary/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center",
                      selectedUserId === null ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}>
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <p className={cn("font-medium text-sm", selectedUserId === null && "text-primary")}>
                        Unassigned
                      </p>
                      <p className="text-xs text-muted-foreground">Leave duty open</p>
                    </div>
                  </div>
                  {selectedUserId === null && <Check className="h-5 w-5 text-primary" />}
                </button>

                {(leagueMembers || []).map((member) => {
                  const isSelected = selectedUserId === member.id;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => setSelectedUserId(member.id)}
                      className={cn(
                        "w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left",
                        "touch-manipulation",
                        isSelected
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:border-primary/50"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className={cn(
                          "h-10 w-10 border-2",
                          isSelected ? "border-primary" : "border-transparent"
                        )}>
                          <AvatarImage src={member.avatar_url || undefined} />
                          <AvatarFallback className="text-sm bg-muted">
                            {member.display_name?.charAt(0)?.toUpperCase() || "?"}
                          </AvatarFallback>
                        </Avatar>
                        <p className={cn("font-medium text-sm", isSelected && "text-primary")}>
                          {member.display_name || "Unknown"}
                        </p>
                      </div>
                      {isSelected && <Check className="h-5 w-5 text-primary" />}
                    </button>
                  );
                })}

                {(leagueMembers || []).length === 0 && (
                  <div className="text-center py-6 text-muted-foreground">
                    <p className="text-sm">No members available</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <ResponsiveDialogFooter className="gap-2 sm:gap-0">
            {view === "list" ? (
              <>
                <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1 sm:flex-none">
                  Close
                </Button>
                {(duties?.length ?? 0) > 0 && (
                  <Button onClick={() => setIsDutySheetOpen(true)} className="flex-1 sm:flex-none">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Duty
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setView("list"); setSelectedDuty(null); }} className="flex-1 sm:flex-none">
                  Back
                </Button>
                <Button
                  onClick={handleAssign}
                  disabled={assignDutyMutation.isPending}
                  className="flex-1 sm:flex-none"
                >
                  {assignDutyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save
                </Button>
              </>
            )}
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Add Duty Sheet */}
      <AddDutySheet
        open={isDutySheetOpen}
        onOpenChange={setIsDutySheetOpen}
        onAddDuty={(dutyName) => addDutyMutation.mutate(dutyName)}
        isPending={addDutyMutation.isPending}
        isMiniLeague={true}
        context="match"
      />
    </>
  );
}
