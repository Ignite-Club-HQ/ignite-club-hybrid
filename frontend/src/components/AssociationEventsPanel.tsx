import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CalendarDays, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Props {
  associationId: string;
  isAdmin: boolean;
  clubs: Array<{ id: string; name: string }>;
}

export function AssociationEventsPanel({ associationId, isAdmin, clubs }: Props) {
  const qc = useQueryClient();

  const { data: events = [] } = useQuery({
    queryKey: ["association-events", associationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id, title, event_date, location_name, club_id, association_event_id")
        .eq("association_id", associationId)
        .is("association_event_id", null) // parents only
        .order("event_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: childCounts = {} } = useQuery({
    queryKey: ["association-event-fanout", associationId, events.map((e) => e.id).join(",")],
    enabled: events.length > 0,
    queryFn: async () => {
      const ids = events.map((e) => e.id);
      const { data } = await supabase
        .from("events")
        .select("association_event_id")
        .in("association_event_id", ids);
      const map: Record<string, number> = {};
      for (const r of data ?? []) {
        const k = r.association_event_id as string;
        map[k] = (map[k] ?? 0) + 1;
      }
      return map;
    },
  });

  return (
    <div className="space-y-3">
      {isAdmin && (
        <CreateAssociationEventSheet
          associationId={associationId}
          clubs={clubs}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["association-events", associationId] });
          }}
        />
      )}

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No association events yet.</p>
      ) : (
        events.map((e) => (
          <Card key={e.id}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <CalendarDays className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{e.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(e.event_date), "EEE d MMM yyyy · h:mm a")}
                    {e.location_name ? ` · ${e.location_name}` : ""}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Invited {childCounts[e.id] ?? 0} club{(childCounts[e.id] ?? 0) === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function CreateAssociationEventSheet({
  associationId,
  clubs,
  onCreated,
}: {
  associationId: string;
  clubs: Array<{ id: string; name: string }>;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [address, setAddress] = useState("");

  // Suggest "participating clubs": those whose teams are linked to a PlayHQ
  // competition organised by this association. We still let admins toggle any
  // member club on/off.
  const { data: participating = new Set<string>() } = useQuery({
    queryKey: ["association-participating-clubs", associationId],
    queryFn: async () => {
      const { data: comps } = await supabase
        .from("competitions")
        .select("id")
        .eq("source", "playhq")
        .eq("organizer_club_id", associationId);
      const compIds = (comps ?? []).map((c) => c.id);
      if (!compIds.length) return new Set<string>();
      const { data: teams } = await supabase
        .from("teams")
        .select("club_id")
        .in("playhq_competition_id", compIds);
      return new Set((teams ?? []).map((t) => t.club_id).filter(Boolean) as string[]);
    },
  });

  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Default selection to participating clubs whenever the set arrives.
  useMemo(() => {
    if (participating instanceof Set && Object.keys(selected).length === 0 && participating.size > 0) {
      const init: Record<string, boolean> = {};
      for (const c of clubs) init[c.id] = participating.has(c.id);
      setSelected(init);
    }
  }, [participating]);

  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }));

  const submit = async () => {
    if (!title.trim() || !date) {
      toast.error("Title and date are required");
      return;
    }
    const clubIds = clubs.filter((c) => selected[c.id]).map((c) => c.id);
    if (clubIds.length === 0) {
      toast.error("Select at least one club to invite");
      return;
    }
    setSubmitting(true);
    try {
      const eventDateIso = new Date(`${date}T${time || "19:00"}:00`).toISOString();
      const { data, error } = await supabase.functions.invoke("association-create-club-event", {
        body: {
          association_id: associationId,
          club_ids: clubIds,
          title: title.trim(),
          description: description.trim() || null,
          event_date: eventDateIso,
          start_time: eventDateIso,
          location_name: location.trim() || null,
          address: address.trim() || null,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`Event created and sent to ${(data as any).invited_clubs} club(s)`);
      setOpen(false);
      setTitle(""); setDescription(""); setDate(""); setLocation(""); setAddress("");
      onCreated();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to create event");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="w-full">
          <Plus className="h-4 w-4 mr-2" /> Create club social event
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New association event</SheetTitle>
        </SheetHeader>
        <div className="space-y-3 pt-4">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Presentation Night" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Time</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Location name</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Venue name" />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Details</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>

          <div className="space-y-2">
            <Label>Invite clubs</Label>
            <p className="text-xs text-muted-foreground">
              Defaults to clubs with teams in this association's PlayHQ comps.
            </p>
            <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
              {clubs.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">No member clubs linked.</div>
              )}
              {clubs.map((c) => (
                <label key={c.id} className="flex items-center gap-3 p-3 cursor-pointer">
                  <Checkbox checked={!!selected[c.id]} onCheckedChange={() => toggle(c.id)} />
                  <div className="flex-1 text-sm">
                    {c.name}
                    {participating instanceof Set && participating.has(c.id) && (
                      <span className="ml-2 text-xs text-muted-foreground">· playing</span>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          <Button onClick={submit} disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Create &amp; invite
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
