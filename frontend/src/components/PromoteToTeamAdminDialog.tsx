import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldPlus, Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
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

interface PromoteToTeamAdminDialogProps {
  teamId: string;
  teamName: string;
  clubId: string;
  members: Record<string, { profile: any; roles: { id: string; role: string }[] }>;
  trigger?: React.ReactNode;
}

export default function PromoteToTeamAdminDialog({
  teamId,
  teamName,
  clubId,
  members,
  trigger,
}: PromoteToTeamAdminDialogProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filter members who are NOT already team_admin
  const eligibleMembers = Object.entries(members).filter(([userId, member]) => {
    const isAlreadyAdmin = member.roles?.some(r => r.role === "team_admin");
    if (isAlreadyAdmin) return false;
    
    // Filter by search query
    if (searchQuery) {
      const name = member.profile?.display_name || "";
      return name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const promoteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedUserId) return;

      // The RLS policy on user_roles enforces admin permissions
      // This mutation will fail if the current user lacks club_admin, team_admin, or app_admin role
      const { error } = await supabase.from("user_roles").insert({
        user_id: selectedUserId,
        team_id: teamId,
        club_id: clubId,
        role: "team_admin",
      });
      if (error) throw error;

      // Notify the promoted user
      const selectedMember = members[selectedUserId];
      await supabase.from("notifications").insert({
        user_id: selectedUserId,
        type: "membership",
        message: `You have been promoted to Team Admin for ${teamName}`,
        related_id: teamId,
      });

      // Invalidate the promoted user's roles cache
      invalidateRolesCache();
    },
    onSuccess: () => {
      refreshTeamRoleChange(queryClient, teamId);
      setOpen(false);
      setSelectedUserId(null);
      setSearchQuery("");
      toast({ title: "Team Admin added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to promote member", variant: "destructive" });
    },
  });

  const selectedMember = selectedUserId ? members[selectedUserId] : null;

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => { 
      setOpen(o); 
      if (!o) {
        setSelectedUserId(null);
        setSearchQuery("");
      }
    }}>
      {trigger ? (
        <div onClick={() => setOpen(true)}>{trigger}</div>
      ) : (
        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2"
          onClick={() => setOpen(true)}
        >
          <ShieldPlus className="h-4 w-4" />
          Add Team Admin
        </Button>
      )}
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <ShieldPlus className="h-5 w-5 text-primary" />
            </div>
            <div>
              <ResponsiveDialogTitle>Add Team Admin</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Promote a team member to Team Admin
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Member List */}
          <div className="max-h-[300px] overflow-y-auto space-y-2">
            {eligibleMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {searchQuery 
                  ? "No members found matching your search"
                  : "All members are already Team Admins"}
              </p>
            ) : (
              eligibleMembers.map(([userId, member]) => {
                const isSelected = selectedUserId === userId;
                const currentRoles = member.roles?.map(r => r.role) || [];
                
                return (
                  <button
                    key={userId}
                    type="button"
                    onClick={() => setSelectedUserId(isSelected ? null : userId)}
                    className={cn(
                      "w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left",
                      isSelected 
                        ? "border-primary bg-primary/5" 
                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                    )}
                  >
                    <div className={cn(
                      "h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                      isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                    )}>
                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.profile?.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                        {member.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {member.profile?.display_name || "Unknown User"}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {currentRoles.slice(0, 2).map((role) => (
                          <Badge 
                            key={role} 
                            variant="secondary" 
                            className="text-xs"
                          >
                            {role.replace("_", " ")}
                          </Badge>
                        ))}
                        {currentRoles.length > 2 && (
                          <Badge variant="secondary" className="text-xs">
                            +{currentRoles.length - 2}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <ResponsiveDialogFooter>
          <Button 
            variant="outline" 
            onClick={() => setOpen(false)}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            onClick={() => promoteMutation.mutate()}
            disabled={!selectedUserId || promoteMutation.isPending}
            className="flex-1 sm:flex-none gap-2"
          >
            <ShieldPlus className="h-4 w-4" />
            {promoteMutation.isPending ? "Promoting..." : "Make Team Admin"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
