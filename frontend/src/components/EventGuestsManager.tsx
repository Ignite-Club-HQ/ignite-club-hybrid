import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Trash2, Loader2, Users } from "lucide-react";

interface EventGuestsManagerProps {
  eventId: string;
  clubId: string;
  maxGuestsPerMember: number;
  isAdmin?: boolean;
}

interface EventGuest {
  id: string;
  event_id: string;
  added_by: string;
  guest_name: string;
  created_at: string;
}

export function EventGuestsManager({
  eventId,
  clubId,
  maxGuestsPerMember,
  isAdmin = false,
}: EventGuestsManagerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newGuestName, setNewGuestName] = useState("");

  // Fetch all guests for this event
  const { data: allGuests = [], isLoading } = useQuery({
    queryKey: ["event-guests", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_guests")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as EventGuest[];
    },
    enabled: !!eventId,
  });

  // Fetch profiles for guest adders (for admin view)
  const adderIds = [...new Set(allGuests.map((g) => g.added_by))];
  const { data: adderProfiles } = useQuery({
    queryKey: ["guest-adder-profiles", adderIds],
    queryFn: async () => {
      if (adderIds.length === 0) return {};
      const { data } = await selectCachedProfilesByIds(adderIds);
      const map: Record<string, string> = {};
      data?.forEach((p) => {
        map[p.id] = p.display_name || "Unknown";
      });
      return map;
    },
    enabled: adderIds.length > 0,
  });

  const myGuests = allGuests.filter((g) => g.added_by === user?.id);
  const canAddMore = myGuests.length < maxGuestsPerMember;

  const addGuestMutation = useMutation({
    mutationFn: async (guestName: string) => {
      const { error } = await supabase.from("event_guests").insert({
        event_id: eventId,
        added_by: user!.id,
        guest_name: guestName.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-guests", eventId] });
      setNewGuestName("");
      toast({ title: "Guest added" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to add guest", description: error.message, variant: "destructive" });
    },
  });

  const removeGuestMutation = useMutation({
    mutationFn: async (guestId: string) => {
      const { error } = await supabase
        .from("event_guests")
        .delete()
        .eq("id", guestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-guests", eventId] });
      toast({ title: "Guest removed" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to remove guest", description: error.message, variant: "destructive" });
    },
  });

  const handleAdd = () => {
    if (!newGuestName.trim()) return;
    if (!canAddMore) {
      toast({ title: `Maximum ${maxGuestsPerMember} guests allowed`, variant: "destructive" });
      return;
    }
    const normalised = newGuestName.trim().toLowerCase();
    const duplicate = allGuests.find(
      (g) => g.guest_name.toLowerCase() === normalised
    );
    if (duplicate) {
      const addedByYou = duplicate.added_by === user?.id;
      toast({
        title: "Guest already added",
        description: addedByYou
          ? "You've already added this guest."
          : `This guest has already been added by ${adderProfiles?.[duplicate.added_by] || "another member"}.`,
        variant: "destructive",
      });
      return;
    }
    addGuestMutation.mutate(newGuestName);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Group guests by who added them (for display)
  const guestsByAdder = allGuests.reduce<Record<string, EventGuest[]>>((acc, g) => {
    if (!acc[g.added_by]) acc[g.added_by] = [];
    acc[g.added_by].push(g);
    return acc;
  }, {});

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Additional Guests</h2>
        </div>
        {allGuests.length > 0 && (
          <Badge variant="secondary">{allGuests.length} guest{allGuests.length !== 1 ? "s" : ""}</Badge>
        )}
      </div>

      {/* Add guest form */}
      <Card className="border-dashed">
        <CardContent className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Bringing someone? Add their name below ({myGuests.length}/{maxGuestsPerMember} guests)
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Guest name"
              value={newGuestName}
              onChange={(e) => setNewGuestName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              disabled={!canAddMore || addGuestMutation.isPending}
              className="flex-1"
            />
            <Button
              onClick={handleAdd}
              disabled={!canAddMore || !newGuestName.trim() || addGuestMutation.isPending}
              size="sm"
            >
              {addGuestMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* My guests */}
          {myGuests.length > 0 && (
            <div className="space-y-2">
              {myGuests.map((guest) => (
                <div key={guest.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                  <span className="text-sm font-medium">{guest.guest_name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => removeGuestMutation.mutate(guest.id)}
                    disabled={removeGuestMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* All guests list (visible to everyone) */}
      {Object.keys(guestsByAdder).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              All Guests Attending
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(guestsByAdder).map(([adderId, guests]) => (
              <div key={adderId} className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Added by {adderId === user?.id ? "you" : adderProfiles?.[adderId] || "a member"}
                </p>
                {guests.map((guest) => (
                  <div key={guest.id} className="flex items-center justify-between pl-3 py-1">
                    <span className="text-sm">{guest.guest_name}</span>
                    {/* Admins can remove any guest */}
                    {isAdmin && adderId !== user?.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeGuestMutation.mutate(guest.id)}
                        disabled={removeGuestMutation.isPending}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
