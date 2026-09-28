import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";
import { RoleSelectionList, type RoleSelectionOption } from "./RoleSelectionList";

type TeamRole = "player" | "parent" | "coach" | "team_admin";

interface AddRoleToMemberDialogProps {
  userId: string;
  userName: string;
  teamId: string;
  teamName: string;
  clubId: string;
  existingRoles: string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const availableRoles: RoleSelectionOption<TeamRole>[] = [
  { value: "player", label: "Player", description: "Can participate in team events", color: "bg-emerald-500/10 text-emerald-600 border-emerald-200" },
  { value: "parent", label: "Parent", description: "Can view team activities", color: "bg-blue-500/10 text-blue-600 border-blue-200" },
  { value: "coach", label: "Coach", description: "Can manage team events", color: "bg-amber-500/10 text-amber-600 border-amber-200" },
  { value: "team_admin", label: "Team Admin", description: "Full team management access", color: "bg-purple-500/10 text-purple-600 border-purple-200" },
];

export default function AddRoleToMemberDialog({
  userId,
  userName,
  teamId,
  teamName,
  clubId,
  existingRoles,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AddRoleToMemberDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [selectedRoles, setSelectedRoles] = useState<TeamRole[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const availableToAdd = availableRoles.filter(
    (role) => !existingRoles.includes(role.value)
  );

  const addRolesMutation = useMutation({
    mutationFn: async () => {
      if (selectedRoles.length === 0) return;

      // The RLS policy on user_roles enforces admin permissions
      // This mutation will fail if the current user lacks club_admin, team_admin, or app_admin role
      const rolesToInsert = selectedRoles.map((role) => ({
        user_id: userId,
        team_id: teamId,
        club_id: clubId,
        role,
      }));

      const { error } = await supabase.from("user_roles").insert(rolesToInsert);
      if (error) throw error;

      // Send notification to the user
      const roleNames = selectedRoles.map(r => 
        availableRoles.find(ar => ar.value === r)?.label || r
      ).join(", ");
      
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "membership",
        message: `You have been assigned new role(s) in ${teamName}: ${roleNames}`,
        related_id: teamId,
      });
    },
    onSuccess: () => {
      refreshTeamRoleChange(queryClient, teamId);
      setOpen(false);
      setSelectedRoles([]);
      toast({ title: "Role(s) added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add role(s)", variant: "destructive" });
    },
  });

  const toggleRole = (role: TeamRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role)
        ? prev.filter((r) => r !== role)
        : [...prev, role]
    );
  };

  if (availableToAdd.length === 0) {
    return null;
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelectedRoles([]); }}>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
      </Button>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <ResponsiveDialogTitle>Add Role</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Assign new roles to {userName}
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>
        
        <RoleSelectionList
          options={availableToAdd}
          selected={selectedRoles}
          onToggle={toggleRole}
        />

        <ResponsiveDialogFooter>
          <Button 
            variant="outline" 
            onClick={() => setOpen(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={() => addRolesMutation.mutate()}
            disabled={selectedRoles.length === 0 || addRolesMutation.isPending}
            className="flex-1 sm:flex-none"
          >
            {addRolesMutation.isPending ? "Adding..." : `Add ${selectedRoles.length || ""} Role${selectedRoles.length !== 1 ? "s" : ""}`}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
