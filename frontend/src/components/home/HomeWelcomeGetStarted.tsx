import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  Building2,
  Trophy,
  Network,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Mail,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";




interface SecondaryOption {
  to: string;
  icon: typeof Users;
  title: string;
  subtitle: string;
}

const MORE_OPTIONS: SecondaryOption[] = [
  {
    to: "/teams/new",
    icon: Users,
    title: "Start a Team",
    subtitle: "One team — chat, schedule and RSVPs.",
  },
  {
    to: "/competitions/new",
    icon: Trophy,
    title: "Start a Competition",
    subtitle: "League, twilight comp or tournament.",
  },
  {
    to: "/associations/new",
    icon: Network,
    title: "Start an Association",
    subtitle: "Umbrella body for several clubs.",
  },
];

/**
 * Empty-state welcome for signed-in users who have no clubs and no teams yet.
 * Emphasises joining an existing club — creation flows are secondary.
 */
export function HomeWelcomeGetStarted({
  firstName,
  email,
  onFindOrJoin,
}: {
  firstName: string;
  email?: string | null;
  onFindOrJoin: () => void;
}) {
  const { data: pendingInvites = [] } = useQuery({
    queryKey: ["home-welcome-pending-invites", email],
    enabled: !!email,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, club_id, team_id, invite_token, role, clubs:club_id(name), teams:team_id(name)")
        .eq("invited_email", email!.toLowerCase())
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) return [];
      return (data || []) as any[];
    },
  });

  const primaryInvite = pendingInvites[0];
  const inviteTarget =
    primaryInvite?.clubs?.name || primaryInvite?.teams?.name || "your club";
  const inviteHref = primaryInvite?.invite_token
    ? `/join/${primaryInvite.invite_token}`
    : primaryInvite?.club_id
    ? `/clubs/${primaryInvite.club_id}`
    : "/notifications";

  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      {/* Primary card: Find or Join a Club (or invitation-specific) */}
      {primaryInvite ? (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Mail className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight">
                  You've been invited to {inviteTarget}
                </h2>
                <p className="text-sm text-muted-foreground leading-tight">
                  Hi {firstName} — accept your invite to get started.
                </p>
              </div>
            </div>

            <Button asChild className="w-full h-12 text-base font-semibold shadow-lg">
              <Link to={inviteHref}>Join {inviteTarget}</Link>
            </Button>

            <button
              type="button"
              onClick={() => onFindOrJoin()}
              className="w-full text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Looking for a different club?
            </button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight">
                  Let's connect you with your club, {firstName}
                </h2>
                <p className="text-sm text-muted-foreground leading-tight mt-0.5">
                  Search for your club, accept an invitation or enter an invite code.
                </p>
              </div>
            </div>

            <Button
              onClick={() => onFindOrJoin()}
              className="w-full h-12 text-base font-semibold shadow-lg"
            >
              <Search className="h-5 w-5 mr-2" />
              Find or Join a Club
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Secondary: Start a Club (admins) */}
      <Card className="border-border/60">
        <CardContent className="p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">Setting up Ignite for your organisation?</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              For club administrators setting up a new club.
            </p>
          </div>
          <Button asChild variant="outline" className="w-full h-11">
            <Link to="/clubs/new" className="inline-flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Start a Club
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Collapsed: More setup options */}
      <div className="px-1">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={moreOpen}
        >
          More setup options
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`}
          />
        </button>

        {moreOpen && (
          <div className="mt-3 space-y-2">
            {MORE_OPTIONS.map(({ to, icon: Icon, title, subtitle }) => (
              <Link
                key={to}
                to={to}
                className="flex items-start gap-3 p-3 rounded-xl bg-card hover:bg-accent/40 active:scale-[0.99] transition-all border border-border/60"
              >
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight text-foreground/90">{title}</p>
                  <p className="text-xs text-muted-foreground leading-snug mt-0.5">
                    {subtitle}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              </Link>
            ))}
          </div>
        )}
      </div>

    </>
  );
}

