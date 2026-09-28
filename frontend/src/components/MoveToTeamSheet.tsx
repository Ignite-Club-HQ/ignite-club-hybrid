import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowRightLeft, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { membershipKeys } from "@/lab/membershipQueryKeys";

interface MoveToTeamSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  fromTeamId: string;
  fromTeamName: string;
  memberType: "adult" | "child";
  memberId: string; // user_id for adults, child_id for children
  memberName: string;
  memberRoles?: string[]; // only for adults
}

export function MoveToTeamSheet({
  open,
  onOpenChange,
  clubId,
  fromTeamId,
  fromTeamName,
  memberType,
  memberId,
  memberName,
  memberRoles,
}: MoveToTeamSheetProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all teams in the club (exclude the source team)
  const { data: teams = [], isLoading } = useQuery({
    queryKey: ["club-teams-for-move", clubId, fromTeamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, level_age, is_archived")
        .eq("club_id", clubId)
        .neq("id", fromTeamId)
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return (data || []).filter((t) => !t.is_archived);
    },
    enabled: open,
  });

  const moveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTeamId) throw new Error("No team selected");

      if (memberType === "adult") {
        const { error } = await supabase.rpc("move_member_to_team", {
          p_user_id: memberId,
          p_from_team_id: fromTeamId,
          p_to_team_id: selectedTeamId,
          p_club_id: clubId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("move_child_to_team", {
          p_child_id: memberId,
          p_from_team_id: fromTeamId,
          p_to_team_id: selectedTeamId,
          p_club_id: clubId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      const targetTeam = teams.find((t) => t.id === selectedTeamId);
      toast({
        title: "Member moved",
        description: `${memberName} has been moved to ${targetTeam?.name || "the new team"}`,
      });
      queryClient.invalidateQueries({ queryKey: membershipKeys.teamRoles() });
      queryClient.invalidateQueries({ queryKey: membershipKeys.teamChildren() });
      queryClient.invalidateQueries({ queryKey: ["club-members-roles"] });
      onOpenChange(false);
      setSelectedTeamId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to move member",
        description: error.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80vh] rounded-t-2xl">
        <SheetHeader className="text-left pb-4">
          <SheetTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-primary" />
            Move to Another Team
          </SheetTitle>
          <SheetDescription>
            Move <span className="font-medium text-foreground">{memberName}</span>
            {memberRoles && memberRoles.length > 0 && (
              <span> ({memberRoles.map((r) => r.replace(/_/g, " ")).join(", ")})</span>
            )}{" "}
            from <span className="font-medium text-foreground">{fromTeamName}</span> to:
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 overflow-y-auto max-h-[50vh] pb-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : teams.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No other teams found in this club.
            </p>
          ) : (
            <RadioGroup
              value={selectedTeamId || ""}
              onValueChange={setSelectedTeamId}
              className="space-y-2"
            >
              {teams.map((team) => (
                <label
                  key={team.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedTeamId === team.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value={team.id} />
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      <Users className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="font-medium text-sm">{team.name}</p>
                    {team.level_age && (
                      <p className="text-xs text-muted-foreground">{team.level_age}</p>
                    )}
                  </div>
                </label>
              ))}
            </RadioGroup>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              onOpenChange(false);
              setSelectedTeamId(null);
            }}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={!selectedTeamId || moveMutation.isPending}
            onClick={() => moveMutation.mutate()}
          >
            {moveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ArrowRightLeft className="h-4 w-4 mr-2" />
            )}
            Move
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
