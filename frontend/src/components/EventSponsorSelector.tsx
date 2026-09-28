import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Loader2 } from "lucide-react";

interface Sponsor {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
}

interface EventSponsorSelectorProps {
  eventId: string;
  clubId: string;
}

export function EventSponsorSelector({ eventId, clubId }: EventSponsorSelectorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  // Fetch available sponsors for this club
  const { data: sponsors, isLoading: sponsorsLoading } = useQuery({
    queryKey: ["sponsors", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, is_active")
        .eq("club_id", clubId)
        .eq("is_active", true)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      return data as Sponsor[];
    },
  });

  // Fetch current event sponsors
  const { data: eventSponsorIds, isLoading: eventSponsorsLoading } = useQuery({
    queryKey: ["event-sponsor-ids", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_sponsors")
        .select("sponsor_id")
        .eq("event_id", eventId);
      
      if (error) throw error;
      return data?.map(es => es.sponsor_id) || [];
    },
  });

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Initialize selected IDs once when data loads
  useEffect(() => {
    if (!initialized && eventSponsorIds) {
      setSelectedIds(eventSponsorIds);
      setInitialized(true);
    }
  }, [eventSponsorIds, initialized]);

  const saveMutation = useMutation({
    mutationFn: async (sponsorIds: string[]) => {
      // Delete existing
      const { error: deleteError } = await supabase
        .from("event_sponsors")
        .delete()
        .eq("event_id", eventId);
      
      if (deleteError) throw deleteError;

      // Insert new
      if (sponsorIds.length > 0) {
        const inserts = sponsorIds.map((sponsorId, index) => ({
          event_id: eventId,
          sponsor_id: sponsorId,
          display_order: index,
        }));

        const { error: insertError } = await supabase
          .from("event_sponsors")
          .insert(inserts);
        
        if (insertError) throw insertError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-sponsors", eventId] });
      queryClient.invalidateQueries({ queryKey: ["event-sponsor-ids", eventId] });
      toast({ title: "Event sponsors updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to update sponsors", description: error.message, variant: "destructive" });
    },
  });

  const toggleSponsor = (sponsorId: string) => {
    setSelectedIds(prev => 
      prev.includes(sponsorId)
        ? prev.filter(id => id !== sponsorId)
        : [...prev, sponsorId]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveMutation.mutateAsync(selectedIds);
    } finally {
      setSaving(false);
    }
  };

  const isLoading = sponsorsLoading || eventSponsorsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!sponsors?.length) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-muted-foreground text-sm">
          <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No sponsors available</p>
          <p className="text-xs">Add sponsors in club settings first</p>
        </CardContent>
      </Card>
    );
  }

  const hasChanges = JSON.stringify([...selectedIds].sort()) !== 
    JSON.stringify([...(eventSponsorIds || [])].sort());

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          Event Sponsors
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sponsors.map((sponsor) => (
          <div 
            key={sponsor.id} 
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer"
            onClick={() => toggleSponsor(sponsor.id)}
          >
            <Checkbox
              checked={selectedIds.includes(sponsor.id)}
              onCheckedChange={() => toggleSponsor(sponsor.id)}
            />
            <Avatar className="h-8 w-8">
              <AvatarImage src={sponsor.logo_url || undefined} />
              <AvatarFallback className="bg-secondary text-xs">
                {sponsor.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <Label className="cursor-pointer flex-1">{sponsor.name}</Label>
          </div>
        ))}

        {hasChanges && (
          <Button 
            onClick={handleSave} 
            disabled={saving}
            className="w-full mt-2"
            size="sm"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Sponsors
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
