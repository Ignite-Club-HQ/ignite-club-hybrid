import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Users, Calendar, ChevronRight, Loader2, Trophy, ArrowLeft, Crown, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Drawer, 
  DrawerContent, 
  DrawerHeader, 
  DrawerTitle, 
  DrawerDescription,
  DrawerFooter,
  DrawerClose
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabMiniLeagues } from "@/lab/fixtureDataLayer";

interface MiniLeague {
  id: string;
  name: string;
  description: string | null;
  team_size: number;
  club_id: string;
  created_at: string;
  club: {
    id: string;
    name: string;
  };
  _count?: {
    players: number;
    sessions: number;
  };
}

export default function MiniLeaguesPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  if (useIcpLab) {
    return <IcpLabMiniLeaguesPage />;
  }
  return <SupabaseMiniLeaguesPage />;
}

/** Read-only synthetic mini-league list; creation and administration remain unavailable until competition_domain admin tooling is wired here. */
function IcpLabMiniLeaguesPage() {
  const navigate = useNavigate();
  const leagues = getLocalLabMiniLeagues("club-icp-001");

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Mini Leagues</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing synthetic ICP lab mini leagues. Creating and managing leagues is disabled.
      </p>
      <div className="space-y-2">
        {leagues.map((league) => (
          <Card key={league.id} onClick={() => navigate(`/mini-leagues/${league.id}`)} className="cursor-pointer hover:border-primary transition-colors">
            <CardContent className="p-4 flex items-center justify-between">
              <span className="text-sm font-medium">{league.name}</span>
              <span className="text-xs text-muted-foreground">{league.team_count} teams</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SupabaseMiniLeaguesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const clubIdFromUrl = searchParams.get("clubId");
  
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newLeague, setNewLeague] = useState({ name: "", description: "", team_size: "5", club_id: "" });
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch clubs where user is admin AND has Pro Football access
  const { data: adminClubs, isLoading: clubsLoading } = useQuery({
    queryKey: ["admin-pro-football-clubs", user?.id],
    queryFn: async () => {
      // First get clubs where user is admin
      const { data: rolesData, error: rolesError } = await supabase
        .from("user_roles")
        .select("club_id, clubs!inner(id, name)")
        .eq("user_id", user!.id)
        .in("role", ["club_admin", "league_admin", "coach", "app_admin"])
        .not("club_id", "is", null);
      
      if (rolesError) throw rolesError;
      
      // Dedupe by club_id
      const uniqueClubs = new Map();
      rolesData?.forEach((r: any) => {
        if (r.clubs && !uniqueClubs.has(r.clubs.id)) {
          uniqueClubs.set(r.clubs.id, r.clubs);
        }
      });
      const clubs = Array.from(uniqueClubs.values()) as { id: string; name: string }[];
      
      if (clubs.length === 0) return [];
      
      // Check which clubs have Pro Football access
      const { data: subscriptions, error: subError } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro_football, admin_pro_football_override, expires_at")
        .in("club_id", clubs.map(c => c.id));
      
      if (subError) throw subError;
      
      // Filter to only Pro Football clubs
      const proFootballClubIds = new Set(
        subscriptions?.filter(s => 
          (s.is_pro_football || s.admin_pro_football_override) && 
          (!s.expires_at || new Date(s.expires_at) > new Date())
        ).map(s => s.club_id) || []
      );
      
      return clubs.filter(c => proFootballClubIds.has(c.id));
    },
    enabled: !!user,
  });

  // Auto-select club if only one available or from URL
  useEffect(() => {
    if (adminClubs?.length === 1 && !newLeague.club_id) {
      setNewLeague(prev => ({ ...prev, club_id: adminClubs[0].id }));
    } else if (clubIdFromUrl && adminClubs?.some(c => c.id === clubIdFromUrl)) {
      setNewLeague(prev => ({ ...prev, club_id: clubIdFromUrl }));
    }
  }, [adminClubs, clubIdFromUrl, newLeague.club_id]);

  // Fetch mini leagues the user has access to (admin or has a player assigned)
  const { data: miniLeagues, isLoading } = useQuery({
    queryKey: ["mini-leagues", clubIdFromUrl, user?.id],
    queryFn: async () => {
      // First, get league IDs where user is a parent (has a player)
      const { data: playerLeagues } = await supabase
        .from("mini_league_players")
        .select("mini_league_id")
        .eq("parent_user_id", user!.id);
      
      const parentLeagueIds = playerLeagues?.map(p => p.mini_league_id) || [];
      
      // Get admin club IDs (clubs where user is club_admin, league_admin, or app_admin)
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("club_id")
        .eq("user_id", user!.id)
        .in("role", ["league_admin", "app_admin"])
        .not("club_id", "is", null);
      
      const adminClubIds = adminRoles?.map(r => r.club_id) as string[] || [];
      
      // Get leagues where user is admin
      let adminLeagueIds: string[] = [];
      if (adminClubIds.length > 0) {
        const { data: adminLeagues } = await supabase
          .from("mini_leagues")
          .select("id")
          .in("club_id", adminClubIds);
        adminLeagueIds = adminLeagues?.map(l => l.id) || [];
      }
      
      // Combine both sets of league IDs
      const allAccessibleLeagueIds = [...new Set([...parentLeagueIds, ...adminLeagueIds])];
      
      if (allAccessibleLeagueIds.length === 0) {
        return [] as MiniLeague[];
      }
      
      // Fetch the actual league data
      let query = supabase
        .from("mini_leagues")
        .select(`*, club:clubs!club_id(id, name)`)
        .in("id", allAccessibleLeagueIds)
        .order("created_at", { ascending: false });
      
      if (clubIdFromUrl) {
        query = query.eq("club_id", clubIdFromUrl);
      }
      
      const { data, error } = await query;
      if (error) throw error;

      // Get counts for each league
      const leaguesWithCounts = await Promise.all(
        (data || []).map(async (league) => {
          const [playersResult, sessionsResult] = await Promise.all([
            supabase.from("mini_league_players").select("id", { count: "exact", head: true }).eq("mini_league_id", league.id),
            supabase.from("events").select("id", { count: "exact", head: true }).eq("mini_league_id", league.id),
          ]);
          return {
            ...league,
            _count: {
              players: playersResult.count || 0,
              sessions: sessionsResult.count || 0,
            },
          };
        })
      );

      return leaguesWithCounts as MiniLeague[];
    },
    enabled: !!user,
  });

  // Get current club name for display
  const currentClub = clubIdFromUrl 
    ? adminClubs?.find(c => c.id === clubIdFromUrl) || miniLeagues?.[0]?.club
    : null;

  // Create mini league mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof newLeague) => {
      const { error } = await supabase.from("mini_leagues").insert({
        name: data.name,
        description: data.description || null,
        team_size: parseInt(data.team_size),
        club_id: data.club_id,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-leagues"] });
      setIsCreateOpen(false);
      setNewLeague(prev => ({ name: "", description: "", team_size: "5", club_id: prev.club_id }));
      toast.success("Mini League created!");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleCreate = () => {
    if (!newLeague.name.trim()) {
      toast.error("Please enter a league name");
      return;
    }
    if (!newLeague.club_id) {
      toast.error("Please select a club");
      return;
    }
    createMutation.mutate(newLeague);
  };

  const canCreate = (adminClubs?.length || 0) > 0;
  const showClubSelector = (adminClubs?.length || 0) > 1 && !clubIdFromUrl;
  const selectedClubName = adminClubs?.find(c => c.id === newLeague.club_id)?.name;

  return (
    <div className="container max-w-2xl px-4 py-6 space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {clubIdFromUrl && (
              <Button 
                variant="ghost" 
                size="icon"
                className="shrink-0 -ml-2"
                onClick={() => navigate(`/clubs/${clubIdFromUrl}`)}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight">Mini Leagues</h1>
              {currentClub && (
                <p className="text-sm text-muted-foreground truncate">{currentClub.name}</p>
              )}
            </div>
          </div>
          {canCreate && (
            <Button onClick={() => setIsCreateOpen(true)} size="sm" className="shrink-0">
              <Plus className="h-4 w-4 mr-1.5" />
              <span className="hidden sm:inline">New League</span>
              <span className="sm:hidden">New</span>
            </Button>
          )}
        </div>
      </div>

      {/* Search */}
      {(miniLeagues?.length || 0) > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leagues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
      )}

      {/* Content */}
      {isLoading || clubsLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : !canCreate && miniLeagues?.length === 0 ? (
        // No Pro Football access
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Crown className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-1">Pro Football Required</h3>
          <p className="text-muted-foreground text-sm max-w-xs mb-6">
            Mini Leagues is a Pro Football feature. Contact your club administrator to upgrade.
          </p>
        </div>
      ) : miniLeagues?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Trophy className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No Mini Leagues Yet</h3>
          <p className="text-muted-foreground text-sm max-w-xs mb-6">
            Create your first mini league to start grouping players by ability
          </p>
          {canCreate && (
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Mini League
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {miniLeagues?.filter(l => 
            !searchQuery.trim() || 
            l.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
            l.club?.name?.toLowerCase().includes(searchQuery.trim().toLowerCase())
          ).map((league) => (
            <Card
              key={league.id}
              className="cursor-pointer hover:bg-muted/50 transition-colors active:scale-[0.99]"
              onClick={() => navigate(`/mini-leagues/${league.id}`)}
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Trophy className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{league.name}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {league._count?.players || 0}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {league._count?.sessions || 0}
                      </span>
                      {!clubIdFromUrl && league.club?.name && (
                        <Badge variant="outline" className="text-xs font-normal">
                          {league.club.name}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create League Drawer (mobile-friendly) */}
      <Drawer open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Create Mini League</DrawerTitle>
            <DrawerDescription>
              {selectedClubName 
                ? `Creating league for ${selectedClubName}`
                : "Set up a new mini league with ability-based grouping"
              }
            </DrawerDescription>
          </DrawerHeader>
          
          <div className="px-4 space-y-4 overflow-y-auto">
            {/* Only show club selector if multiple clubs and no club context */}
            {showClubSelector && (
              <div className="space-y-2">
                <Label>Club</Label>
                <Select value={newLeague.club_id} onValueChange={(v) => setNewLeague({ ...newLeague, club_id: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select club" />
                  </SelectTrigger>
                  <SelectContent>
                    {adminClubs?.map((club) => (
                      <SelectItem key={club.id} value={club.id}>
                        {club.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="name">League Name</Label>
              <Input
                id="name"
                placeholder="e.g. Saturday Morning League"
                value={newLeague.name}
                onChange={(e) => setNewLeague({ ...newLeague, name: e.target.value })}
                autoFocus={false}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="description">Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                id="description"
                placeholder="Brief description of this league..."
                value={newLeague.description}
                onChange={(e) => setNewLeague({ ...newLeague, description: e.target.value })}
                rows={2}
              />
            </div>
            
            <div className="space-y-2">
              <Label>Players per Side</Label>
              <div className="grid grid-cols-4 gap-2">
                {["4", "5", "6", "7"].map((size) => (
                  <Button
                    key={size}
                    type="button"
                    variant={newLeague.team_size === size ? "default" : "outline"}
                    className="h-12 text-base font-medium"
                    onClick={() => setNewLeague({ ...newLeague, team_size: size })}
                  >
                    {size}v{size}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Can be overridden per session</p>
            </div>
          </div>
          
          <DrawerFooter className="pt-4">
            <Button onClick={handleCreate} disabled={createMutation.isPending} className="w-full">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create League
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
