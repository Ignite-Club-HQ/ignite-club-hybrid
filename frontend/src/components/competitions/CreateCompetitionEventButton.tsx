import { writeOnce } from "@/live/clubScope";
import { useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { createSupabaseCompetitionEvent } from "@/features/competitions/createSupabaseCompetitionEvent";

type EventType = "social" | "training" | "game";

export function CreateCompetitionEventButton({
  competitionId,
  teamCount,
}: {
  competitionId: string;
  teamCount: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [eventType, setEventType] = useState<EventType>("social");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");

  const reset = () => {
    setTitle("");
    setEventType("social");
    setDate("");
    setStartTime("18:00");
    setEndTime("");
    setLocation("");
    setDescription("");
    setOperationId(null);
  };

  const submit = async () => {
    if (!title.trim() || !date || !startTime) {
      toast({ title: "Add a title, date and start time", variant: "destructive" });
      return;
    }
    const startsAt = new Date(`${date}T${startTime}`);
    const endsAt = endTime
      ? new Date(`${date}T${endTime}`)
      : new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
      toast({ title: "End time must be after the start time", variant: "destructive" });
      return;
    }

    const requestId = operationId ?? crypto.randomUUID();
    setOperationId(requestId);
    setSaving(true);
    try {
      const { withFeatureBackend } = await import("@/live/featureRouter");
      const count = await withFeatureBackend("competitions", {
        supabase: async () => {
          return createSupabaseCompetitionEvent({
            operationId: requestId,
            competitionId,
            title: title.trim(),
            eventType,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            location: location.trim() || null,
            description: description.trim() || null,
          });
        },
        icp: async (ctx) => {
          const { createLiveCompetitionEvent } = await import("@/live/features/competitions");
          return createLiveCompetitionEvent(ctx, {
            operationId: requestId,
            competitionId,
            title: title.trim(),
            description: description.trim(),
            eventType,
            location: location.trim() || null,
            startsAtMs: startsAt,
            endsAtMs: endsAt,
          });
        },
      }, writeOnce({ competitionId }));

      toast({
        title: "Event created",
        description: Number(count) > 0
          ? `Added to ${Number(count)} team schedule${Number(count) === 1 ? "" : "s"}; members are invited.`
          : "There are no accepted teams to invite yet.",
      });
      await queryClient.invalidateQueries({ queryKey: ["events"] });
      reset();
      setOpen(false);
    } catch (error) {
      toast({
        title: "Couldn't create event",
        description: error instanceof Error ? error.message : "Please retry the event creation.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="w-full" onClick={() => setOpen(true)} disabled={teamCount === 0}>
        <CalendarPlus className="mr-2 h-4 w-4" />
        Create event for all teams
      </Button>
      <Dialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Competition event</DialogTitle>
            <DialogDescription>
              Added to all {teamCount} entered {teamCount === 1 ? "team" : "teams"}. Members can RSVP from their team schedule.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="competition-event-title">Title</Label>
              <Input id="competition-event-title" maxLength={200} value={title} onChange={(event) => { setTitle(event.target.value); setOperationId(null); }} />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={eventType} onValueChange={(value) => { setEventType(value as EventType); setOperationId(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="social">Social / meeting</SelectItem>
                  <SelectItem value="training">Training</SelectItem>
                  <SelectItem value="game">Game</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="competition-event-date">Date</Label>
                <Input id="competition-event-date" type="date" value={date} onChange={(event) => { setDate(event.target.value); setOperationId(null); }} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="competition-event-start">Start</Label>
                <Input id="competition-event-start" type="time" value={startTime} onChange={(event) => { setStartTime(event.target.value); setOperationId(null); }} />
              </div>
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label htmlFor="competition-event-end">End (optional)</Label>
                <Input id="competition-event-end" type="time" value={endTime} onChange={(event) => { setEndTime(event.target.value); setOperationId(null); }} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competition-event-location">Location (optional)</Label>
              <Input id="competition-event-location" maxLength={256} value={location} onChange={(event) => { setLocation(event.target.value); setOperationId(null); }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competition-event-description">Details (optional)</Label>
              <Textarea id="competition-event-description" maxLength={2000} rows={3} value={description} onChange={(event) => { setDescription(event.target.value); setOperationId(null); }} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving || teamCount === 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create & invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}