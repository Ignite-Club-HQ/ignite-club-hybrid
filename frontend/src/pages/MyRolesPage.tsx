import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Shield, Building2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import { supabase } from "@/integrations/supabase/client";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { connectLocalIdentityAccessClient, resetLocalIdentityAccessClient } from "@/lab/localIdentityAccess";
import { personas } from "@/lab/syntheticIdentities.mjs";

const roleLabels: Record<string, string> = {
  app_admin: "App Admin",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  basic_user: "Member",
  committee_member: "Committee Member",
  league_admin: "League Admin",
};

const roleColors: Record<string, string> = {
  app_admin: "bg-destructive/20 text-destructive",
  club_admin: "bg-primary/20 text-primary",
  team_admin: "bg-secondary text-secondary-foreground",
  coach: "bg-warning/20 text-warning",
  player: "bg-accent/20 text-accent-foreground",
  parent: "bg-muted text-muted-foreground",
  basic_user: "bg-muted text-muted-foreground",
  committee_member: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  league_admin: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
};

export default function MyRolesPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return <IcpMyRolesPage />;
  }

  return <SupabaseMyRolesPage />;
}

function IcpMyRolesPage() {
  const navigate = useNavigate();
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const requestedPersona = params.get("persona");
  const persona = requestedPersona && personas.includes(requestedPersona) ? requestedPersona : "member";
  const siteId = params.get("siteId") || undefined;
  const clubId = params.get("clubId") || undefined;
  const teamId = params.get("teamId") || undefined;
  const childId = params.get("childId") || undefined;

  useEffect(() => () => resetLocalIdentityAccessClient(), [persona]);

  const { data, error, isLoading } = useQuery({
    queryKey: ["icp-identity-access", persona, siteId, clubId, teamId, childId],
    queryFn: async () => {
      const { client, canisterId } = await connectLocalIdentityAccessClient(persona);
      const [account, access] = await Promise.all([
        client.whoami(),
        client.accessScoped(siteId, clubId, teamId, childId),
      ]);
      return { account, access, canisterId: canisterId.toText() };
    },
    retry: false,
  });

  const accessLabels = data ? [
    ["App administrator", data.access.app_admin],
    ["Club administrator", data.access.club_admin],
    ["Team member", data.access.team_member],
    ["Guardian", data.access.guardian],
  ] as const : [];

  return (
    <div className="container max-w-2xl mx-auto px-4 py-10 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">My ICP Access</h1>
          <p className="text-sm text-muted-foreground">Signed local identity/access canister query</p>
        </div>
      </div>
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Shield className="h-10 w-10 text-primary" />
            <div>
              <p className="font-semibold">Synthetic lab persona: {persona}</p>
              <p className="text-sm text-muted-foreground">Public test identity; never use outside the isolated local lab.</p>
            </div>
          </div>
          {isLoading && <Skeleton className="h-24 w-full" />}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error.message} No Supabase fallback was used.
            </p>
          )}
          {data && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-background p-3 text-sm">
                <p><span className="font-medium">Account:</span> {data.account.id}</p>
                <p><span className="font-medium">Version:</span> {data.account.version.toString()}</p>
                <p className="break-all"><span className="font-medium">Canister:</span> {data.canisterId}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {accessLabels.map(([label, enabled]) => (
                  <Badge key={label} variant={enabled ? "default" : "outline"}>
                    {label}: {enabled ? "granted" : "not granted"}
                  </Badge>
                ))}
              </div>
              {(siteId || clubId || teamId || childId) && (
                <p className="text-xs text-muted-foreground">
                  Scope: {[siteId, clubId, teamId, childId].filter(Boolean).join(" / ")}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SupabaseMyRolesPage() {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const navigate = useNavigate();

  const { data: roles, isLoading } = useQuery({
    queryKey: ["my-roles", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select(`
          id,
          role,
          club_id,
          team_id,
          clubs!club_id (id, name, logo_url),
          teams (id, name, club_id, clubs!club_id (name))
        `)
        .eq("user_id", user!.id);

      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Apply active club filter: when a club is selected, only show roles for that club.
  // App-admin (global) roles are always shown.
  const filteredRoles = activeClubFilter
    ? (roles || []).filter((r: any) => {
        if (r.role === "app_admin") return true;
        if (r.club_id === activeClubFilter) return true;
        if (r.team_id && r.teams?.club_id === activeClubFilter) return true;
        return false;
      })
    : roles;

  // Group roles by type
  const appRoles = filteredRoles?.filter((r) => r.role === "app_admin") || [];
  const clubRoles = filteredRoles?.filter((r) => r.club_id && !r.team_id) || [];
  const teamRoles = filteredRoles?.filter((r) => r.team_id) || [];

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">My Roles</h1>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : roles?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No roles assigned yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Join a club or team to get started
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* App-level roles */}
          {appRoles.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-destructive" />
                <h2 className="font-semibold">App Administration</h2>
              </div>
              {appRoles.map((role: any) => (
                <Card key={role.id}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-destructive/10">
                        <Shield className="h-5 w-5 text-destructive" />
                      </div>
                      <div>
                        <p className="font-medium">Ignite Platform</p>
                        <p className="text-sm text-muted-foreground">Global administration access</p>
                      </div>
                    </div>
                    <Badge className={roleColors[role.role]}>
                      {roleLabels[role.role]}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {/* Club roles */}
          {clubRoles.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Club Roles</h2>
              </div>
              {clubRoles.map((role: any) => (
                <Card 
                  key={role.id} 
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => navigate(`/clubs/${role.club_id}`)}
                >
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium">{roleLabels[role.role]}</p>
                        <p className="text-sm text-muted-foreground">{role.clubs?.name}</p>
                      </div>
                    </div>
                    <Badge className={roleColors[role.role]}>
                      {roleLabels[role.role]}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          {/* Team roles */}
          {teamRoles.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Team Roles</h2>
              </div>
              {teamRoles.map((role: any) => (
                <Card 
                  key={role.id}
                  className="cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => navigate(`/teams/${role.team_id}`)}
                >
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-secondary">
                        <Users className="h-5 w-5 text-secondary-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">{roleLabels[role.role]}</p>
                        <p className="text-sm text-muted-foreground">
                          {role.teams?.name} • {role.teams?.clubs?.name}
                        </p>
                      </div>
                    </div>
                    <Badge className={roleColors[role.role]}>
                      {roleLabels[role.role]}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
