import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { MemberRow } from "@/components/members/MemberRow";
import {
  computeMemberIdentity,
  type MemberRole,
  type MemberIdentity,
} from "@/lib/memberIdentity";

interface Candidate {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  identity: MemberIdentity;
  /** searchable haystack: name + children + teams + role */
  haystack: string;
}

interface AddGroupMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  existingMemberIds: string[];
}

export function AddGroupMembersDialog({
  open,
  onOpenChange,
  groupId,
  existingMemberIds,
}: AddGroupMembersDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Candidate[]>([]);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["add-group-members-candidates-v2", user?.id, groupId, existingMemberIds.length],
    queryFn: async (): Promise<Candidate[]> => {
      if (!user) return [];

      const { data: myRoles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user.id)
        .not("club_id", "is", null);

      const clubIds = [
        ...new Set((myRoles || []).map(r => r.club_id).filter(Boolean)),
      ] as string[];
      if (clubIds.length === 0) return [];

      const { data: proClubs } = await supabase
        .from("club_subscriptions")
        .select("club_id")
        .in("club_id", clubIds)
        .or(
          "is_pro.eq.true,is_pro_football.eq.true,admin_pro_override.eq.true,admin_pro_football_override.eq.true",
        );

      const proClubIds = (proClubs || []).map(c => c.club_id);
      if (proClubIds.length === 0) return [];

      const [allRolesResult, appAdminsResult, teamsResult] = await Promise.all([
        supabase
          .from("user_roles")
          .select("user_id, club_id, team_id, role")
          .in("club_id", proClubIds)
          .neq("user_id", user.id),
        supabase.from("user_roles").select("user_id").eq("role", "app_admin"),
        supabase
          .from("teams")
          .select("id, name")
          .in("club_id", proClubIds),
      ]);

      const appAdminIds = new Set((appAdminsResult.data || []).map(a => a.user_id));
      const excludeIds = new Set(existingMemberIds);
      const teamNameById: Record<string, string> = {};
      for (const t of teamsResult.data || []) teamNameById[t.id] = t.name;

      // Group roles by user (filtering out admins and existing members)
      const rolesByUser = new Map<
        string,
        { role: MemberRole; team_id: string | null }[]
      >();
      for (const row of allRolesResult.data || []) {
        if (appAdminIds.has(row.user_id)) continue;
        if (excludeIds.has(row.user_id)) continue;
        const arr = rolesByUser.get(row.user_id) || [];
        arr.push({ role: row.role as MemberRole, team_id: row.team_id });
        rolesByUser.set(row.user_id, arr);
      }

      const userIds = [...rolesByUser.keys()];
      if (userIds.length === 0) return [];

      const [profilesResult, childrenResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", userIds),
        supabase
          .from("children")
          .select("parent_id, name")
          .in("parent_id", userIds),
      ]);

      const childrenByParent = new Map<string, string[]>();
      for (const c of childrenResult.data || []) {
        if (!c.parent_id || !c.name) continue;
        const arr = childrenByParent.get(c.parent_id) || [];
        arr.push(c.name);
        childrenByParent.set(c.parent_id, arr);
      }

      return (profilesResult.data || []).map(p => {
        const roles = rolesByUser.get(p.id) || [];
        const children_names = childrenByParent.get(p.id) || [];
        const identity = computeMemberIdentity({
          display_name: p.display_name,
          roles,
          children_names,
          teamNameById,
        });
        const teamNames = roles
          .map(r => (r.team_id ? teamNameById[r.team_id] : null))
          .filter(Boolean) as string[];
        const haystack = [
          p.display_name || "",
          ...children_names,
          ...teamNames,
          identity.roleLabel,
          identity.contextLine,
        ]
          .join(" ")
          .toLowerCase();
        return {
          id: p.id,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          identity,
          haystack,
        };
      });
    },
    enabled: open && !!user,
    staleTime: 60 * 1000,
  });

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(c => c.haystack.includes(q));
  }, [candidates, searchQuery]);

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!user || selected.length === 0) return;
      const inserts = selected.map(s => ({
        group_id: groupId,
        user_id: s.id,
        added_by: user.id,
      }));
      const { error } = await supabase.from("group_members").insert(inserts);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        selected.length === 1
          ? `${selected[0].display_name || "Member"} added`
          : `${selected.length} people added`,
      );
      queryClient.invalidateQueries({ queryKey: ["chat-members"] });
      setSelected([]);
      setSearchQuery("");
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast.error("Failed to add members: " + (err?.message || "Unknown error"));
    },
  });

  const toggle = (c: Candidate) => {
    setSelected(prev =>
      prev.some(s => s.id === c.id) ? prev.filter(s => s.id !== c.id) : [...prev, c],
    );
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={o => {
        onOpenChange(o);
        if (!o) {
          setSelected([]);
          setSearchQuery("");
        }
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-md" fullScreen>
        <ResponsiveDialogHeader className="px-4 pt-2 pb-3 border-b border-border/60">
          <ResponsiveDialogTitle className="text-base font-semibold text-center sm:text-left">
            Add people
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="text-xs text-muted-foreground text-center sm:text-left">
            Search by name, child, team, or role
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        {/* Sticky search */}
        <div className="shrink-0 px-4 pt-3 pb-2 bg-card sticky top-0 z-10 border-b border-border/40">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name, child, team, role..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-10 rounded-xl"
            />
          </div>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {selected.map(s => (
                <Badge
                  key={s.id}
                  variant="secondary"
                  className="gap-1 pr-1 rounded-full"
                >
                  {s.display_name?.split(" ")[0] || "User"}
                  <button
                    onClick={() => toggle(s)}
                    className="ml-0.5 rounded-full hover:bg-background/60 p-0.5"
                    aria-label="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-muted-foreground text-sm">
              {searchQuery ? "No members found" : "No more people to add"}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filtered.map(c => (
                <MemberRow
                  key={c.id}
                  name={c.display_name || "Unknown User"}
                  avatarUrl={c.avatar_url}
                  identity={c.identity}
                  selected={selected.some(s => s.id === c.id)}
                  query={searchQuery}
                  onToggle={() => toggle(c)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] shadow-[0_-4px_12px_-8px_hsl(var(--foreground)/0.2)]">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-muted-foreground hover:text-foreground px-4"
            >
              Cancel
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={selected.length === 0 || addMutation.isPending}
              className="flex-1 gap-2 h-11 rounded-xl font-semibold transition-all"
            >
              {addMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {selected.length === 0
                ? "Add members"
                : `Add ${selected.length} ${selected.length === 1 ? "member" : "members"}`}
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
