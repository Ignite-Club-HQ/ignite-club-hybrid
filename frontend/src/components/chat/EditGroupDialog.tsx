import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "league_admin", label: "League Admins" },
  { value: "committee_member", label: "Committee Members" },
  { value: "team_admin", label: "Team Admins" },
  { value: "coach", label: "Coaches" },
  { value: "parent", label: "Parents" },
  { value: "player", label: "Players" },
  { value: "club_admin", label: "Club Admins" },
];
type JoinPolicy = "invite_only" | "request_to_join" | "open_to_club";

const JOIN_POLICY_OPTIONS: { value: JoinPolicy; label: string; description: string }[] = [
  {
    value: "invite_only",
    label: "Invite only",
    description: "Hidden from Discover. Only admins or existing members can add people.",
  },
  {
    value: "request_to_join",
    label: "Approval required",
    description: "Club members can request to join, and a current member must approve.",
  },
  {
    value: "open_to_club",
    label: "Anyone in the club can join",
    description: "Club members can join instantly from Discover, no approval needed.",
  },
];

function normalizeJoinPolicy(raw: string | null | undefined): JoinPolicy {
  return raw === "open_to_club" || raw === "request_to_join" ? raw : "invite_only";
}


interface EditGroupDialogProps {
  group: {
    id: string;
    name: string;
    allowed_roles: AppRole[];
    membership_mode?: string | null;
    category?: string | null;
    club_id?: string | null;
    team_id?: string | null;
    mini_league_id?: string | null;
    join_policy?: string | null;
    allow_forwarding?: boolean;
  };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function EditGroupDialog({ group, open: controlledOpen, onOpenChange }: EditGroupDialogProps) {
  const { user } = useAuth();
  const isManual = group.membership_mode === "manual";
  const isClubScopedGroup = !!group.club_id && !group.team_id && !group.mini_league_id;
  const qualifiesForOpenJoin =
    isManual &&
    isClubScopedGroup &&
    (group.category === "Operations" || group.category === "Volunteers");
  const [internalOpen, setInternalOpen] = useState(false);
  const [name, setName] = useState(group.name);
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>(group.allowed_roles);
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>(normalizeJoinPolicy(group.join_policy));
  const [allowForwarding, setAllowForwarding] = useState<boolean>(group.allow_forwarding !== false);
  const queryClient = useQueryClient();

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (onOpenChange || (() => {})) : setInternalOpen;

  // Sync state when group prop changes (e.g. reopen)
  useEffect(() => {
    if (open) {
      setName(group.name);
      setSelectedRoles(group.allowed_roles);
      setJoinPolicy(normalizeJoinPolicy(group.join_policy));
      setAllowForwarding(group.allow_forwarding !== false);
    }
  }, [open, group.id]);

  // Permission gate: for club-scoped groups, require club_admin (or app_admin).
  const { data: canEdit, isLoading: permLoading } = useQuery({
    queryKey: ["edit-group-permission", group.id, user?.id, group.club_id, group.team_id],
    queryFn: async () => {
      if (!user) return false;
      const { data: appAdmin } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      if (appAdmin) return true;

      if (isClubScopedGroup && group.club_id) {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("club_id", group.club_id)
          .eq("role", "club_admin")
          .maybeSingle();
        return !!data;
      }

      if (group.team_id) {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("team_id", group.team_id)
          .eq("role", "team_admin")
          .maybeSingle();
        if (data) return true;
        // Also allow club admins of the parent club
        if (group.club_id) {
          const { data: ca } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("club_id", group.club_id)
            .eq("role", "club_admin")
            .maybeSingle();
          return !!ca;
        }
      }
      return false;
    },
    enabled: !!user && open,
    staleTime: 5 * 60 * 1000,
  });

  const updateGroupMutation = useMutation({
    mutationFn: async () => {
      if (!canEdit) throw new Error("You do not have permission to edit this group");
      const updates: { name: string; allowed_roles?: AppRole[]; join_policy?: string; allow_forwarding?: boolean } = { name };
      if (!isManual) updates.allowed_roles = selectedRoles;
      if (qualifiesForOpenJoin) {
        updates.join_policy = joinPolicy;
      }
      updates.allow_forwarding = allowForwarding;
      const { error } = await supabase
        .from("chat_groups")
        .update(updates as any)
        .eq("id", group.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Group updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups"] });
      setOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error updating group",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleRole = (role: AppRole) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  };

  const handleUpdate = () => {
    if (!name.trim()) {
      toast({ title: "Please enter a group name", variant: "destructive" });
      return;
    }
    if (!isManual && selectedRoles.length === 0) {
      toast({ title: "Please select at least one role", variant: "destructive" });
      return;
    }
    updateGroupMutation.mutate();
  };

  const showDenied = open && !permLoading && canEdit === false;

  return (
    <>
      {!isControlled && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      )}
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Edit Chat Group</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          {showDenied ? (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                {isClubScopedGroup
                  ? "Only club admins can edit club chat groups."
                  : "You don't have permission to edit this group."}
              </p>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-2 max-h-[70vh] overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="edit-group-name">Group Name</Label>
                <Input
                  id="edit-group-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter group name"
                />
              </div>

              {!isManual && (
                <div className="space-y-2">
                  <Label>Allowed Roles</Label>
                  <div className="space-y-2">
                    {ROLE_OPTIONS.map((role) => (
                      <div key={role.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`edit-role-${role.value}`}
                          checked={selectedRoles.includes(role.value)}
                          onCheckedChange={() => toggleRole(role.value)}
                        />
                        <label
                          htmlFor={`edit-role-${role.value}`}
                          className="text-sm cursor-pointer"
                        >
                          {role.label}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isManual && (
                <p className="text-sm text-muted-foreground">
                  This group is managed by invitation. Add or remove members from the group details screen.
                </p>
              )}

              {qualifiesForOpenJoin && (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="space-y-0.5">
                    <Label>Who can join this group?</Label>
                    <p className="text-xs text-muted-foreground">
                      Controls how club members get into this chat.
                    </p>
                  </div>
                  <RadioGroup value={joinPolicy} onValueChange={(v) => setJoinPolicy(v as JoinPolicy)}>
                    {JOIN_POLICY_OPTIONS.map((opt) => (
                      <div key={opt.value} className="flex items-start gap-3">
                        <RadioGroupItem
                          id={`edit-group-join-${opt.value}`}
                          value={opt.value}
                          className="mt-0.5"
                        />
                        <div className="space-y-0.5">
                          <label
                            htmlFor={`edit-group-join-${opt.value}`}
                            className="text-sm font-medium cursor-pointer"
                          >
                            {opt.label}
                          </label>
                          <p className="text-xs text-muted-foreground">{opt.description}</p>
                        </div>
                      </div>
                    ))}
                  </RadioGroup>
                </div>
              )}


              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="edit-group-allow-forwarding"
                    checked={allowForwarding}
                    onCheckedChange={(v) => setAllowForwarding(v === true)}
                  />
                  <div className="space-y-0.5">
                    <label htmlFor="edit-group-allow-forwarding" className="text-sm font-medium cursor-pointer">
                      Allow members to forward messages
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Turn off for sensitive chats (e.g. Committee) to hide the Forward action on messages in this group.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setOpen(false)} className="w-full sm:w-auto">
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdate}
                  disabled={updateGroupMutation.isPending || permLoading || !canEdit}
                  className="w-full sm:w-auto"
                >
                  {updateGroupMutation.isPending ? "Updating..." : "Update Group"}
                </Button>
              </div>
            </div>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
