import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { invalidateRolesCache } from "@/lib/rolesCache";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";

interface TeamCaptainCardProps {
  teamId: string;
  teamName: string;
  /** Roster keyed by user id, same shape TeamDetailPage passes to PromoteToTeamAdminDialog. */
  members: Record<string, { profile: any; roles: { id: string; role: string }[] }>;
  /** Only real team admins / club admins / app admins may appoint or remove captains. */
  canManage: boolean;
}

export default function TeamCaptainCard({
  teamId,
  teamName,
  members,
  canManage,
}: TeamCaptainCardProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: captains = [] } = useQuery({
    queryKey: ["team-captains", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_captains")
        .select("id, user_id")
        .eq("team_id", teamId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!teamId,
  });

  const captainIds = new Set(captains.map((c) => c.user_id));

  const eligibleMembers = Object.entries(members).filter(([userId, member]) => {
    if (captainIds.has(userId)) return false;
    if (searchQuery) {
      const name = member.profile?.display_name || "";
      return name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const afterChange = () => {
    invalidateRolesCache();
    queryClient.invalidateQueries({ queryKey: ["team-captains", teamId] });
    refreshTeamRoleChange(queryClient, teamId);
    queryClient.invalidateQueries({ queryKey: ["user-team-roles", teamId] });
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) return;
      const { error } = await supabase
        .from("team_captains")
        .insert({ team_id: teamId, user_id: selectedUserId });
      if (error) throw error;

      await supabase.from("notifications").insert({
        user_id: selectedUserId,
        type: "membership",
        message: `You are now Captain of ${teamName} and can help manage the team`,
        related_id: teamId,
      });
    },
    onSuccess: () => {
      afterChange();
      setOpen(false);
      setSelectedUserId(null);
      setSearchQuery("");
      toast({ title: "Captain appointed" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to appoint captain",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("team_captains")
        .delete()
        .eq("team_id", teamId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      afterChange();
      toast({ title: "Captain removed" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to remove captain",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const selectedMember = selectedUserId ? members[selectedUserId] : null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/20">
            <Award className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Team Captain</p>
            <p className="text-xs text-muted-foreground">
              Captains can manage events, RSVPs, duties, the roster and chat — but not team settings
            </p>
          </div>
          {canManage && (
            <ResponsiveDialog
              open={open}
              onOpenChange={(o) => {
                setOpen(o);
                if (!o) {
                  setSelectedUserId(null);
                  setSearchQuery("");
                }
              }}
            >
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => setOpen(true)}>
                Appoint
              </Button>
              <ResponsiveDialogContent>
                <ResponsiveDialogHeader>
                  <ResponsiveDialogTitle>Appoint Captain</ResponsiveDialogTitle>
                  <ResponsiveDialogDescription>
                    Give a player captain rights to help manage {teamName}
                  </ResponsiveDialogDescription>
                </ResponsiveDialogHeader>

                <div className="relative py-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search members…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <div className="space-y-2 max-h-[45vh] overflow-y-auto">
                  {eligibleMembers.length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No eligible members found
                    </p>
                  )}
                  {eligibleMembers.map(([userId, member]) => {
                    const isSelected = selectedUserId === userId;
                    return (
                      <button
                        key={userId}
                        type="button"
                        onClick={() => setSelectedUserId(userId)}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-muted/50"
                        )}
                      >
                        <Avatar className="h-9 w-9">
                          <AvatarImage src={member.profile?.avatar_url || undefined} />
                          <AvatarFallback>
                            {(member.profile?.display_name || "?").charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="flex-1 min-w-0 truncate text-sm font-medium">
                          {member.profile?.display_name || "Unknown member"}
                        </span>
                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>

                <ResponsiveDialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)} className="flex-1 sm:flex-none">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => assignMutation.mutate()}
                    disabled={!selectedUserId || assignMutation.isPending}
                    className="flex-1 sm:flex-none"
                  >
                    {assignMutation.isPending ? "Appointing…" : "Appoint Captain"}
                  </Button>
                </ResponsiveDialogFooter>
              </ResponsiveDialogContent>
            </ResponsiveDialog>
          )}
        </div>

        {captains.length === 0 ? (
          <p className="text-xs text-muted-foreground">No captain appointed yet.</p>
        ) : (
          <div className="space-y-2">
            {captains.map((captain) => {
              const member = members[captain.user_id];
              return (
                <div key={captain.id} className="flex items-center gap-3 rounded-lg bg-background p-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={member?.profile?.avatar_url || undefined} />
                    <AvatarFallback>
                      {(member?.profile?.display_name || "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 min-w-0 truncate text-sm font-medium">
                    {member?.profile?.display_name || "Team member"}
                  </span>
                  <Badge variant="secondary" className="shrink-0">Captain</Badge>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label="Remove captain"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(captain.user_id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
