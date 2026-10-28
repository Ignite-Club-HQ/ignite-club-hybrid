import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, UserPlus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/useDebounce";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { membershipKeys } from "@/lab/membershipQueryKeys";
import { refreshTeamRoleChange } from "@/lab/teamMembershipCacheCompletion";
import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { createLiveChildForParentOnTeam, getLiveClubRoster } from "@/live/features/club";
import { grantLiveClubChildNameRead, registerLiveChildNamePii } from "@/live/features/vault";
import { fetchProfilesWithCache } from "@/lib/profileCache";

interface ParentCandidate {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  onThisTeam: boolean;
}

interface ClubChildMatch {
  child_id: string;
  name: string;
  year_of_birth: number | null;
  team_names: string[];
  guardian_names: string[];
  on_this_team: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  teamName: string;
  /** Owning club — required by the ICP child-creation call. */
  clubId: string;
  /** Members of the team (from user_roles join) used to populate parent picker. */
  rawMembers: Array<{
    user_id: string;
    role: string;
    profiles: { id: string; display_name: string | null; avatar_url: string | null } | null;
  }>;
  /** Pre-selected parent (e.g. when opened from a parent detail context). */
  defaultParentUserId?: string;
}

const PARENT_ROLES = new Set(["parent", "team_admin", "coach"]);



