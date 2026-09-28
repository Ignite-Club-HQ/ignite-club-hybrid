import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

interface ContactClubButtonProps {
  /** Optional: limit to a specific club. If omitted, shows all Pro clubs the user belongs to. */
  clubFilter?: string | null;
  /** Compact mode for embedding in smaller spaces */
  compact?: boolean;
}

export function ContactClubButton({ clubFilter, compact = false }: ContactClubButtonProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isContacting, setIsContacting] = useState<string | null>(null);

  // Fetch Pro clubs the user is a member of, along with the club admin
  const { data: contactableClubs } = useQuery({
    queryKey: ["contactable-clubs", user?.id, clubFilter],
    queryFn: async () => {
      // Get user's club memberships
      const { data: roles } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);

      if (!roles?.length) return [];

      // Collect all club IDs (direct + via teams)
      const directClubIds = roles.filter(r => r.club_id).map(r => r.club_id!);
      const teamIds = roles.filter(r => r.team_id).map(r => r.team_id!);

      let teamClubIds: string[] = [];
      if (teamIds.length > 0) {
        const { data: teams } = await supabase
          .from("teams")
          .select("club_id")
          .in("id", teamIds);
        teamClubIds = (teams || []).map(t => t.club_id).filter(Boolean);
      }

      const allClubIds = [...new Set([...directClubIds, ...teamClubIds])];
      if (allClubIds.length === 0) return [];

      // Apply club filter if provided
      const filteredIds = clubFilter ? allClubIds.filter(id => id === clubFilter) : allClubIds;
      if (filteredIds.length === 0) return [];

      // Check which clubs are Pro
      const { data: subscriptions } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
        .in("club_id", filteredIds);

      const proClubIds = (subscriptions || [])
        .filter(s => 
          (s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override) &&
          (!s.expires_at || new Date(s.expires_at) > new Date())
        )
        .map(s => s.club_id);

      if (proClubIds.length === 0) return [];

      // Fetch club info
      const { data: clubs } = await supabase
        .from("clubs")
        .select("id, name, logo_url")
        .in("id", proClubIds);

      if (!clubs?.length) return [];

      // Check if user is a club_admin for any of these clubs - if so, exclude those
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .eq("role", "club_admin")
        .in("club_id", proClubIds);

      const adminClubIds = new Set((adminRoles || []).map(r => r.club_id));

      // Also check via team membership for club_admin roles
      // Filter out clubs where user is a club_admin (no need to contact yourself)
      return clubs.filter(c => !adminClubIds.has(c.id));
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const handleContactClub = async (clubId: string) => {
    if (isContacting) return;
    setIsContacting(clubId);

    try {
      const { data: conversationId, error } = await supabase
        .rpc("get_or_create_club_admin_conversation", { p_club_id: clubId });

      if (error) throw error;

      navigate(`/messages/club-admin/${conversationId}`);
    } catch (err: any) {
      toast({
        title: "Unable to contact club",
        description: err.message || "Please try again later",
        variant: "destructive",
      });
    } finally {
      setIsContacting(null);
    }
  };

  if (!contactableClubs?.length) return null;

  return (
    <>
      {contactableClubs.map(club => (
        <button
          key={`contact-${club.id}`}
          onClick={() => handleContactClub(club.id)}
          disabled={isContacting === club.id}
          className="w-full text-left"
        >
          <Card className="hover:border-primary/50 transition-colors border-primary/20 bg-primary/5">
            <CardContent className={`flex items-center gap-3 ${compact ? 'p-3' : 'p-4'}`}>
              <div className="relative">
                <Avatar className={compact ? "h-9 w-9" : "h-10 w-10"}>
                  <AvatarImage src={club.logo_url || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary">
                    {club.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center border-2 border-background">
                  <MessageSquare className="h-2.5 w-2.5 text-primary-foreground" />
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`truncate font-semibold ${compact ? 'text-sm' : ''}`}>
                  Contact {club.name}
                </h3>
                <p className={`text-muted-foreground ${compact ? 'text-xs' : 'text-sm'}`}>
                  {isContacting === club.id ? "Opening conversation..." : "Message the club admin directly"}
                </p>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        </button>
      ))}
    </>
  );
}
