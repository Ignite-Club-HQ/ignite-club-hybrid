import { useState, useEffect, useMemo, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Loader2, Trophy, UserPlus, Users, Shield } from "lucide-react";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { getCachedRoles } from "@/lib/rolesCache";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const AddTeamMemberSheet = lazyWithRetry(() => import("@/components/AddTeamMemberSheet"));
const AddMiniLeagueMemberSheet = lazyWithRetry(() => import("@/components/AddMiniLeagueMemberSheet").then(m => ({ default: m.AddMiniLeagueMemberSheet })));

interface HomeInviteFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Target =
  | { kind: "team"; id: string; name: string; clubId: string }
  | { kind: "mini_league"; id: string; name: string; clubId: string }
  | { kind: "competition"; id: string; name: string; clubId: string | null };

type FilterKind = "all" | "team" | "mini_league" | "competition";

export default function HomeInviteFlow({ open, onOpenChange }: HomeInviteFlowProps) {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const navigate = useNavigate();
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [filterKind, setFilterKind] = useState<FilterKind>("all");
  const [search, setSearch] = useState("");

  // Effective club filter: use activeClubFilter if set, otherwise the manually selected club
  const effectiveClubId = activeClubFilter || selectedClubId;

  const { data: invitables, isLoading: invitablesLoading, isFetching: invitablesFetching } = useQuery({
    queryKey: ["home-invite-targets", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user!.id);

      if (!roles || roles.length === 0) {
        return { teams: [], clubs: [], miniLeagues: [], competitions: [] };
      }

      const allClubIds = [...new Set(roles.map(r => r.club_id).filter(Boolean))] as string[];
      const teamIds = [...new Set(roles.map(r => r.team_id).filter(Boolean))] as string[];

      // Clubs where user can manage mini-league members club-wide
      const MANAGE_ROLES = new Set([
        "club_admin",
        "league_admin",
        "coach",
        "committee_member",
        "app_admin",
      ]);
      const leagueAdminClubIds = [
        ...new Set(
          roles
            .filter(r => MANAGE_ROLES.has(r.role as string))
            .map(r => r.club_id)
            .filter(Boolean)
        ),
      ] as string[];

      // Clubs where user can organise competitions (club_admin/association_admin/app_admin)
      const isAppAdmin = roles.some(r => r.role === "app_admin");
      const COMP_ORG_ROLES = new Set(["club_admin", "association_admin", "app_admin"]);
      const competitionOrgClubIds = [
        ...new Set(
          roles
            .filter(r => COMP_ORG_ROLES.has(r.role as string))
            .map(r => r.club_id)
            .filter(Boolean)
        ),
      ] as string[];

      const [scopedAdminsRes, compRolesRes] = await Promise.all([
        supabase.from("mini_league_admins").select("mini_league_id").eq("user_id", user!.id),
        supabase
          .from("competition_roles")
          .select("competition_id")
          .eq("user_id", user!.id)
          .in("role", ["owner", "admin"]),
      ]);

      const scopedLeagueIds = (scopedAdminsRes.data || [])
        .map((r: any) => r.mini_league_id)
        .filter(Boolean) as string[];
      const scopedCompetitionIds = (compRolesRes.data || [])
        .map((r: any) => r.competition_id)
        .filter(Boolean) as string[];

      const [teamsRes, clubsRes, clubLeaguesRes, scopedLeaguesRes, orgCompsRes, scopedCompsRes] = await Promise.all([
        teamIds.length
          ? supabase
              .from("teams")
              .select("id, name, club_id, is_archived, clubs!club_id(id, name)")
              .in("id", teamIds)
              .eq("is_archived", false)
          : Promise.resolve({ data: [] as any[] }),
        allClubIds.length
          ? supabase.from("clubs").select("id, name").in("id", allClubIds)
          : Promise.resolve({ data: [] as any[] }),
        leagueAdminClubIds.length
          ? supabase
              .from("mini_leagues")
              .select("id, name, club_id")
              .in("club_id", leagueAdminClubIds)
          : Promise.resolve({ data: [] as any[] }),
        scopedLeagueIds.length
          ? supabase
              .from("mini_leagues")
              .select("id, name, club_id")
              .in("id", scopedLeagueIds)
          : Promise.resolve({ data: [] as any[] }),
        // Competitions organised by clubs the user admins (or all if app_admin)
        isAppAdmin
          ? supabase
              .from("competitions")
              .select("id, name, season, organizer_club_id, organizer_club:organizer_club_id(name)")
              .limit(200)
          : competitionOrgClubIds.length
            ? supabase
                .from("competitions")
                .select("id, name, season, organizer_club_id, organizer_club:organizer_club_id(name)")
                .in("organizer_club_id", competitionOrgClubIds)
            : Promise.resolve({ data: [] as any[] }),
        scopedCompetitionIds.length
          ? supabase
              .from("competitions")
              .select("id, name, season, organizer_club_id, organizer_club:organizer_club_id(name)")
              .in("id", scopedCompetitionIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const teams = (teamsRes.data || []).sort((a: any, b: any) => a.name.localeCompare(b.name));
      const clubs = (clubsRes.data || []).sort((a: any, b: any) => a.name.localeCompare(b.name));
      const leagueMap = new Map<string, any>();
      [...(clubLeaguesRes.data || []), ...(scopedLeaguesRes.data || [])].forEach((l: any) => {
        leagueMap.set(l.id, l);
      });
      const miniLeagues = [...leagueMap.values()].sort((a: any, b: any) =>
        a.name.localeCompare(b.name)
      );

      const compMap = new Map<string, any>();
      [...(orgCompsRes.data || []), ...(scopedCompsRes.data || [])].forEach((c: any) => {
        compMap.set(c.id, c);
      });
      const competitions = [...compMap.values()].sort((a: any, b: any) =>
        a.name.localeCompare(b.name)
      );

      // Ensure clubs list includes any club referenced by an accessible mini-league
      const knownClubIds = new Set(clubs.map((c: any) => c.id));
      const missingClubIds = miniLeagues
        .map(l => l.club_id)
        .filter((cid): cid is string => !!cid && !knownClubIds.has(cid));
      if (missingClubIds.length) {
        const { data: extraClubs } = await supabase
          .from("clubs")
          .select("id, name")
          .in("id", [...new Set(missingClubIds)]);
        (extraClubs || []).forEach((c: any) => clubs.push(c));
        clubs.sort((a: any, b: any) => a.name.localeCompare(b.name));
      }

      return { teams, clubs, miniLeagues, competitions };
    },
  });

  const allTeams = invitables?.teams || [];
  const clubs = invitables?.clubs || [];
  const allLeagues = invitables?.miniLeagues || [];
  const allCompetitions = invitables?.competitions || [];

  // Filter by effective club
  const filteredTeams = effectiveClubId
    ? allTeams.filter(t => t.club_id === effectiveClubId)
    : allTeams;
  const filteredLeagues = effectiveClubId
    ? allLeagues.filter(l => l.club_id === effectiveClubId)
    : allLeagues;
  const filteredCompetitions = effectiveClubId
    ? allCompetitions.filter(c => c.organizer_club_id === effectiveClubId)
    : allCompetitions;

  const totalFiltered =
    filteredTeams.length + filteredLeagues.length + filteredCompetitions.length;

  type Option = {
    value: string;
    label: string;
    typeLabel: string;
    context?: string;
    icon: typeof Users;
    kind: FilterKind;
  };

  const allOptions: Option[] = useMemo(
    () => [
      ...filteredTeams.map((t: any): Option => ({
        value: `team:${t.id}`,
        label: t.name,
        typeLabel: "Team",
        context: t.clubs?.name,
        icon: Users,
        kind: "team",
      })),
      ...filteredLeagues.map((l: any): Option => ({
        value: `mini_league:${l.id}`,
        label: l.name,
        typeLabel: "Mini-league",
        icon: Shield,
        kind: "mini_league",
      })),
      ...filteredCompetitions.map((c: any): Option => ({
        value: `competition:${c.id}`,
        label: c.name,
        typeLabel: "Competition",
        context: [c.season, c.organizer_club?.name ? `Hosted by ${c.organizer_club.name}` : null]
          .filter(Boolean)
          .join(" · "),
        icon: Trophy,
        kind: "competition",
      })),
    ],
    [filteredTeams, filteredLeagues, filteredCompetitions]
  );

  const searchedOptions = useMemo(() => {
    const byKind = filterKind === "all" ? allOptions : allOptions.filter(o => o.kind === filterKind);
    const q = search.trim().toLowerCase();
    const filtered = q
      ? byKind.filter(
          o =>
            o.label.toLowerCase().includes(q) ||
            (o.context || "").toLowerCase().includes(q) ||
            o.typeLabel.toLowerCase().includes(q)
        )
      : byKind;
    return filtered.sort((a, b) => a.label.localeCompare(b.label));
  }, [allOptions, filterKind, search]);

  // Determine what step to show
  const needsClubPick = !activeClubFilter && clubs.length > 1 && !selectedClubId;

  // Auto-select if only one option after filtering
  useEffect(() => {
    if (!open || target) return;
    if (needsClubPick) return;
    if (totalFiltered === 1) {
      if (filteredTeams.length === 1) {
        const t = filteredTeams[0];
        setTarget({ kind: "team", id: t.id, name: t.name, clubId: t.club_id });
        onOpenChange(false);
        setInviteSheetOpen(true);
      } else if (filteredLeagues.length === 1) {
        const l = filteredLeagues[0];
        setTarget({ kind: "mini_league", id: l.id, name: l.name, clubId: l.club_id });
        onOpenChange(false);
        setInviteSheetOpen(true);
      } else if (filteredCompetitions.length === 1) {
        const c = filteredCompetitions[0];
        onOpenChange(false);
        navigate(`/competitions/${c.id}?invite=1`);
      }
    }
  }, [filteredTeams, filteredLeagues, filteredCompetitions, totalFiltered, open, target, needsClubPick, onOpenChange, navigate]);

  // Auto-select club if only one club
  useEffect(() => {
    if (!open || activeClubFilter) return;
    if (clubs.length === 1 && !selectedClubId) {
      setSelectedClubId(clubs[0].id);
    }
  }, [clubs, open, activeClubFilter, selectedClubId]);

  const handleClubSelect = (clubId: string) => {
    setSelectedClubId(clubId);
  };

  const handleTargetSelect = (value: string) => {
    const sep = value.indexOf(":");
    const kind = value.slice(0, sep);
    const id = value.slice(sep + 1);
    if (kind === "team") {
      const t = filteredTeams.find(x => x.id === id);
      if (!t) return;
      setTarget({ kind: "team", id: t.id, name: t.name, clubId: t.club_id });
      onOpenChange(false);
      setInviteSheetOpen(true);
    } else if (kind === "mini_league") {
      const l = filteredLeagues.find(x => x.id === id);
      if (!l) return;
      setTarget({ kind: "mini_league", id: l.id, name: l.name, clubId: l.club_id });
      onOpenChange(false);
      setInviteSheetOpen(true);
    } else if (kind === "competition") {
      const c = filteredCompetitions.find(x => x.id === id);
      if (!c) return;
      onOpenChange(false);
      navigate(`/competitions/${c.id}?invite=1`);
    }
  };

  const handleInviteSheetChange = (isOpen: boolean) => {
    setInviteSheetOpen(isOpen);
    if (!isOpen) {
      setTarget(null);
      setSelectedClubId(null);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) {
      setTarget(null);
      setSelectedClubId(null);
      setFilterKind("all");
      setSearch("");
    }
    onOpenChange(v);
  };

  const canBulkInvite = useMemo(() => {
    if (!target || target.kind !== "team") return false;
    const roles = getCachedRoles();
    if (!roles) return false;
    return roles.some(r =>
      ['club_admin', 'team_admin', 'coach', 'app_admin'].includes(r.role) &&
      (r.team_id === target.id || r.club_id === target.clubId)
    );
  }, [target]);

  const clubSelectedNoTargets =
    !needsClubPick && selectedClubId && totalFiltered === 0 && !activeClubFilter;
  const isInitialLoading = open && !invitables && (invitablesLoading || invitablesFetching);
  const showPicker =
    open &&
    (needsClubPick ||
      totalFiltered > 1 ||
      clubSelectedNoTargets);

  // Show filter chips only when we have a mix of kinds
  const kindCounts = useMemo(
    () => ({
      team: filteredTeams.length,
      mini_league: filteredLeagues.length,
      competition: filteredCompetitions.length,
    }),
    [filteredTeams.length, filteredLeagues.length, filteredCompetitions.length]
  );
  const distinctKinds = (["team", "mini_league", "competition"] as const).filter(k => kindCounts[k] > 0).length;
  const showFilterChips = distinctKinds > 1;
  const showSearch = totalFiltered > 6;

  return (
    <>
      {isInitialLoading && (
        <ResponsiveDialog open={open} onOpenChange={handleClose}>
          <ResponsiveDialogContent className="max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite people
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Loading where you can invite people…
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

      {showPicker && (
        <ResponsiveDialog open={open} onOpenChange={handleClose}>
          <ResponsiveDialogContent className="max-w-md">
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite people
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                {needsClubPick
                  ? "Choose a club first, then pick where to invite people."
                  : clubSelectedNoTargets
                    ? "You don't have any teams, mini-leagues or competitions you can invite people to yet."
                    : "Choose where you want to invite someone."}
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>

            <div className="pt-2 pb-6 space-y-3 overflow-x-hidden">
              {/* Club picker */}
              {!activeClubFilter && clubs.length > 1 && (
                <MobileCardSelect
                  value={selectedClubId || ""}
                  onValueChange={handleClubSelect}
                  options={clubs.map(c => {
                    const hasAny =
                      allTeams.some(t => t.club_id === c.id) ||
                      allLeagues.some(l => l.club_id === c.id) ||
                      allCompetitions.some(comp => comp.organizer_club_id === c.id);
                    return {
                      value: c.id,
                      label: c.name,
                      description: !hasAny ? "Nothing to invite to" : undefined,
                      disabled: !hasAny,
                    };
                  })}
                  label="Select Club"
                  placeholder="Choose a club..."
                  searchable={clubs.length > 5}
                  searchPlaceholder="Search clubs..."
                  emptyMessage="No clubs found."
                />
              )}

              {/* Combined target picker */}
              {!needsClubPick && totalFiltered > 0 && (
                <div className="space-y-2">
                  {showSearch && (
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search teams, mini-leagues or competitions"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  )}
                  {showFilterChips && (
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        { k: "all" as const, label: "All", count: totalFiltered },
                        { k: "team" as const, label: "Teams", count: kindCounts.team },
                        { k: "mini_league" as const, label: "Mini-leagues", count: kindCounts.mini_league },
                        { k: "competition" as const, label: "Competitions", count: kindCounts.competition },
                      ])
                        .filter(c => c.k === "all" || c.count > 0)
                        .map((c) => (
                          <button
                            key={c.k}
                            type="button"
                            onClick={() => setFilterKind(c.k)}
                            className={
                              "rounded-full border px-3 py-1 text-xs transition-colors " +
                              (filterKind === c.k
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground hover:bg-muted")
                            }
                          >
                            {c.label}
                            {c.k !== "all" && <span className="ml-1 opacity-70">{c.count}</span>}
                          </button>
                        ))}
                    </div>
                  )}
                  <div className="space-y-2 h-[45vh] overflow-y-auto pr-1">
                    {searchedOptions.length === 0 ? (
                      <p className="text-sm text-muted-foreground px-1 py-3">No matches.</p>
                    ) : (
                      searchedOptions.map((option) => {
                        const Icon = option.icon;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => handleTargetSelect(option.value)}
                            className="w-full min-w-0 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:bg-accent/50 active:bg-accent active:scale-[0.99]"
                          >
                            <span className="flex min-w-0 flex-1 items-center gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                                <Icon className="h-4 w-4 text-muted-foreground" />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-base font-medium text-foreground">{option.label}</span>
                                <span className="block text-xs text-muted-foreground truncate">
                                  {[option.typeLabel, option.context].filter(Boolean).join(" · ")}
                                </span>
                              </span>
                            </span>
                            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      )}

      {target?.kind === "team" && (
        <Suspense fallback={null}>
        <AddTeamMemberSheet
          teamId={target.id}
          teamName={target.name}
          clubId={target.clubId}
          canBulkInvite={canBulkInvite}
          triggerVariant="none"
          externalOpen={inviteSheetOpen}
          onExternalOpenChange={handleInviteSheetChange}
        />
        </Suspense>
      )}

      {target?.kind === "mini_league" && (
        <Suspense fallback={null}>
        <AddMiniLeagueMemberSheet
          miniLeagueId={target.id}
          miniLeagueName={target.name}
          clubId={target.clubId}
          externalOpen={inviteSheetOpen}
          onExternalOpenChange={handleInviteSheetChange}
        />
        </Suspense>
      )}
    </>
  );
}
