import { useMemo, useState } from "react";
import { Principal } from "@icp-sdk/core/principal";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, ShieldPlus, UserMinus } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useDebounce } from "@/hooks/useDebounce";
import { useToast } from "@/hooks/use-toast";
import { withFeatureBackend } from "@/live/featureRouter";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { addLiveCompetitionRole, listLiveCompetitionRoles, removeLiveCompetitionRole } from "@/live/features/competitions";
import { supabase } from "@/integrations/supabase/client";
import { CompetitionOfficialJoinLinksCard } from "@/components/competitions/CompetitionOfficialJoinLinksCard";

const OFFICIAL_ROLES = [
  { value: "referee", label: "Referee" },
  { value: "committee_member", label: "Committee" },
] as const;

type OfficialRole = (typeof OFFICIAL_ROLES)[number]["value"];
interface CompetitionOfficial {
  id: string;
  userId: string;
  role: OfficialRole;
  name: string | null;
  avatarUrl: string | null;
}

export function CompetitionOfficialsCard({
  competitionId,
  competitionName,
  organizerClubId,
}: {
  competitionId: string;
  competitionName: string;
  organizerClubId: string | null;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<OfficialRole>("referee");
  const debouncedSearch = useDebounce(search, 300);
  const isIcp = isFeatureRoutedToIcp("competitions");
  const queryKey = ["competition-officials", competitionId];

  const { data: officials = [], isLoading } = useQuery({
    queryKey,
    enabled: !!competitionId,
    queryFn: () => withFeatureBackend("competitions", {
      supabase: async () => {
        const { data, error } = await supabase
          .from("competition_roles")
          .select("id, user_id, role")
          .eq("competition_id", competitionId)
          .in("role", OFFICIAL_ROLES.map((item) => item.value));
        if (error) throw error;
        const rows = data ?? [];
        if (rows.length === 0) return [] as CompetitionOfficial[];
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", rows.map((row) => row.user_id));
        if (profileError) throw profileError;
        const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
        return rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          role: row.role as OfficialRole,
          name: profileMap.get(row.user_id)?.display_name ?? null,
          avatarUrl: profileMap.get(row.user_id)?.avatar_url ?? null,
        }));
      },
      icp: async (ctx) => (await listLiveCompetitionRoles(ctx, competitionId))
        .filter((grant) => OFFICIAL_ROLES.some((item) => item.value === grant.role))
        .map((grant) => ({
          id: `${grant.user.toText()}:${grant.role}`,
          userId: grant.user.toText(),
          role: grant.role as OfficialRole,
          name: null,
          avatarUrl: null,
        })),
    }),
  });

  const assigned = useMemo(() => new Set(officials.map((official) => `${official.userId}:${official.role}`)), [officials]);
  const { data: candidates = [], isLoading: searching } = useQuery({
    queryKey: ["competition-official-search", competitionId, debouncedSearch],
    enabled: !isIcp && debouncedSearch.trim().length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_invitable_profiles", {
        _query: debouncedSearch.trim(),
        _limit: 8,
        _club_id: organizerClubId,
      });
      if (error) throw error;
      return (data ?? []).filter((profile) => !assigned.has(`${profile.id}:${role}`));
    },
  });

  const addMutation = useMutation({
    mutationFn: async (person: { id: string; name: string | null }) => withFeatureBackend("competitions", {
      supabase: async () => {
        const { error } = await supabase.from("competition_roles").insert({
          competition_id: competitionId,
          user_id: person.id,
          role,
        });
        if (error) throw error;
      },
      icp: (ctx) => addLiveCompetitionRole(ctx, competitionId, Principal.fromText(person.id), role),
    }),
    onSuccess: (_, person) => {
      queryClient.invalidateQueries({ queryKey });
      setSearch("");
      toast({ title: `${OFFICIAL_ROLES.find((item) => item.value === role)?.label ?? "Official"} added`, description: person.name ?? "Role assigned." });
    },
    onError: (error: Error) => toast({ title: "Could not add official", description: error.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (official: CompetitionOfficial) => withFeatureBackend("competitions", {
      supabase: async () => {
        const { error } = await supabase.from("competition_roles").delete().eq("id", official.id);
        if (error) throw error;
      },
      icp: (ctx) => removeLiveCompetitionRole(ctx, competitionId, Principal.fromText(official.userId), official.role),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Official removed" });
    },
    onError: (error: Error) => toast({ title: "Could not remove official", description: error.message, variant: "destructive" }),
  });

  const addPrincipal = () => {
    const value = search.trim();
    if (!value) return;
    try {
      Principal.fromText(value);
    } catch {
      toast({ title: "Invalid principal", description: "Enter a valid Internet Identity principal.", variant: "destructive" });
      return;
    }
    if (assigned.has(`${value}:${role}`)) {
      toast({ title: "Already assigned" });
      return;
    }
    addMutation.mutate({ id: value, name: null });
  };

  return (
    <div className="space-y-4">
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Competition officials</CardTitle>
        <CardDescription>Manage competition-scoped referee and committee roles.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : officials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No officials assigned.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {officials.map((official) => (
              <div key={official.id} className="flex items-center gap-3 p-3">
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={official.avatarUrl ?? undefined} />
                  <AvatarFallback className="text-xs">{official.name?.charAt(0)?.toUpperCase() ?? "?"}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{official.name ?? official.userId}</p>
                </div>
                <span className="text-xs text-muted-foreground">{OFFICIAL_ROLES.find((item) => item.value === official.role)?.label}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${official.name ?? "official"}`}
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(official)}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Select value={role} onValueChange={(value) => setRole(value as OfficialRole)}>
            <SelectTrigger aria-label="Official role"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OFFICIAL_ROLES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isIcp ? "Internet Identity principal" : "Search club members"}
            aria-label="Search competition officials"
          />
        </div>
        {isIcp ? (
          <Button size="sm" variant="outline" disabled={addMutation.isPending || !search.trim()} onClick={addPrincipal}>
            <ShieldPlus className="mr-2 h-4 w-4" /> Add by principal
          </Button>
        ) : debouncedSearch.trim().length >= 2 ? (
          <div className="divide-y rounded-md border">
            {searching ? <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div> : candidates.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No eligible members found for {competitionName}.</p>
            ) : candidates.map((candidate) => (
              <div key={candidate.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{candidate.display_name ?? "Unknown user"}</p>
                </div>
                <Button size="sm" variant="outline" disabled={addMutation.isPending} onClick={() => addMutation.mutate({ id: candidate.id, name: candidate.display_name })}>
                  <ShieldPlus className="mr-2 h-4 w-4" /> Add
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
    <CompetitionOfficialJoinLinksCard competitionId={competitionId} competitionName={competitionName} />
    </div>
  );
}
