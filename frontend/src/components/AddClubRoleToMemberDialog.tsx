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
import { RoleSelectionList, type RoleSelectionOption } from "./RoleSelectionList";

type ClubRole = "club_admin" | "coach" | "committee_member" | "league_admin" | "competition_admin" | "parent" | "player" | "basic_user";

interface AddClubRoleToMemberDialogProps {
  userId: string;
  userName: string;
  clubId: string;
  clubName: string;
  existingRoles: Array<{ role: string; club_id?: string | null; team_id?: string | null }>;
}

const availableRoles: RoleSelectionOption<ClubRole>[] = [
  { value: "club_admin", label: "Club Admin", description: "Full club management access", color: "bg-purple-500/10 text-purple-600 border-purple-200 dark:text-purple-400 dark:border-purple-500/30" },
  { value: "committee_member", label: "Committee Member", description: "Club committee access", color: "bg-cyan-500/10 text-cyan-600 border-cyan-200 dark:text-cyan-400 dark:border-cyan-500/30" },
  { value: "league_admin", label: "League Admin", description: "Manage mini leagues", color: "bg-indigo-500/10 text-indigo-600 border-indigo-200 dark:text-indigo-400 dark:border-indigo-500/30" },
  { value: "competition_admin", label: "Competition Admin", description: "Eligible to coordinate competitions for this club/association", color: "bg-blue-500/10 text-blue-600 border-blue-200 dark:text-blue-400 dark:border-blue-500/30" },
  { value: "coach", label: "Coach", description: "Can manage events and teams", color: "bg-amber-500/10 text-amber-600 border-amber-200 dark:text-amber-400 dark:border-amber-500/30" },
  { value: "parent", label: "Parent", description: "Can view club activities", color: "bg-pink-500/10 text-pink-600 border-pink-200 dark:text-pink-400 dark:border-pink-500/30" },
  { value: "player", label: "Player", description: "Can participate in events", color: "bg-emerald-500/10 text-emerald-600 border-emerald-200 dark:text-emerald-400 dark:border-emerald-500/30" },
  { value: "basic_user", label: "Member", description: "Basic club membership", color: "bg-muted text-muted-foreground border-border" },
];

export default function AddClubRoleToMemberDialog({
  userId,
  userName,
  clubId,
  clubName,
  existingRoles,
}: AddClubRoleToMemberDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedRoles, setSelectedRoles] = useState<ClubRole[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filter out roles the user already has at club level (not team-specific)
  const existingClubRoles = existingRoles
    .filter(r => r.club_id === clubId && !r.team_id)
    .map(r => r.role);

  const availableToAdd = availableRoles.filter(
    (role) => !existingClubRoles.includes(role.value)
  );

  const addRolesMutation = useMutation({
    mutationFn: async () => {
      if (selectedRoles.length === 0) return;

      const rolesToInsert = selectedRoles.map((role) => ({
        user_id: userId,
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
        message: `You have been assigned new role(s) in ${clubName}: ${roleNames}`,
        related_id: clubId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-members-roles", clubId] });
      setOpen(false);
      setSelectedRoles([]);
      toast({ title: "Role(s) added successfully" });
    },
    onError: (error: unknown) => {
      toast({ 
        title: "Failed to add role(s)", 
        description: error instanceof Error ? error.message : "The role could not be added.",
        variant: "destructive" 
      });
    },
  });

  const toggleRole = (role: ClubRole) => {
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
      <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" />
        Add Role
      </Button>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <UserPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <ResponsiveDialogTitle>Add Club Role</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Assign new club-level roles to {userName}
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>
        
        <RoleSelectionList
          options={availableToAdd}
          selected={selectedRoles}
          onToggle={toggleRole}
          className="max-h-[50vh] overflow-y-auto"
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
