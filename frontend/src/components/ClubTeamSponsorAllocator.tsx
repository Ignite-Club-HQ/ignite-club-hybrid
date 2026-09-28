import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
}

interface Team {
  id: string;
  name: string;
}

interface ClubTeamSponsorAllocatorProps {
  clubId: string;
}

export function ClubTeamSponsorAllocator({ clubId }: ClubTeamSponsorAllocatorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all active sponsors for the club
  const { data: sponsors = [], isLoading: loadingSponsors } = useQuery({
    queryKey: ["sponsors", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      return data as Sponsor[];
    },
  });

  // Fetch all teams for the club
  const { data: teams = [], isLoading: loadingTeams } = useQuery({
    queryKey: ["club-teams", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name")
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      
      if (error) throw error;
      return data as Team[];
    },
  });

  // Fetch all allocations for teams in this club
  const { data: allocations = [], isLoading: loadingAllocations } = useQuery({
    queryKey: ["club-team-sponsor-allocations", clubId],
    queryFn: async () => {
      const teamIds = teams.map(t => t.id);
      if (teamIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from("team_sponsor_allocations")
        .select("team_id, sponsor_id")
        .in("team_id", teamIds);
      
      if (error) throw error;
      return data;
    },
    enabled: teams.length > 0,
  });

  const toggleAllocationMutation = useMutation({
    mutationFn: async ({ teamId, sponsorId, allocated }: { teamId: string; sponsorId: string; allocated: boolean }) => {
      if (allocated) {
        const { error } = await supabase
          .from("team_sponsor_allocations")
          .insert({ team_id: teamId, sponsor_id: sponsorId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("team_sponsor_allocations")
          .delete()
          .eq("team_id", teamId)
          .eq("sponsor_id", sponsorId);
        if (error) throw error;
        
        // If this was the active sponsor, clear it
        const { data: team } = await supabase
          .from("teams")
          .select("sponsor_id")
          .eq("id", teamId)
          .single();
        
        if (team?.sponsor_id === sponsorId) {
          await supabase
            .from("teams")
            .update({ sponsor_id: null })
            .eq("id", teamId);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-team-sponsor-allocations", clubId] });
      queryClient.invalidateQueries({ queryKey: ["team-sponsor-allocations"] });
      toast({ title: "Sponsor allocation updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to update allocation", description: error.message, variant: "destructive" });
    },
  });

  const isLoading = loadingSponsors || loadingTeams || loadingAllocations;

  const isAllocated = (teamId: string, sponsorId: string) => {
    return allocations.some(a => a.team_id === teamId && a.sponsor_id === sponsorId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sponsors.length === 0) {
    return (
      <div className="border-t border-border pt-4 mt-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" />
          Team Sponsors
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Add sponsors above first to allocate them to teams
        </p>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="border-t border-border pt-4 mt-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" />
          Team Sponsors
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Create teams first to allocate sponsors
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-border pt-4 mt-4 space-y-3">
      <div>
        <h3 className="font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" />
          Team Sponsors
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Allocate specific sponsors to each team (separate from club rotation)
        </p>
      </div>
      
      <Accordion type="multiple" className="space-y-2">
        {teams.map((team) => (
          <AccordionItem key={team.id} value={team.id} className="border rounded-lg px-3">
            <AccordionTrigger className="hover:no-underline py-3">
              <span className="font-medium">{team.name}</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2 pb-2">
                {sponsors.map((sponsor) => {
                  const allocated = isAllocated(team.id, sponsor.id);
                  return (
                    <div 
                      key={sponsor.id} 
                      className="flex items-center gap-3 p-2 rounded-lg border border-border"
                    >
                      <Checkbox
                        id={`${team.id}-${sponsor.id}`}
                        checked={allocated}
                        onCheckedChange={(checked) => 
                          toggleAllocationMutation.mutate({ 
                            teamId: team.id,
                            sponsorId: sponsor.id, 
                            allocated: checked === true 
                          })
                        }
                        disabled={toggleAllocationMutation.isPending}
                      />
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={sponsor.logo_url || undefined} />
                        <AvatarFallback className="bg-secondary text-xs">
                          {sponsor.name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <Label 
                        htmlFor={`${team.id}-${sponsor.id}`}
                        className="font-medium flex-1 cursor-pointer text-sm"
                      >
                        {sponsor.name}
                      </Label>
                    </div>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}