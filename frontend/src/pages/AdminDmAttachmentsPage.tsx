import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, X, Building2, User as UserIcon, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { toast } from "sonner";
import { Principal } from "@icp-sdk/core/principal";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  getLiveClubDmSettings,
  listLiveAllClubDmSettings,
  listLiveDmAttachmentsDisabled,
  setLiveClubDmSettings,
  setLiveDmAttachmentsDisabled,
} from "@/live/features/messaging";
import { listLiveClubs } from "@/live/features/club";
import { searchLiveProfilesWithPrincipals } from "@/live/features/identityAccessClient";

interface DmRestriction {
  id: string;
  scope: "club" | "user";
  club_id?: string | null;
  user_id?: string | null;
}

export default function AdminDmAttachmentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"club" | "user">("club");
  const { isAppAdmin, isLoading: checkingAdmin } = useIsAppAdmin();

  const { data: restrictions, isLoading } = useQuery({
    queryKey: ["dm-attachment-restrictions"],
    queryFn: () =>
      withFeatureBackend("messaging", {
        supabase: async (): Promise<DmRestriction[]> => {
          const { data, error } = await supabase
            .from("dm_attachment_restrictions")
            .select("*")
            .order("created_at", { ascending: false });
          if (error) throw error;
          return (data || []) as DmRestriction[];
        },
        icp: async (ctx): Promise<DmRestriction[]> => {
          const [clubSettings, userPrincipals] = await Promise.all([
            listLiveAllClubDmSettings(ctx),
            listLiveDmAttachmentsDisabled(ctx),
          ]);
          return [
            ...clubSettings
              .filter((s) => s.attachmentsDisabled)
              .map((s) => ({ id: `club:${s.clubId}`, scope: "club" as const, club_id: s.clubId })),
            ...userPrincipals.map((p) => ({ id: `user:${p}`, scope: "user" as const, user_id: p })),
          ];
        },
      }),
    enabled: isAppAdmin === true,
  });

  const { data: clubs } = useQuery({
    queryKey: ["all-clubs-min"],
    queryFn: () =>
      withFeatureBackend("membership", {
        supabase: async () => {
          const { data } = await supabase.from("clubs").select("id, name").order("name");
          return data || [];
        },
        icp: async (ctx) => {
          const out: { id: string; name: string }[] = [];
          let cursor: string | null = null;
          for (let i = 0; i < 20; i++) {
            const batch = await listLiveClubs(ctx, cursor, 50);
            out.push(...batch.map((c) => ({ id: c.id, name: c.name })));
            if (batch.length < 50) break;
            cursor = batch[batch.length - 1]!.id;
          }
          return out.sort((a, b) => a.name.localeCompare(b.name));
        },
      }),
    enabled: isAppAdmin === true,
  });

  const restrictedClubIds = new Set((restrictions || []).filter((r) => r.scope === "club").map((r) => r.club_id!));
  const restrictedUserIds = new Set((restrictions || []).filter((r) => r.scope === "user").map((r) => r.user_id!));

  // Display names for restricted users: Supabase resolves them from the
  // profiles table; on ICP there is no principal->profile lookup, so names
  // are known only for users restricted via this page's search this session
  // (otherwise the shortened principal is shown).
  const [knownUserNames, setKnownUserNames] = useState<Map<string, string>>(new Map());

  const { data: restrictedUserProfiles } = useQuery({
    queryKey: ["dm-restriction-user-profiles", Array.from(restrictedUserIds).sort().join(",")],
    queryFn: () =>
      withFeatureBackend("messaging", {
        supabase: async () => {
          if (restrictedUserIds.size === 0) return [] as any[];
          const { data } = await supabase
            .from("profiles")
            .select("id, display_name, email")
            .in("id", Array.from(restrictedUserIds));
          return data || [];
        },
        icp: async () => [] as any[],
      }),
    enabled: isAppAdmin === true && restrictedUserIds.size > 0,
  });

  const addClubMutation = useMutation({
    mutationFn: (clubId: string) =>
      withFeatureBackend("messaging", {
        supabase: async () => {
          const { error } = await supabase
            .from("dm_attachment_restrictions")
            .insert({ scope: "club", club_id: clubId, created_by: user!.id });
          if (error) throw error;
        },
        icp: async (ctx) => {
          const current = await getLiveClubDmSettings(ctx, clubId);
          await setLiveClubDmSettings(ctx, clubId, current.dm_disabled, true);
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dm-attachment-restrictions"] });
      toast.success("Club restricted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addUserMutation = useMutation({
    mutationFn: (userId: string) =>
      withFeatureBackend("messaging", {
        supabase: async () => {
          const { error } = await supabase
            .from("dm_attachment_restrictions")
            .insert({ scope: "user", user_id: userId, created_by: user!.id });
          if (error) throw error;
        },
        icp: async (ctx) => {
          await setLiveDmAttachmentsDisabled(ctx, Principal.fromText(userId), true);
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dm-attachment-restrictions"] });
      qc.invalidateQueries({ queryKey: ["dm-restriction-user-profiles"] });
      toast.success("User restricted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (restriction: DmRestriction) =>
      withFeatureBackend("messaging", {
        supabase: async () => {
          const { error } = await supabase.from("dm_attachment_restrictions").delete().eq("id", restriction.id);
          if (error) throw error;
        },
        icp: async (ctx) => {
          if (restriction.scope === "club") {
            const current = await getLiveClubDmSettings(ctx, restriction.club_id!);
            await setLiveClubDmSettings(ctx, restriction.club_id!, current.dm_disabled, false);
          } else {
            await setLiveDmAttachmentsDisabled(ctx, Principal.fromText(restriction.user_id!), false);
          }
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dm-attachment-restrictions"] });
      toast.success("Restriction removed");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [selectedClub, setSelectedClub] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [searchedUsers, setSearchedUsers] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const handleSearchUsers = async () => {
    const q = userSearch.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const results = await withFeatureBackend("messaging", {
        supabase: async () => {
          const { data } = await supabase
            .from("profiles")
            .select("id, display_name, email")
            .or(`display_name.ilike.%${q}%,email.ilike.%${q}%`)
            .limit(20);
          return (data || []).map((u: any) => ({ id: u.id, display_name: u.display_name, email: u.email }));
        },
        icp: async (ctx) => {
          const rows = await searchLiveProfilesWithPrincipals(ctx, q, 20);
          return rows.map((r) => ({
            id: r.principal.toText(),
            display_name: r.displayName,
            email: null as string | null,
          }));
        },
      });
      setSearchedUsers(results);
      setKnownUserNames((prev) => {
        const next = new Map(prev);
        for (const u of results) if (u.display_name) next.set(u.id, u.display_name);
        return next;
      });
    } finally {
      setSearching(false);
    }
  };

  if (checkingAdmin) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">DM Attachments</h1>
        </div>
        <p className="text-muted-foreground px-4">Access denied. App admin role required.</p>
      </div>
    );
  }

  const clubRestrictions = (restrictions || []).filter((r) => r.scope === "club");
  const userRestrictions = (restrictions || []).filter((r) => r.scope === "user");
  const profileById = new Map((restrictedUserProfiles || []).map((p: any) => [p.id, p]));
  const shortPrincipal = (p: string) => (p.length > 14 ? `${p.slice(0, 12)}…` : p);

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">DM Attachments</h1>
          <p className="text-sm text-muted-foreground">
            Disable the "+" attachment menu in direct messages by club or by user
          </p>
        </div>
      </div>

      <div className="flex gap-2 px-1">
        <Button variant={tab === "club" ? "default" : "outline"} size="sm" onClick={() => setTab("club")} className="gap-1">
          <Building2 className="h-4 w-4" /> By Club
        </Button>
        <Button variant={tab === "user" ? "default" : "outline"} size="sm" onClick={() => setTab("user")} className="gap-1">
          <UserIcon className="h-4 w-4" /> By User
        </Button>
      </div>

      {tab === "club" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Restricted Clubs</CardTitle>
            <CardDescription>
              Members of these clubs cannot attach images, vault files, events, or boards in DMs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Select value={selectedClub} onValueChange={setSelectedClub}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Choose a club to restrict..." />
                </SelectTrigger>
                <SelectContent>
                  {(clubs || [])
                    .filter((c: any) => !restrictedClubIds.has(c.id))
                    .map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => {
                  if (selectedClub) {
                    addClubMutation.mutate(selectedClub);
                    setSelectedClub("");
                  }
                }}
                disabled={!selectedClub || addClubMutation.isPending}
                size="icon"
              >
                {addClubMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </Button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : clubRestrictions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No clubs restricted</p>
            ) : (
              <div className="space-y-2">
                {clubRestrictions.map((r) => {
                  const club = clubs?.find((c: any) => c.id === r.club_id);
                  return (
                    <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{club?.name || r.club_id}</span>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeMutation.mutate(r)}
                        disabled={removeMutation.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "user" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Restricted Users</CardTitle>
            <CardDescription>
              These users cannot attach images, vault files, events, or boards in DMs.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search by name..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearchUsers()}
              />
              <Button onClick={handleSearchUsers} disabled={searching || userSearch.trim().length < 2} size="icon">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </div>

            {searchedUsers.length > 0 && (
              <div className="space-y-2 border rounded-lg p-2 bg-muted/30">
                <p className="text-xs text-muted-foreground px-1">Search results</p>
                {searchedUsers.map((u) => {
                  const isRestricted = restrictedUserIds.has(u.id);
                  return (
                    <div key={u.id} className="flex items-center justify-between p-2 rounded bg-background">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{u.display_name || "(no name)"}</p>
                        {u.email && (
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        )}
                      </div>
                      {isRestricted ? (
                        <Badge variant="secondary">Restricted</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => addUserMutation.mutate(u.id)}
                          disabled={addUserMutation.isPending}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Restrict
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {isLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : userRestrictions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No users restricted</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground px-1">Currently restricted</p>
                {userRestrictions.map((r) => {
                  const profile: any = profileById.get(r.user_id);
                  const name = profile?.display_name || knownUserNames.get(r.user_id!) || shortPrincipal(r.user_id!);
                  return (
                    <div key={r.id} className="flex items-center justify-between p-3 rounded-lg border">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{name}</p>
                        {profile?.email && (
                          <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                        )}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeMutation.mutate(r)}
                        disabled={removeMutation.isPending}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