export default function AddPlayerToParentSheet({
  open,
  onOpenChange,
  teamId,
  teamName,
  clubId,
  rawMembers,
  defaultParentUserId,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedParentId, setSelectedParentId] = useState<string | null>(defaultParentUserId ?? null);
  const [search, setSearch] = useState("");
  const [childName, setChildName] = useState("");
  const [yearOfBirth, setYearOfBirth] = useState("");
  const [confirmNew, setConfirmNew] = useState(false);
  const debouncedName = useDebounce(childName, 300);
  const isIcp = resolveAuthBackend() === "icp";
  const parentId = (id: string) => isIcp && id.startsWith("principal:") ? id.slice("principal:".length) : id;

  const teamParents: ParentCandidate[] = useMemo(() => {
    const map = new Map<string, ParentCandidate>();
    for (const m of rawMembers) {
      if (!m.user_id || !PARENT_ROLES.has(m.role)) continue;
      const id = parentId(m.user_id);
      const existing = map.get(id);
      if (existing) {
        if (m.role === "parent") existing.role = "parent";
        continue;
      }
      map.set(id, {
        user_id: id,
        display_name: m.profiles?.display_name ?? null,
        avatar_url: m.profiles?.avatar_url ?? null,
        role: m.role,
        onThisTeam: true,
      });
    }
    return [...map.values()];
  }, [rawMembers, isIcp]);

  const { data: clubParents = [], isLoading: isClubParentsLoading } = useQuery({
    queryKey: ["club-parents-for-team", teamId, clubId, isIcp ? "icp" : "supabase"],
    queryFn: () => withFeatureBackend("membership", {
      icp: async ctx => {
        const roster = await getLiveClubRoster(ctx, clubId);
        const parents = new Map<string, ParentCandidate>();
        for (const grant of roster.roles) {
          if (!PARENT_ROLES.has(grant.role)) continue;
          const id = grant.user.toText();
          const existing = parents.get(id);
          parents.set(id, {
            user_id: id, display_name: existing?.display_name ?? null, avatar_url: null,
            role: grant.role === "parent" ? "parent" : existing?.role ?? grant.role,
            onThisTeam: existing?.onThisTeam === true || grant.team === teamId,
          });
        }
        const profiles = await fetchProfilesWithCache([...parents.keys()]);
        return [...parents.values()].map(parent => ({ ...parent,
          display_name: profiles.get(parent.user_id)?.display_name ?? parent.user_id,
          avatar_url: profiles.get(parent.user_id)?.avatar_url ?? null,
        }));
      },
      supabase: async () => {
      const { data, error } = await supabase.rpc("list_club_parents_for_team", {
        p_team_id: teamId,
      });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        user_id: row.user_id as string,
        display_name: row.display_name as string | null,
        avatar_url: row.avatar_url as string | null,
        role: row.role as string,
        onThisTeam: false,
      })) as ParentCandidate[];
      },
    }, { clubId }),
    enabled: open,
    staleTime: 60_000,
  });

  const allParents: ParentCandidate[] = useMemo(() => {
    const teamIds = new Set(teamParents.map((p) => p.user_id));
    const merged: ParentCandidate[] = [...teamParents];
    for (const p of clubParents) {
      if (!teamIds.has(p.user_id)) merged.push(p);
    }
    return merged;
  }, [teamParents, clubParents]);

  const filteredParents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...allParents].sort((a, b) => {
      if (a.onThisTeam !== b.onThisTeam) return a.onThisTeam ? -1 : 1;
      return (a.display_name ?? "").localeCompare(b.display_name ?? "");
    });
    if (!q) return sorted;
    return sorted.filter((p) =>
      (p.display_name ?? "").toLowerCase().includes(q)
    );
  }, [allParents, search]);


  const selectedParent =
    teamParents.find((p) => p.user_id === parentId(selectedParentId ?? "")) ??
    clubParents.find((p) => p.user_id === parentId(selectedParentId ?? "")) ??
    null;

  const reset = () => {
    setSelectedParentId(defaultParentUserId ?? null);
    setSearch("");
    setChildName("");
    setYearOfBirth("");
    setConfirmNew(false);
  };


  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const addPlayer = useMutation({
    mutationFn: async () => {
      if (!selectedParentId) throw new Error("Please pick a parent");
      const trimmed = childName.trim();
      if (!trimmed) throw new Error("Please enter the player's name");
      const yob = yearOfBirth.trim() ? parseInt(yearOfBirth.trim(), 10) : null;
      if (yob !== null && (Number.isNaN(yob) || yob < 1990 || yob > new Date().getFullYear())) {
        throw new Error("Please enter a valid year of birth");
      }

      return withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase.rpc("create_child_for_parent_on_team", {
            p_parent_user_id: selectedParentId,
            p_team_id: teamId,
            p_name: trimmed,
            p_year_of_birth: yob,
          });
          if (error) throw error;
          return data as string;
        },
        icp: async (ctx) => {
          const { Principal } = await import("@icp-sdk/core/principal");
          const parentPrincipal = Principal.fromText(parentId(selectedParentId));
          const child = await createLiveChildForParentOnTeam(
            ctx,
            clubId,
            teamId,
            parentPrincipal,
          );
          const childId = (child as any).id as string;
          // Names live on pii_access_control, not club_domain — register the
          // name and grant the parent read access (best effort).
          await registerLiveChildNamePii(ctx, childId, trimmed, parentPrincipal, clubId);
          // Club-scoped read grant so coaches/members can render the name
          // on rosters (verified live via club_domain at read time).
          await grantLiveClubChildNameRead(ctx, childId, clubId);
          return childId;
        },
      }, writeOnce({ clubId }));
    },
    onSuccess: () => {
      toast({
        title: "Player added",
        description: `${childName.trim()} added to ${teamName}.`,
      });
      queryClient.invalidateQueries({ queryKey: membershipKeys.teamChildren(teamId) });
      refreshTeamRoleChange(queryClient, teamId);
      handleOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't add player",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Existing-player lookup (Supabase only — no on-chain child search yet):
  // typing a name searches club children so an existing player can be added
  // instead of creating a duplicate.
  const { data: matches = [], isFetching: isMatchesLoading } = useQuery({
    queryKey: ["club-child-search", teamId, debouncedName.trim().toLowerCase()],
    enabled: !isIcp && open && debouncedName.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_club_children_for_team" as any, {
        p_team_id: teamId,
        p_query: debouncedName.trim(),
      });
      if (error) throw error;
      return ((data as any[]) ?? []).map((r) => ({
        child_id: r.child_id as string,
        name: r.name as string,
        year_of_birth: r.year_of_birth as number | null,
        team_names: (r.team_names ?? []) as string[],
        guardian_names: (r.guardian_names ?? []) as string[],
        on_this_team: !!r.on_this_team,
      })) as ClubChildMatch[];
    },
  });

  const linkExisting = useMutation({
    mutationFn: async (m: ClubChildMatch) => {
      if (m.on_this_team) throw new Error("This player is already on this team");
      const { error } = await supabase.rpc("add_existing_club_child_to_team" as any, {
        p_team_id: teamId,
        p_child_id: m.child_id,
      });
      if (error) throw error;
      return m;
    },
    onSuccess: (m) => {
      toast({ title: "Player added", description: `${m.name} added to ${teamName}.` });
      queryClient.invalidateQueries({ queryKey: membershipKeys.teamChildren(teamId) });
      queryClient.invalidateQueries({ queryKey: ["club-child-search", teamId] });
      refreshTeamRoleChange(queryClient, teamId);
      handleOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't add player", description: err.message, variant: "destructive" });
    },
  });

  // Creating a brand-new player is a deliberate choice once a search ran.
  const searched = !isIcp && childName.trim().length >= 2;
  const canSubmit =
    !!selectedParentId &&
    childName.trim().length > 0 &&
    (!searched || confirmNew) &&
    !addPlayer.isPending;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left">
          <SheetTitle>Add player</SheetTitle>
          <SheetDescription>
            Add a new player to an existing parent — no invite needed.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Parent
            </Label>
            {selectedParent ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={selectedParent.avatar_url ?? undefined} />
                    <AvatarFallback>
                      {(selectedParent.display_name ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {selectedParent.display_name ?? "Unnamed user"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <Badge variant="secondary" className="text-[10px]">
                        {selectedParent.role.replace("_", " ")}
                      </Badge>
                      {!selectedParent.onThisTeam && (
                        <Badge variant="outline" className="text-[10px]">
                          Not on this team
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedParentId(null)}
                  disabled={addPlayer.isPending}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search any parent in the club…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Includes parents on other teams in this club.
                </p>
                <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
                  {isClubParentsLoading && allParents.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading parents…
                    </div>
                  ) : filteredParents.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">
                      No parents found.
                    </div>
                  ) : (
                    filteredParents.map((p) => (
                      <button
                        key={p.user_id}
                        type="button"
                        onClick={() => setSelectedParentId(p.user_id)}
                        className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/60 transition-colors"
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={p.avatar_url ?? undefined} />
                          <AvatarFallback>
                            {(p.display_name ?? "?").slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">
                            {p.display_name ?? "Unnamed user"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {p.role.replace("_", " ")}
                            {!p.onThisTeam && " • other team"}
                          </p>
                        </div>
                        {!p.onThisTeam && (
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            Club
                          </Badge>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </>

            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="child-name">Player name</Label>
            <Input
              id="child-name"
              value={childName}
              onChange={(e) => { setChildName(e.target.value); setConfirmNew(false); }}
              placeholder="e.g. Emmy Collings"
              disabled={addPlayer.isPending || linkExisting.isPending}
              autoComplete="off"
            />
            {!isIcp && debouncedName.trim().length >= 2 && !confirmNew && (
              <div className="rounded-lg border divide-y max-h-72 overflow-y-auto">
                {isMatchesLoading ? (
                  <div className="p-3 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Searching club players…
                  </div>
                ) : (
                  <>
                    {matches.length > 0 && (
                      <p className="px-3 py-2 text-[11px] text-muted-foreground">
                        Already in the club — tap to add to {teamName}
                      </p>
                    )}
                    {matches.map((m) => (
                      <button
                        key={m.child_id}
                        type="button"
                        disabled={m.on_this_team || linkExisting.isPending}
                        onClick={() => linkExisting.mutate(m)}
                        className="w-full p-3 text-left hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:hover:bg-transparent"
                      >
                        <p className="text-sm font-medium">
                          {m.name}
                          {m.year_of_birth ? <span className="text-muted-foreground font-normal"> · {m.year_of_birth}</span> : null}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {m.on_this_team
                            ? "Already on this team"
                            : `Team: ${m.team_names.join(", ") || "None"}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          Parent: {m.guardian_names.join(", ") || "Not listed"}
                        </p>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setConfirmNew(true)}
                      className="w-full p-3 text-left text-sm text-primary hover:bg-muted/60 flex items-center gap-2"
                    >
                      <UserPlus className="h-4 w-4" /> Create new player: “{childName.trim()}”
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="child-yob">Year of birth (optional)</Label>
            <Input
              id="child-yob"
              type="number"
              inputMode="numeric"
              value={yearOfBirth}
              onChange={(e) => setYearOfBirth(e.target.value)}
              placeholder="e.g. 2017"
              disabled={addPlayer.isPending}
            />
          </div>

          <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
            The player will be linked to the selected parent and added to the {teamName}{" "}
            roster immediately. No email invite is sent.
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleOpenChange(false)}
              disabled={addPlayer.isPending}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => addPlayer.mutate()}
              disabled={!canSubmit}
            >
              {addPlayer.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Add player
                </>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
