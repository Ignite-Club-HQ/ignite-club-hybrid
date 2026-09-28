import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Ticket, CreditCard, MessageSquare, UserCog, FileArchive, BarChart3, Megaphone, Bell, Settings, FileText, Smartphone, Send, Activity, KeyRound, Sparkles, Paperclip, TrendingUp, Image as ImageIcon, Bug, RotateCcw, Globe2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";

import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

const ICP_LAB_ADMIN_LINKS: { to: string; label: string }[] = [
  { to: "/admin/users", label: "Manage users" },
  { to: "/admin/deleted-chats", label: "Deleted chats" },
  { to: "/admin/dm-attachments", label: "DM attachments" },
  { to: "/admin/feedback", label: "Feedback" },
  { to: "/admin/active-games", label: "Active games" },
];

export default function AdminPage() {
  const navigate = useNavigate();
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return (
      <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">Admin</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Synthetic ICP lab administration links. Billing, ads, AI, and native-storage tooling remain out of
          scope for this lab per the environment's architectural boundaries.
        </p>
        <div className="space-y-2">
          {ICP_LAB_ADMIN_LINKS.map((link) => (
            <Card key={link.to} onClick={() => navigate(link.to)} className="cursor-pointer hover:border-primary transition-colors">
              <CardContent className="p-4 flex items-center justify-between">
                <span className="text-sm font-medium">{link.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }
  return <SupabaseAdminPage />;
}

function SupabaseAdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Check if user is app admin
  const { data: isAppAdmin, isLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      if (error) {
        console.error("Error checking app_admin role:", error);
        return false;
      }
      return !!data;
    },
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Check if user is team admin or coach (for player stats access)
  const { data: teamAdminCoachTeamIds = [] } = useQuery({
    queryKey: ["team-admin-coach-team-ids", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("team_id")
        .eq("user_id", user!.id)
        .in("role", ["team_admin", "coach"])
        .not("team_id", "is", null);
      return ((data || []).map((r: any) => r.team_id).filter(Boolean)) as string[];
    },
    enabled: !!user,
  });
  const isTeamAdminOrCoach = teamAdminCoachTeamIds.length > 0;

  // Player Stats Reports is Pro Football only — only show when at least one
  // of the user's team-admin/coach teams belongs to a club with active Pro Football.
  const { data: hasProFootballForAnyTeam = false } = useQuery({
    queryKey: ["has-pro-football-for-team-admin-teams", user?.id, teamAdminCoachTeamIds],
    enabled: !!user && teamAdminCoachTeamIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: teams } = await supabase
        .from("teams")
        .select("club_id")
        .in("id", teamAdminCoachTeamIds);
      const clubIds = Array.from(new Set((teams ?? []).map((t: any) => t.club_id).filter(Boolean)));
      if (clubIds.length === 0) return false;
      const { data: subs } = await supabase
        .from("club_subscriptions")
        .select("is_pro_football, admin_pro_football_override, expires_at")
        .in("club_id", clubIds);
      return (subs ?? []).some(
        (s: any) =>
          (s.is_pro_football || s.admin_pro_football_override) &&
          (!s.expires_at || new Date(s.expires_at) > new Date()),
      );
    },
  });

  // Check if user is club admin (for club-scoped tools like restoring deleted chats)
  const { data: clubAdminClubIds = [] } = useQuery({
    queryKey: ["club-admin-club-ids", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("role", "club_admin")
        .not("club_id", "is", null);
      return (data || []).map((r: any) => r.club_id).filter(Boolean) as string[];
    },
    enabled: !!user,
  });
  const isClubAdmin = clubAdminClubIds.length > 0;
  const primaryClubId = clubAdminClubIds[0];


  if (isLoading) {
    return <PageLoading />;
  }

  if (!isAppAdmin && !isTeamAdminOrCoach && !isClubAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Admin</h1>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-muted-foreground">Access denied. Admin role required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Admin</h1>
          <p className="text-sm text-muted-foreground">Management tools and settings</p>
        </div>
      </div>

      {/* Team Admin Tools — Pro Football only */}
      {isTeamAdminOrCoach && hasProFootballForAnyTeam && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Team Tools</CardTitle>
            <CardDescription>Tools available to team admins and coaches</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <AdminMenuItem
              icon={FileText}
              label="Player Stats Reports"
              description="View player statistics and reports"
              onClick={() => navigate("/reports/player-stats")}
            />
          </CardContent>
        </Card>
      )}

      {/* Club Admin Tools (hidden when user is also app admin — those tools appear under App Administration) */}
      {isClubAdmin && !isAppAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Club Tools</CardTitle>
            <CardDescription>Tools available to club admins</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <AdminMenuItem
              icon={RotateCcw}
              label="Deleted Chats"
              description="Restore chat groups removed from your club"
              onClick={() => navigate("/admin/deleted-chats")}
            />
          </CardContent>
        </Card>
      )}



      {/* App Admin Tools */}
      {isAppAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">App Administration</CardTitle>
            <CardDescription>Global app management tools</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <AdminMenuItem
              icon={Ticket}
              label="Manage Promo Codes"
              description="Create and manage promotional codes"
              onClick={() => navigate("/admin/promo-codes")}
            />
            <AdminMenuItem
              icon={CreditCard}
              label="Stripe Settings"
              description="Configure payment settings"
              onClick={() => navigate("/admin/stripe")}
            />
            <AdminMenuItem
              icon={MessageSquare}
              label="Manage Feedback"
              description="View and respond to user feedback"
              onClick={() => navigate("/admin/feedback")}
            />
            <AdminMenuItem
              icon={UserCog}
              label="User Management"
              description="Manage user accounts and roles"
              onClick={() => navigate("/admin/users")}
            />
            <AdminMenuItem
              icon={KeyRound}
              label="Set Temp Password"
              description="Reset password for a locked-out user"
              onClick={() => navigate("/admin/temp-password")}
            />
            <AdminMenuItem
              icon={FileArchive}
              label="Club Backups"
              description="Backup and restore club data"
              onClick={() => navigate("/admin/backups")}
            />
            <AdminMenuItem
              icon={BarChart3}
              label="Sponsor Analytics"
              description="View sponsor performance metrics"
              onClick={() => navigate("/admin/sponsor-analytics")}
            />
            <AdminMenuItem
              icon={Megaphone}
              label="Manage Ads"
              description="Configure in-app advertisements"
              onClick={() => navigate("/admin/ads")}
            />
            <AdminMenuItem
              icon={Bell}
              label="Notification Preferences"
              description="Global notification settings"
              onClick={() => navigate("/admin/notification-preferences")}
            />
            <AdminMenuItem
              icon={Settings}
              label="App Settings"
              description="Global application settings"
              onClick={() => navigate("/admin/settings")}
            />
            <AdminMenuItem
              icon={Globe2}
              label="Infrastructure / Placement Settings"
              description="Country policies, approved targets, and backend placement rules"
              onClick={() => navigate("/admin/placement-settings")}
            />
            <AdminMenuItem
              icon={Sparkles}
              label="AI Chat Recap Rollout"
              description="Enable AI Chat Recap across Pro clubs (all or selected)"
              onClick={() => navigate("/admin/ai-catch-up")}
            />
            <AdminMenuItem
              icon={Smartphone}
              label="AdMob Settings"
              description="Configure Google AdMob for native apps"
              onClick={() => navigate("/admin/admob")}
            />
            <AdminMenuItem
              icon={Send}
              label="Send Update Reminder"
              description="Notify users to update their native app"
              onClick={() => navigate("/admin/send-update-reminder")}
            />
            <AdminMenuItem
              icon={Paperclip}
              label="DM Attachments"
              description="Disable the + attachment menu in DMs by club or user"
              onClick={() => navigate("/admin/dm-attachments")}
            />
            <AdminMenuItem
              icon={ImageIcon}
              label="Chat Photo Reminders"
              description="Tune the gallery-reminder window and per-author cooldown"
              onClick={() => navigate("/admin/chat-photo-reminders")}
            />
            <AdminMenuItem
              icon={Bug}
              label="Chat Virt Debug"
              description="Capture row-height drift and scroll jolts in any chat thread"
              onClick={() => navigate("/admin/chat-virt-debug")}
            />
            <AdminMenuItem
              icon={RotateCcw}
              label="Deleted Chats"
              description="Restore chat groups removed by members"
              onClick={() => navigate("/admin/deleted-chats")}
            />
            <AdminMenuItem
              icon={Sparkles}
              label="ICP LLM Test"
              description="Test LLM inference via the Internet Computer"
              onClick={() => navigate("/admin/icp-llm-test")}
            />
          </CardContent>
        </Card>
      )}

      {/* Push Analytics - App Admin Only */}
      {isAppAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Analytics</CardTitle>
            <CardDescription>Performance and usage analytics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <AdminMenuItem
              icon={TrendingUp}
              label="Engagement"
              description="DAU, WAU, MAU and activity trends"
              onClick={() => navigate("/admin/engagement")}
            />
            <AdminMenuItem
              icon={Activity}
              label="Online Users"
              description="See who is currently active in the app"
              onClick={() => navigate("/admin/online-users")}
            />
            <AdminMenuItem
              icon={Activity}
              label="Realtime Health"
              description="Live connections vs Supabase plan cap"
              onClick={() => navigate("/admin/realtime-health")}
            />
            <AdminMenuItem
              icon={Activity}
              label="Active Games"
              description="Live coaching boards across every club & team"
              onClick={() => navigate("/admin/active-games")}
            />
            <AdminMenuItem
              icon={Bell}
              label="Push Analytics"
              description="Push notification delivery metrics"
              onClick={() => navigate("/admin/push-analytics")}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AdminMenuItem({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted cursor-pointer transition-colors"
      onClick={onClick}
    >
      <div className="p-2 rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
    </div>
  );
}
