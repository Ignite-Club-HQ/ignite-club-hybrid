import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Trophy, Plus, ChevronRight, Inbox } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";
import { useMemo } from "react";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { isLocalCompetitionCanisterUnavailable, listLocalCompetitions } from "@/lab/localCompetitionService";

export default function CompetitionsPage() {
  usePageTitle("Competitions");
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpCompetitionsPage />;
  }

  return <SupabaseCompetitionsPage />;
}

function IcpCompetitionsPage() {
  const { user } = useAuth();
  const localIcpPersona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const { data: competitions = [], isLoading, error } = useQuery({
    queryKey: ["local-icp-competitions", localIcpPersona],
    queryFn: () => listLocalCompetitions(localIcpPersona),
  });
  const unavailable = isLocalCompetitionCanisterUnavailable(error);

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Trophy className="h-6 w-6 text-primary" /> Competitions
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Local ICP competition state from the lab canister.
        </p>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading local ICP competitions...</p>
      ) : error ? (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-3 text-center">
            <Trophy className="h-10 w-10 mx-auto text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {unavailable ? "Competitions need a local ICP canister" : "Competitions couldn't be loaded"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {unavailable
                ? "Deploy the local competition_domain canister to enable this page in ICP mode."
                : error.message}
            </p>
          </CardContent>
        </Card>
      ) : competitions.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No local ICP competitions yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {competitions.map((competition) => (
            <Card key={competition.id}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                  <Trophy className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate flex items-center gap-2">
                    <span className="truncate">{competition.name}</span>
                    <span className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider bg-sky-500/15 text-sky-700 dark:text-sky-400">
                      ICP
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[competition.season, competition.clubs?.name].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Badge variant={competition.status === "active" ? "default" : "secondary"} className="capitalize">
                  {competition.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SupabaseCompetitionsPage() {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const scopedClub = useClubProAccess(activeClubFilter);
  const anyClub = useUserHasAnyClubPro();
  const hasPro = activeClubFilter ? scopedClub.hasPro : anyClub.hasAnyClubPro;
  const proLoading = activeClubFilter ? scopedClub.isLoading : anyClub.isLoading;

  // Clubs I admin (eligible to organise competitions)
  const { data: adminClubs = [] } = useQuery({
    queryKey: ["competitions-admin-clubs", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, clubs:club_id(id, name, kind)")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "app_admin"]);
      return (data ?? [])
        .map((r: any) => r.clubs)
        .filter((c: any) => c && c.kind !== "shell");
    },
  });

  // Competitions I can see (RLS handles visibility). When viewing a specific
  // club context (header switcher), we narrow the list to comps organised by
  // that club or which include a team from that club — otherwise app/club
  // admins would see every competition across the platform.
  const { data: allCompetitions = [], isLoading } = useQuery({
    queryKey: ["my-competitions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("competitions")
        .select("id, name, sport, season, status, visibility, starts_on, ends_on, organizer_club_id, source, last_synced_at, clubs:organizer_club_id(name), competition_entries(team_id, status, teams:team_id(club_id, deleted_at))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const competitions = useMemo(() => {
    const adminClubIds = new Set((adminClubs as any[]).map((c: any) => c.id));
    return (allCompetitions as any[]).filter((c) => {
      // Hide drafts from anyone who isn't an admin of the organising club.
      if (c.status === "draft" && !adminClubIds.has(c.organizer_club_id)) return false;
      if (!activeClubFilter) return true;
      if (c.organizer_club_id === activeClubFilter) return true;
      const entries = Array.isArray(c.competition_entries) ? c.competition_entries : [];
      // Only an accepted entry from a live (non-deleted) team keeps a club in
      // the competition — stale entries must not resurrect it in the list.
      return entries.some(
        (e: any) =>
          e?.status === "accepted" &&
          !e?.teams?.deleted_at &&
          e?.teams?.club_id === activeClubFilter,
      );
    });
  }, [allCompetitions, activeClubFilter, adminClubs]);

  // Pending invitations on teams I admin
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["competition-pending-invites", user?.id, activeClubFilter ?? "all"],
    enabled: !!user,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach", "club_admin"]);
      const teamIds = Array.from(new Set((roles ?? []).map((r: any) => r.team_id).filter(Boolean)));
      if (teamIds.length === 0) return [];
      const { data } = await supabase
        .from("competition_entries")
        .select("id, status, team_id, competition_id, teams!inner(name, club_id, deleted_at), competitions:competition_id(name, sport)")
        .in("team_id", teamIds)
        .eq("status", "invited")
        .is("teams.deleted_at", null);
      const rows = (data ?? []).filter((r: any) => !r.teams?.deleted_at);
      if (!activeClubFilter) return rows;
      return rows.filter((r: any) => r.teams?.club_id === activeClubFilter);
    },
  });

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Trophy className="h-6 w-6 text-primary" /> Competitions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Leagues and tournaments your teams are part of.
          </p>
        </div>
        {adminClubs.length > 0 && hasPro && (
          <Button asChild size="sm">
            <Link to="/competitions/new">
              <Plus className="h-4 w-4 mr-1" /> New
            </Link>
          </Button>
        )}
      </header>

      {!proLoading && !hasPro && adminClubs.length > 0 && (
        <ProFeatureLock
          title="Organising a competition is a Pro feature"
          description="Free clubs and teams can join competitions, view ladders, fixtures and linked match events. Upgrade to Pro to organise your own leagues and tournaments."
          clubId={activeClubFilter}
        />
      )}

      {pendingInvites.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Inbox className="h-4 w-4" /> Pending invitations
          </h2>
          <div className="space-y-2">
            {pendingInvites.map((inv: any) => (
              <Link key={inv.id} to={`/competitions/${inv.competition_id}`} className="block">
                <Card className="hover:border-primary transition-colors">
                  <CardContent className="p-4 flex items-center gap-3">
                    <Badge variant="secondary">Invite</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{inv.competitions?.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        For team: {inv.teams?.name}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2">All competitions</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : competitions.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No competitions yet.
              {adminClubs.length > 0 && (
                <div className="mt-3">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/competitions/new">Create your first competition</Link>
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {competitions.map((c: any) => (
              <Link key={c.id} to={`/competitions/${c.id}`} className="block">
                <Card className="hover:border-primary transition-colors">
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="rounded-lg bg-primary/10 p-2 shrink-0">
                      <Trophy className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate flex items-center gap-2">
                        <span className="truncate">{c.name}</span>
                        {c.source && c.source !== "manual" && (
                          <span className="shrink-0 inline-flex items-center px-1.5 py-px rounded text-[9px] font-semibold uppercase tracking-wider bg-sky-500/15 text-sky-700 dark:text-sky-400">
                            {c.source}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[c.sport, c.season, c.clubs?.name, c.last_synced_at ? `synced ${new Date(c.last_synced_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : null].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <Badge variant={c.status === "active" ? "default" : "secondary"} className="capitalize">
                      {c.status}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
      
    </div>
  );
}
