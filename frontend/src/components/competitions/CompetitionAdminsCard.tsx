import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Loader2, Search, ShieldPlus, UserMinus, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Principal } from "@icp-sdk/core/principal";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { withFeatureBackend } from "@/live/featureRouter";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import {
  addLiveCompetitionRole,
  listLiveCompetitionRoles,
  removeLiveCompetitionRole,
} from "@/live/features/competitions";

interface CompetitionAdminsCardProps {
  competitionId: string;
  competitionName: string;
  organizerClubId: string | null;
}

interface RoleRow {
  id: string;
  user_id: string;
  role: string;
  profile: { display_name: string | null; avatar_url: string | null } | null;
}

/**
 * Per-competition admin management. Lists owner/admin rows from
 * `competition_roles` and lets existing competition admins grant or revoke
 * per-competition `admin` access. RLS on competition_roles enforces that
 * only competition admins can write — this component is UI gating only.
 */
export function CompetitionAdminsCard({
  competitionId,
  competitionName,
  organizerClubId,
}: CompetitionAdminsCardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const rolesQueryKey = ["competition-roles", competitionId];

  const { data: roles = [], isLoading } = useQuery({
    queryKey: rolesQueryKey,
    enabled: !!competitionId,
    queryFn: () =>
      withFeatureBackend("competitions", {
        supabase: async () => {
          const { data: roleRows, error } = await supabase
            .from("competition_roles")
            .select("id, user_id, role")
            .eq("competition_id", competitionId)
            .order("created_at", { ascending: true });
          if (error) throw error;
          const rows = roleRows ?? [];
          if (rows.length === 0) return [] as RoleRow[];

          const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, display_name, avatar_url")
            .in("id", userIds);
          const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

          return rows.map((r) => ({
            id: r.id,
            user_id: r.user_id,
            role: r.role,
            profile: profileMap.get(r.user_id) ?? null,
          })) as RoleRow[];
        },
        // Canister role grants have no joined profile row (keyed by
        // principal, not a Supabase uuid) — display principal text instead
        // of a resolved name/avatar.
        icp: async (ctx) => {
          const grants = await listLiveCompetitionRoles(ctx, competitionId);
          return grants
            .filter((g) => g.role === "owner" || g.role === "admin")
            .map((g) => ({
              id: `${g.user.toText()}:${g.role}`,
              user_id: g.user.toText(),
              role: g.role,
              profile: null,
            })) as RoleRow[];
        },
      }),
  });

  const existingUserIds = useMemo(() => new Set(roles.map((r) => r.user_id)), [roles]);

  // Member search scoped to the organiser club (consistent with other
  // club-scoped invite searches in the app).
  const isIcp = isFeatureRoutedToIcp("competitions");

  // Supabase RPC search only — the canister has no profile directory to
  // search, so ICP admins are added by pasting their principal below.
  const { data: searchResults = [], isLoading: isSearching } = useQuery({
    queryKey: ["competition-admin-search", competitionId, debouncedSearch],
    enabled: !isIcp && debouncedSearch.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedSearch.trim(),
        _limit: 8,
        _club_id: organizerClubId ?? null,
      });
      if (error) throw error;
      return (data ?? []).filter((p) => !existingUserIds.has(p.id));
    },
  });

  const addByPrincipal = () => {
    const text = search.trim();
    if (!text) return;
    try {
      Principal.fromText(text);
    } catch {
      toast({ title: "Invalid principal", description: "Enter a valid Internet Identity principal.", variant: "destructive" });
      return;
    }
    if (existingUserIds.has(text)) {
      toast({ title: "Already an admin" });
      return;
    }
    addMutation.mutate({ id: text, display_name: null });
  };

  const addMutation = useMutation({
    mutationFn: async (target: { id: string; display_name: string | null }) => {
      await withFeatureBackend("competitions", {
        supabase: async () => {
          const { error } = await supabase.from("competition_roles").insert({
            competition_id: competitionId,
            user_id: target.id,
            role: "admin",
          });
          if (error) throw error;

          await supabase.from("notifications").insert({
            user_id: target.id,
            type: "membership",
            message: `You have been added as an admin of ${competitionName}`,
            related_id: competitionId,
          });
        },
        icp: (ctx) => addLiveCompetitionRole(ctx, competitionId, Principal.fromText(target.id), "admin"),
      });
      return target;
    },
    onSuccess: (target) => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKey });
      setSearch("");
      toast({
        title: "Competition admin added",
        description: `${target.display_name ?? "User"} can now manage ${competitionName}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not add admin", description: error.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (row: RoleRow) => {
      await withFeatureBackend("competitions", {
        supabase: async () => {
          const { error } = await supabase.from("competition_roles").delete().eq("id", row.id);
          if (error) throw error;
        },
        icp: (ctx) => removeLiveCompetitionRole(ctx, competitionId, Principal.fromText(row.user_id), row.role),
      });
      return row;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: rolesQueryKey });
      toast({
        title: "Admin removed",
        description: `${row.profile?.display_name ?? "User"} no longer manages ${competitionName}.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Could not remove admin", description: error.message, variant: "destructive" });
    },
  });

  const owners = roles.filter((r) => r.role === "owner");
  const admins = roles.filter((r) => r.role === "admin");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Competition admins</CardTitle>
        <CardDescription>
          Admins can edit settings, fixtures and broadcasts for this competition only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="divide-y border rounded-md">
            {[...owners, ...admins].map((r) => {
              const isOwner = r.role === "owner";
              const isSelf = r.user_id === user?.id;
              const removable = !isOwner && !isSelf;
              return (
                <div key={r.id} className="flex items-center gap-3 p-3">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={r.profile?.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {r.profile?.display_name?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {r.profile?.display_name ?? "Unknown user"}
                      {isSelf && <span className="text-muted-foreground font-normal"> (you)</span>}
                    </p>
                  </div>
                  {isOwner ? (
                    <Badge variant="secondary" className="gap-1 shrink-0">
                      <Crown className="h-3 w-3" /> Owner
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0">Admin</Badge>
                  )}
                  {removable && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${r.profile?.display_name ?? "user"} as admin`}
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(r)}
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
            {roles.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">No admins listed.</p>
            )}
          </div>
        )}

        {/* Add admin */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isIcp ? "Paste an Internet Identity principal…" : "Search club members to add as admin…"}
              className="pl-9 pr-9"
              aria-label="Search members to add as competition admin"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {isIcp ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={addMutation.isPending || !search.trim()}
              onClick={addByPrincipal}
            >
              <ShieldPlus className="h-3.5 w-3.5" />
              Add by principal
            </Button>
          ) : debouncedSearch.trim().length >= 2 && (
            <div className="border rounded-md divide-y">
              {isSearching ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : searchResults.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  No members found. They may already be an admin, or may need to join the club first.
                </p>
              ) : (
                searchResults.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-3">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage src={p.avatar_url ?? undefined} />
                      <AvatarFallback className="bg-primary/20 text-primary text-xs">
                        {p.display_name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.display_name ?? "Unknown user"}</p>
                      {p.masked_email && (
                        <p className="text-xs text-muted-foreground truncate">{p.masked_email}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 shrink-0"
                      disabled={addMutation.isPending}
                      onClick={() => addMutation.mutate({ id: p.id, display_name: p.display_name })}
                    >
                      <ShieldPlus className="h-3.5 w-3.5" />
                      Add
                    </Button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
