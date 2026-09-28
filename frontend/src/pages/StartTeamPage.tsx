import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Shield, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useClubTheme } from "@/hooks/useClubTheme";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClubList } from "@/lab/fixtureDataLayer";


/**
 * Tap-to-proceed chooser. If the user has zero admin clubs, we auto-route
 * straight into the personal team flow. If they have exactly one, we auto-route
 * into that club. Otherwise we show a tappable list — no Continue button.
 */
export default function StartTeamPage() {
  usePageTitle("Start a team");
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();

  const { toast } = useToast();
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const providerKey = useIcpLab ? "icp" : "supabase";
  const [working, setWorking] = useState(false);
  const autoRoutedRef = useRef(false);

  const { data: clubs = [], isLoading } = useQuery({
    queryKey: ["my-admin-clubs-for-team", user?.id, providerKey],
    enabled: !!user,
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabClubList().map((club) => ({
          id: club.id,
          name: club.name,
          kind: "club",
        }));
      }
      const { data } = await supabase
        .from("user_roles")
        .select("club_id, clubs:club_id(id, name, kind)")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "app_admin"]);
      const seen = new Set<string>();
      return (data ?? [])
        .map((r: any) => r.clubs)
        .filter((c: any) => c && c.kind !== "shell" && !seen.has(c.id) && (seen.add(c.id), true));
    },
  });

  const goPersonal = async () => {
    if (!user || working) return;
    if (useIcpLab) {
      toast({
        title: "Personal team creation is unavailable in ICP lab mode",
        description: "No club or team data has been created.",
      });
      return;
    }
    setWorking(true);
    try {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, clubs:club_id(id, kind)")
        .eq("user_id", user.id)
        .eq("role", "club_admin");
      const existing = (roles ?? [])
        .map((r: any) => r.clubs)
        .find((c: any) => c && c.kind === "shell");
      if (existing?.id) {
        navigate(`/clubs/${existing.id}/teams/new`, { replace: true });
        return;
      }

      const { data: profile } = await selectCachedProfileById(user.id);
      const who = profile?.display_name?.trim() || "My";

      const { data: shell, error: shellErr } = await supabase
        .from("clubs")
        .insert({ name: `${who}'s teams`, kind: "shell", created_by: user.id })
        .select("id")
        .single();
      if (shellErr || !shell) throw shellErr ?? new Error("Could not create personal organiser");

      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: user.id, club_id: shell.id, role: "club_admin" });
      if (roleErr) throw roleErr;

      navigate(`/clubs/${shell.id}/teams/new`, { replace: true });
    } catch (err: any) {
      setWorking(false);
      autoRoutedRef.current = false;
      toast({
        title: "Couldn't start a team",
        description: err?.message ?? "Please try again",
        variant: "destructive",
      });
    }
  };

  const goClub = (clubId: string) => {
    if (working) return;
    navigate(`/clubs/${clubId}/teams/new`, { replace: true });
  };

  // Auto-skip the chooser when there's only one logical option, or when the app
  // is filtered to a club the user can create teams in.
  useEffect(() => {
    if (useIcpLab || isLoading || autoRoutedRef.current) return;
    const filtered = activeClubFilter
      ? clubs.find((c: any) => c.id === activeClubFilter)
      : null;
    if (filtered) {
      autoRoutedRef.current = true;
      goClub(filtered.id);
    } else if (clubs.length === 0) {
      autoRoutedRef.current = true;
      void goPersonal();
    } else if (clubs.length === 1) {
      autoRoutedRef.current = true;
      goClub(clubs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useIcpLab, isLoading, clubs.length, activeClubFilter]);


  // While we're loading or auto-routing, render a calm spinner instead of flashing the chooser.
  if (isLoading || autoRoutedRef.current) {
    return (
      <div className="container max-w-md mx-auto px-4 pt-16 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container max-w-md mx-auto px-4 pt-4 pb-8">
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 active:scale-95 transition-transform"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        <h1 className="text-2xl font-bold tracking-tight">Start a Team</h1>
      </div>

      <p className="text-sm text-muted-foreground max-w-[280px] mb-5 leading-relaxed">
        {useIcpLab
          ? "Select the synthetic club to preview team creation. No changes will be persisted."
          : "Pick where this team belongs. Tap to continue."}
      </p>

      <div className="space-y-2">
        {clubs.map((c: any) => (
          <button
            key={c.id}
            type="button"
            onClick={() => goClub(c.id)}
            disabled={working}
            className="flex items-center gap-3 w-full min-h-[64px] px-4 rounded-2xl bg-[#FAFAFA] dark:bg-card shadow-sm active:scale-[0.98] transition-transform text-left disabled:opacity-50"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shrink-0">
              <Shield className="h-5 w-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-semibold truncate">{c.name}</span>
              <span className="block text-xs text-muted-foreground">Club team</span>
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        ))}

        <button
          type="button"
          onClick={goPersonal}
          disabled={working}
          className="flex items-center gap-3 w-full min-h-[64px] px-4 rounded-2xl bg-[#FAFAFA] dark:bg-card shadow-sm active:scale-[0.98] transition-transform text-left disabled:opacity-50"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground shrink-0">
            {working ? <Loader2 className="h-5 w-5 animate-spin" /> : <User className="h-5 w-5" />}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-semibold truncate">Just me</span>
            <span className="block text-xs text-muted-foreground">Personal team, link a club later</span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </div>
    </div>
  );
}
