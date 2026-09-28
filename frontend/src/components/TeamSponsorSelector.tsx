import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Building2, Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
}

interface TeamSponsorSelectorProps {
  teamId: string;
  currentSponsorId: string | null;
  onUpdate?: () => void;
}

export function TeamSponsorSelector({ 
  teamId, 
  currentSponsorId,
  onUpdate 
}: TeamSponsorSelectorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch allocated sponsors for this team (set by club admin)
  const { data: sponsors = [], isLoading } = useQuery({
    queryKey: ["team-allocated-sponsors", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_sponsor_allocations")
        .select("sponsors:sponsor_id(id, name, logo_url)")
        .eq("team_id", teamId);
      
      if (error) throw error;
      return data
        .map(a => a.sponsors as unknown as Sponsor)
        .filter(Boolean);
    },
  });

  const updateTeamSponsorMutation = useMutation({
    mutationFn: async (sponsorId: string | null) => {
      const { error } = await supabase
        .from("teams")
        .update({ sponsor_id: sponsorId })
        .eq("id", teamId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team", teamId] });
      onUpdate?.();
      toast({ title: "Team sponsor updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to update sponsor", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (sponsors.length === 0) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-muted-foreground text-sm">
          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No sponsors allocated</p>
          <p className="text-xs">Ask a club admin to allocate sponsors to this team</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Team Sponsor
          </CardTitle>
          {currentSponsorId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => updateTeamSponsorMutation.mutate(null)}
              disabled={updateTeamSponsorMutation.isPending}
            >
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!currentSponsorId && (
          <p className="text-sm text-muted-foreground mb-2">
            Select a sponsor to display on this team's page
          </p>
        )}
        
        {sponsors.map((sponsor) => {
          const isSelected = sponsor.id === currentSponsorId;
          return (
            <div 
              key={sponsor.id} 
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                isSelected 
                  ? "border-primary bg-primary/5 ring-1 ring-primary" 
                  : "border-border hover:border-primary/50 hover:bg-muted/50"
              }`}
              onClick={() => updateTeamSponsorMutation.mutate(isSelected ? null : sponsor.id)}
            >
              <Avatar className="h-10 w-10">
                <AvatarImage src={sponsor.logo_url || undefined} />
                <AvatarFallback className="bg-secondary text-sm">
                  {sponsor.name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="font-medium flex-1">{sponsor.name}</span>
              {isSelected && (
                <Badge variant="default" className="gap-1">
                  <Check className="h-3 w-3" />
                  Selected
                </Badge>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
