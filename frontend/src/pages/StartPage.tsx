import { Link, Navigate } from "react-router-dom";
import { Users, Building2, Trophy, ChevronRight, Network } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useClubTheme } from "@/hooks/useClubTheme";


interface Option {
  to: string | null;
  icon: typeof Users;
  title: string;
  subtitle: string;
  description: string;
  comingSoon?: boolean;
}

const options: Option[] = [
  {
    to: "/teams/new",
    icon: Users,
    title: "Start a Team",
    subtitle: "Social, twilight, or one-off team",
    description:
      "Quickest path. Run a single team with chat, schedule, RSVPs and the game board. You can attach a club later.",
  },
  {
    to: "/clubs/new",
    icon: Building2,
    title: "Start a Club",
    subtitle: "Multiple teams under one roof",
    description:
      "For real clubs with several teams, committee admins, branding, sponsorships and a club-wide chat.",
  },
  {
    to: "/competitions/new",
    icon: Trophy,
    title: "Start a Competition",
    subtitle: "League, twilight comp, tournament",
    description:
      "Invite teams from any club into divisions and manage league admins. You must be a club admin to organise one.",
  },
  {
    to: "/associations/new",
    icon: Network,
    title: "Start an Association",
    subtitle: "Federation or umbrella body for multiple clubs",
    description:
      "Group several clubs under one association for rollup views, top-down broadcasts and association-wide competitions.",
  },
];

export default function StartPage() {
  usePageTitle("Get started");
  const { activeClubFilter } = useClubTheme();

  // /start is the entry point for the club setup flow. Auto-select
  // "Start a Club" and jump straight to the club creation form so the user
  // can complete club details immediately. When operating inside an existing
  // club (theme filter active), fall back to the chooser instead.
  if (!activeClubFilter) {
    return <Navigate to="/clubs/new" replace />;
  }

  // When filtered to a single club (club theme mode), hide "Start a Club" to
  // avoid encouraging duplicates while operating inside an existing club.
  const visibleOptions = activeClubFilter
    ? options.filter((o) => o.to !== "/clubs/new")
    : options;

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">What are you setting up?</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pick the option that best matches what you're running. You can always
          add more later.
        </p>
      </header>

      <div className="space-y-3">
        {visibleOptions.map(({ to, icon: Icon, title, subtitle, description, comingSoon }) => {

          const content = (
            <Card
              className={
                comingSoon
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:border-primary transition-colors cursor-pointer"
              }
            >
              <CardContent className="p-4 flex items-start gap-4">
                <div className="rounded-xl bg-primary/10 p-3 shrink-0">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-semibold">{title}</h2>
                    {comingSoon && (
                      <Badge variant="secondary" className="text-xs">
                        Coming soon
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
                  <p className="text-sm mt-2">{description}</p>
                </div>
                {!comingSoon && (
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
                )}
              </CardContent>
            </Card>
          );

          if (!to) {
            return <div key={title}>{content}</div>;
          }
          return (
            <Link key={title} to={to} className="block">
              {content}
            </Link>
          );
        })}
      </div>

      <div className="mt-8 text-center">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">Cancel</Link>
        </Button>
      </div>
    </div>
  );
}
