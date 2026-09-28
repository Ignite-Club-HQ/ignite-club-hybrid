import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { refreshRemovedTeamChild, refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, UserCheck } from "lucide-react";

interface LinkChildToParentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  childName: string;
  /** If the child record already exists in DB */
  existingChildId?: string;
  /** Pending invite IDs that reference this child (to mark accepted) */
  pendingInviteIds: string[];
  teamId: string;
  clubId: string;
  /** Team members grouped by user */
  members: Record<string, { profile: { id: string; display_name: string | null; avatar_url: string | null }; roles: { id: string; role: string }[] }>;
}

export default function LinkChildToParentSheet({
  open,
  onOpenChange,
  childName,
  existingChildId,
  pendingInviteIds,
  teamId,
  clubId,
  members,
}: LinkChildToParentSheetProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);

  // Get all team members as potential parents (filter to show meaningful members)
  const parentOptions = Object.entries(members)
    .filter(([_, m]) => m.profile?.display_name)
    .map(([userId, m]) => ({
      id: userId,
      name: m.profile.display_name || "Unknown",
      avatar: m.profile.avatar_url,
      roles: m.roles.map(r => r.role),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const linkMutation = useMutation({
    mutationFn: async (parentId: string) => {
      const { error } = await supabase.rpc("admin_link_child_to_parent", {
        p_child_name: childName,
        p_existing_child_id: existingChildId || null,
        p_parent_user_id: parentId,
        p_team_id: teamId,
        p_club_id: clubId,
        p_pending_invite_ids: pendingInviteIds,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({
        title: "Child linked",
        description: `${childName} has been linked to a parent successfully.`,
      });
      refreshRemovedTeamChild(queryClient, teamId);
      refreshTeamRoleChange(queryClient, teamId);
      queryClient.invalidateQueries({ queryKey: ["pending-invites", teamId] });
      onOpenChange(false);
      setSelectedParentId(null);
    },
    onError: (err: any) => {
      toast({
        title: "Failed to link child",
        description: err.message || "Something went wrong",
        variant: "destructive",
      });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] flex flex-col overflow-hidden p-0"
      >
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-base text-left">Link "{childName}" to a Parent</SheetTitle>
          <p className="text-sm text-muted-foreground text-left">
            Select a team member to assign as {childName}'s parent
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 overscroll-contain">
          {parentOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No team members available. Add a member to the team first.
            </p>
          ) : (
            <div className="space-y-2">
              {parentOptions.map((parent) => (
                <button
                  key={parent.id}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    selectedParentId === parent.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedParentId(parent.id)}
                  disabled={linkMutation.isPending}
                >
                  <Avatar className="h-8 w-8">
                    {parent.avatar && <AvatarImage src={parent.avatar} />}
                    <AvatarFallback className="text-sm">
                      {parent.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-medium">{parent.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {parent.roles.join(", ")}
                    </p>
                  </div>
                  {selectedParentId === parent.id && (
                    <UserCheck className="h-4 w-4 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t bg-background pb-safe shrink-0">
          <Button
            className="w-full"
            disabled={!selectedParentId || linkMutation.isPending}
            onClick={() => selectedParentId && linkMutation.mutate(selectedParentId)}
          >
            {linkMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Linking...
              </>
            ) : (
              "Link to Parent"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
