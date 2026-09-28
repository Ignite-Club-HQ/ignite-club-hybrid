import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Crown, ChevronRight, Filter, Search, X, Info, RotateCcw, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import * as fixtureData from "@/lab/fixtureDataLayer";
import { PageLoading } from "@/components/ui/page-loading";
import { getSportEmoji, SPORT_EMOJIS } from "@/lib/sportEmojis";
import { useSponsorAnalytics } from "@/hooks/useSponsorAnalytics";
import { useClubTheme } from "@/hooks/useClubTheme";
import { ConfirmPurgeDialog } from "@/components/club/ConfirmPurgeDialog";
import { clearClubSetupLocalState } from "@/lib/clubSetupLocalState";
import { membershipKeys } from "@/lab/membershipQueryKeys";

interface Club {
  id: string;
  name: string;
  logo_url: string | null;
  description: string | null;
  sport: string | null;
  is_pro: boolean;
  created_by: string | null;
  primary_sponsor_id: string | null;
}

interface ClubSubscription {
  club_id: string;
  is_pro: boolean;
  is_pro_football: boolean;
  admin_pro_override: boolean;
  admin_pro_football_override: boolean;
}

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  club_id: string;
}

export default function ClubsPage() {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const location = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fromCreateTeam = (location.state as { fromCreateTeam?: boolean })?.fromCreateTeam === true;
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<{ id: string; name: string } | null>(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");
  const [purging, setPurging] = useState(false);

  // Recently removed clubs (soft-deleted by this user, within 30 days, not permanently hidden)
  const { data: removedClubs } = useQuery({
    queryKey: ["removed-clubs", user?.id],
    queryFn: async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, logo_url, sport, deleted_at, created_by")
        .eq("deleted_by", user!.id)
        .not("deleted_at", "is", null)
        .is("purged_at", null)
        .gte("deleted_at", thirtyDaysAgo)
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; name: string; logo_url: string | null; sport: string | null; deleted_at: string; created_by: string | null }[];
    },
    enabled: !!user,
  });

  const handleRestore = async (clubId: string) => {
    setRestoringId(clubId);
    const { error } = await supabase
      .from("clubs")
      .update({ deleted_at: null, deleted_by: null } as any)
      .eq("id", clubId);
    setRestoringId(null);
    if (error) {
      toast({ title: "Error", description: "Failed to restore club.", variant: "destructive" });
      return;
    }
    toast({ title: "Club restored", description: "Teams and chats have been restored too." });
    queryClient.invalidateQueries({ queryKey: ["removed-clubs", user?.id] });
    queryClient.invalidateQueries({ queryKey: ["clubs"] });
    queryClient.invalidateQueries({ queryKey: membershipKeys.userRolesFor(user?.id) });
  };

  const handleHardDelete = async () => {
    if (!purgeTarget || purgeConfirmText.trim() !== purgeTarget.name) return;
    setPurging(true);
    const { error } = await supabase.rpc("hard_delete_club" as any, { _club_id: purgeTarget.id });
    setPurging(false);
    if (error) {
      toast({ title: "Couldn't delete", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Club permanently deleted", description: "Data is retained in the archive for recovery by an app admin." });
    clearClubSetupLocalState(purgeTarget.id);
    setPurgeTarget(null);
    setPurgeConfirmText("");
    queryClient.invalidateQueries({ queryKey: ["removed-clubs", user?.id] });
  };


  const { data: clubs, isLoading } = useQuery({
    queryKey: ["clubs"],
    queryFn: async () => {
      if (useIcpLab) {
        return fixtureData.getLocalLabClubList() as Club[];
      }

      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, logo_url, description, sport, is_pro, created_by, primary_sponsor_id")
        .is("deleted_at", null)
        .eq("kind", "full")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Club[];
    },
    enabled: !!user,
  });

  // Fetch active sponsors for all clubs
  const { data: sponsors } = useQuery({
    queryKey: ["club-sponsors-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, website_url, club_id")
        .eq("is_active", true);
      if (error) throw error;
      return data as Sponsor[];
    },
    enabled: !!user,
  });

  // Fetch club subscriptions to get accurate Pro status
  const { data: clubSubscriptions } = useQuery({
    queryKey: ["club-subscriptions-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_subscriptions")
        .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override");
      if (error) throw error;
      return data as ClubSubscription[];
    },
    enabled: !!user,
  });

  const { data: userRoles } = useQuery({
    queryKey: membershipKeys.userRolesFor(user?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user!.id);

      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Get unique sports from clubs for filter options
  const availableSports = useMemo(() => {
    if (!clubs) return [];
    const sports = new Set(clubs.map(c => c.sport).filter(Boolean) as string[]);
    return Array.from(sports).sort();
  }, [clubs]);

  // Filter clubs by sport only (for My Clubs)
  const filterBySport = (clubList: Club[] | undefined) => {
    if (!clubList) return clubList;
    
    if (sportFilter === "all") return clubList;
    
    return clubList.filter(club => {
      if (!club.sport) return false;
      const lowerSport = club.sport.toLowerCase();
      const lowerFilter = sportFilter.toLowerCase();
      return lowerSport.includes(lowerFilter) || lowerFilter.includes(lowerSport);
    });
  };

  // Filter clubs by sport and search query (for search results)
  const filterBySearch = (clubList: Club[] | undefined) => {
    if (!clubList) return clubList;
    
    let filtered = clubList;
    
    // Filter by sport
    if (sportFilter !== "all") {
      filtered = filtered.filter(club => {
        if (!club.sport) return false;
        const lowerSport = club.sport.toLowerCase();
        const lowerFilter = sportFilter.toLowerCase();
        return lowerSport.includes(lowerFilter) || lowerFilter.includes(lowerSport);
      });
    }
    
    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(club => 
        club.name.toLowerCase().includes(query) ||
        club.description?.toLowerCase().includes(query) ||
        club.sport?.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  };

  // My Clubs - filter by sport and active club theme
  const myClubs = filterBySport(
    clubs?.filter((club) => {
      const isMember = userRoles?.some((role) => role.club_id === club.id);
      if (!isMember) return false;
      // If a club theme is active, only show that club
      if (activeClubFilter) return club.id === activeClubFilter;
      return true;
    })
  );

  // Recently removed: respect the active club filter so other clubs don't leak in
  const scopedRemovedClubs = (removedClubs ?? []).filter((club) =>
    activeClubFilter ? club.id === activeClubFilter : true
  );



  // Only show search results (other clubs) when user is actively searching
  const isSearching = searchQuery.trim().length > 0;
  const searchResults = isSearching 
    ? filterBySearch(clubs?.filter((club) => !userRoles?.some((role) => role.club_id === club.id)))
    : [];

  if (isLoading) {
    return <PageLoading message="Loading clubs..." />;
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clubs</h1>
        {!activeClubFilter && (
          <Link to="/clubs/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> Create
            </Button>
          </Link>
        )}
      </div>

      {/* Create Team Tip */}
      {fromCreateTeam && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            To create a team, first select an existing club or create a new club. Teams belong to clubs.
          </AlertDescription>
        </Alert>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search clubs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 pr-9"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => setSearchQuery("")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Sport Filter */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Select value={sportFilter} onValueChange={setSportFilter}>
          <SelectTrigger className="w-[180px] h-10">
            <SelectValue placeholder="Filter by sport" />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="all">
              <span className="flex items-center gap-2">
                <span>🏆</span> All Sports
              </span>
            </SelectItem>
            {Object.entries(SPORT_EMOJIS).map(([sport, emoji]) => (
              <SelectItem key={sport} value={sport}>
                <span className="flex items-center gap-2">
                  <span>{emoji}</span> {sport}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {sportFilter !== "all" && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setSportFilter("all")}
            className="text-muted-foreground"
          >
            Clear
          </Button>
        )}
      </div>

      {/* My Clubs */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">My Clubs</h2>
        {myClubs?.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center">
              <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">You haven't joined any clubs yet</p>
              {!activeClubFilter && (
                <Link to="/clubs/new" className="mt-3 inline-block">
                  <Button variant="outline" size="sm">Create Your First Club</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {myClubs?.map((club) => (
              <ClubCard 
                key={club.id} 
                club={club} 
                subscription={clubSubscriptions?.find(s => s.club_id === club.id)}
                sponsors={sponsors?.filter(s => s.club_id === club.id) || []}
                isMember 
              />
            ))}
            {!activeClubFilter && (
              <Link to="/clubs/new">
                <Card className="border-dashed hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex items-center justify-center gap-2 text-muted-foreground">
                    <Plus className="h-5 w-5" />
                    <span>Create New Club</span>
                  </CardContent>
                </Card>
              </Link>
            )}
          </div>
        )}
      </section>

      {/* Recently removed - clubs the user soft-deleted, restorable within 30 days */}
      {scopedRemovedClubs.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
              Recently removed
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Restore within 30 days. Restoring also brings back the club's teams and chats.
            </p>
          </div>
          <div className="space-y-2">
            {scopedRemovedClubs.map((club) => {
              const daysLeft = Math.max(
                0,
                30 - Math.floor((Date.now() - new Date(club.deleted_at).getTime()) / (1000 * 60 * 60 * 24))
              );
              return (
                <Card key={club.id} className="border-dashed">
                  <CardContent className="p-3 flex items-center gap-3">
                    <Avatar className="h-10 w-10 opacity-60">
                      <AvatarImage src={club.logo_url || undefined} />
                      <AvatarFallback className="bg-muted text-muted-foreground">
                        {club.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{club.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Removed {new Date(club.deleted_at).toLocaleDateString()} · {daysLeft} day{daysLeft === 1 ? "" : "s"} left
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restoringId === club.id}
                      onClick={() => handleRestore(club.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                      {restoringId === club.id ? "Restoring..." : "Restore"}
                    </Button>
                    {club.created_by === user?.id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { setPurgeTarget({ id: club.id, name: club.name }); setPurgeConfirmText(""); }}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        Delete permanently
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <ConfirmPurgeDialog
        target={purgeTarget}
        confirmText={purgeConfirmText}
        onConfirmTextChange={setPurgeConfirmText}
        purging={purging}
        onCancel={() => { setPurgeTarget(null); setPurgeConfirmText(""); }}
        onConfirm={handleHardDelete}
      />




      {/* Search Results - Only show when searching */}
      {isSearching && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Search Results</h2>
          {searchResults && searchResults.length > 0 ? (
            <div className="space-y-3">
              {searchResults.map((club) => (
                <ClubCard 
                  key={club.id} 
                  club={club}
                  subscription={clubSubscriptions?.find(s => s.club_id === club.id)}
                  sponsors={sponsors?.filter(s => s.club_id === club.id) || []}
                />
              ))}
            </div>
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-6 text-center">
                <Search className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No clubs found matching your search</p>
              </CardContent>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function ClubCard({ club, subscription, sponsors = [], isMember = false }: { 
  club: Club; 
  subscription?: ClubSubscription;
  sponsors?: Sponsor[];
  isMember?: boolean;
}) {
  const { trackView, trackClick } = useSponsorAnalytics();
  const hasPro = subscription?.is_pro || subscription?.admin_pro_override;
  const hasProFootball = subscription?.is_pro_football || subscription?.admin_pro_football_override;
  const hasAnyPro = hasPro || hasProFootball;
  
  // Only show primary sponsor
  const primarySponsor = sponsors.find(s => s.id === club.primary_sponsor_id && s.logo_url);
  
  // Track sponsor view when displayed
  useEffect(() => {
    if (primarySponsor?.id) {
      trackView(primarySponsor.id, "club_card");
    }
  }, [primarySponsor?.id, trackView]);

  const handleSponsorClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (primarySponsor?.id) {
      trackClick(primarySponsor.id, "club_card");
    }
  };
  
  return (
    <Link to={`/clubs/${club.id}`}>
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="p-4 flex items-center gap-4">
          <Avatar className="h-12 w-12">
            <AvatarImage src={club.logo_url || undefined} />
            <AvatarFallback className="bg-primary/20 text-primary">
              {club.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold truncate">{club.name}</h3>
              {hasProFootball && (
                <Badge className="bg-emerald-500 text-emerald-950 text-xs shrink-0">
                  <Crown className="h-3 w-3 mr-1" /> Pro Football
                </Badge>
              )}
              {hasPro && !hasProFootball && (
                <Badge className="bg-yellow-500 text-yellow-950 text-xs shrink-0">
                  <Crown className="h-3 w-3 mr-1" /> Pro
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm">{getSportEmoji(club.sport)}</span>
              {/* Primary sponsor logo */}
              {primarySponsor && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Sponsored by</span>
                  {primarySponsor.website_url ? (
                    <button
                      onClick={(e) => { handleSponsorClick(e); import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(primarySponsor.website_url!)); }}
                      className="hover:opacity-80 transition-opacity"
                    >
                      <img
                        src={primarySponsor.logo_url!}
                        alt={primarySponsor.name}
                        className="h-10 w-auto max-w-[100px] object-contain rounded-sm"
                        title={primarySponsor.name}
                      />
                    </button>
                  ) : (
                    <img
                      src={primarySponsor.logo_url!}
                      alt={primarySponsor.name}
                      className="h-10 w-auto max-w-[100px] object-contain rounded-sm"
                      title={primarySponsor.name}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </Link>
  );
}
