import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Network, Plus, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { ProFeatureLock } from "@/components/subscription/ProFeatureLock";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabAssociations } from "@/lab/fixtureDataLayer";

export default function AssociationsPage() {
  usePageTitle("Associations");
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    const associations = getLocalLabAssociations();
    return (
      <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
        <header className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-3 shrink-0"><Network className="h-5 w-5 text-primary" /></div>
          <div>
            <h1 className="text-2xl font-bold">Associations</h1>
            <p className="text-xs text-muted-foreground">Showing synthetic ICP lab associations. Creating new ones is disabled.</p>
          </div>
        </header>
        <div className="space-y-2">
          {associations.map((a) => (
            <Link key={a.id} to={`/associations/${a.id}`} className="block">
              <Card className="hover:border-primary transition-colors">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.name}</div>
                    <div className="text-xs text-muted-foreground">Association</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return <SupabaseAssociationsPage />;
}

function SupabaseAssociationsPage() {
  const { user } = useAuth();
  const { hasAnyClubPro, isLoading: proLoading } = useUserHasAnyClubPro();

  const { data: associations = [], isLoading } = useQuery({
    queryKey: ["my-associations", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("role", "association_admin");
      const ids = Array.from(new Set((roles ?? []).map((r: any) => r.club_id).filter(Boolean)));
      if (ids.length === 0) return [];
      const { data } = await supabase
        .from("clubs")
        .select("id, name, logo_url, kind")
        .in("id", ids);
      return data ?? [];
    },
  });

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="rounded-xl bg-primary/10 p-3 shrink-0"><Network className="h-5 w-5 text-primary" /></div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">Associations</h1>
            <p className="text-xs text-muted-foreground">Federations and umbrella bodies you manage</p>
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0" disabled={!hasAnyClubPro}>
          <Link to={hasAnyClubPro ? "/associations/new" : "#"}><Plus className="h-4 w-4 mr-1" /> New</Link>
        </Button>
      </header>

      {!proLoading && !hasAnyClubPro ? (
        <ProFeatureLock
          title="Associations is a Pro feature"
          description="Manage federations and umbrella bodies. Upgrade your club to Pro to unlock."
          showUpgradeButton={false}
        />
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : associations.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          You're not an admin of any association yet.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {associations.map((a: any) => (
            <Link key={a.id} to={`/associations/${a.id}`} className="block">
              <Card className="hover:border-primary transition-colors">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{a.name}</div>
                    <div className="text-xs text-muted-foreground">Association</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
