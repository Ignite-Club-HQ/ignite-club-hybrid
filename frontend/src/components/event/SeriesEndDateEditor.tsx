import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Repeat, Loader2, CalendarIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { friendlyMutationError } from "@/lib/friendlyMutationError";

interface Props {
  eventId: string;
  parentEventId: string;
  canEdit: boolean;
  onUpdated: () => void;
}

type SeriesEvent = {
  id: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  parent_event_id: string | null;
  recurrence_end_date: string | null;
};

/**
 * Renders inside the Edit Event page for events that are already part of a
 * recurring series. Lets an admin change the series end date:
 *   - Trim: new end date < latest occurrence → deletes future occurrences
 *     whose event_date falls after the new end.
 *   - Extend: new end date > latest occurrence → infers the cadence from the
 *     spacing between the two most recent occurrences and appends additional
 *     events up to the new end.
 * All siblings' `recurrence_end_date` is kept in sync with the new value.
 */
export function SeriesEndDateEditor({ eventId, parentEventId, canEdit, onUpdated }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [newEndDate, setNewEndDate] = useState<string>("");

  // Fetch parent + all siblings for the series.
  const { data: series, isLoading, refetch } = useQuery({
    queryKey: ["series-siblings", parentEventId],
    queryFn: async () => {
      const { data: parent, error: pErr } = await supabase
        .from("events")
        .select("id, event_date, start_time, end_time, parent_event_id, recurrence_end_date")
        .eq("id", parentEventId)
        .maybeSingle();
      if (pErr) throw pErr;

      const { data: children, error: cErr } = await supabase
        .from("events")
        .select("id, event_date, start_time, end_time, parent_event_id, recurrence_end_date")
        .eq("parent_event_id", parentEventId)
        .order("event_date", { ascending: true });
      if (cErr) throw cErr;

      const all: SeriesEvent[] = [];
      if (parent) all.push(parent as SeriesEvent);
      for (const c of children ?? []) all.push(c as SeriesEvent);
      all.sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
      return { parent: parent as SeriesEvent | null, all };
    },
  });

  const currentEnd = series?.parent?.recurrence_end_date ?? null;
  const latestOccurrence = series?.all.length
    ? series.all[series.all.length - 1].event_date
    : null;

  useEffect(() => {
    if (currentEnd) setNewEndDate(currentEnd.slice(0, 10));
    else if (latestOccurrence) setNewEndDate(latestOccurrence.slice(0, 10));
  }, [currentEnd, latestOccurrence]);

  const previewChange = (): {
    action: "none" | "trim" | "extend";
    trimCount: number;
    extendCount: number;
  } => {
    if (!series || !newEndDate) return { action: "none", trimCount: 0, extendCount: 0 };
    const endOfDay = new Date(`${newEndDate}T23:59:59`);
    const trimmed = series.all.filter((e) => new Date(e.event_date) > endOfDay);
    if (trimmed.length > 0) {
      return { action: "trim", trimCount: trimmed.length, extendCount: 0 };
    }
    // Extension: infer cadence from last two occurrences.
    if (series.all.length < 2) return { action: "none", trimCount: 0, extendCount: 0 };
    const last = new Date(series.all[series.all.length - 1].event_date);
    if (endOfDay <= last) return { action: "none", trimCount: 0, extendCount: 0 };
    const prev = new Date(series.all[series.all.length - 2].event_date);
    const stepMs = last.getTime() - prev.getTime();
    if (stepMs <= 0) return { action: "none", trimCount: 0, extendCount: 0 };
    let cursor = new Date(last.getTime() + stepMs);
    let count = 0;
    while (cursor <= endOfDay && count < 200) {
      count++;
      cursor = new Date(cursor.getTime() + stepMs);
    }
    return { action: "extend", trimCount: 0, extendCount: count };
  };

  const preview = previewChange();

  const applyChange = async () => {
    if (!series?.parent || !newEndDate) return;
    setSaving(true);
    try {
      const endOfDay = new Date(`${newEndDate}T23:59:59`);

      if (preview.action === "trim") {
        const toDelete = series.all
          .filter((e) => new Date(e.event_date) > endOfDay)
          .map((e) => e.id)
          // Never delete the parent (would orphan the series) — trim children only.
          .filter((id) => id !== series.parent!.id);
        if (toDelete.length > 0) {
          const { error } = await supabase.from("events").delete().in("id", toDelete);
          if (error) throw error;
        }
      } else if (preview.action === "extend" && series.all.length >= 2) {
        const last = series.all[series.all.length - 1];
        const prev = series.all[series.all.length - 2];
        const stepMs =
          new Date(last.event_date).getTime() - new Date(prev.event_date).getTime();
        const lastStart = new Date(last.event_date);
        const lastEnd = last.end_time ? new Date(last.end_time) : null;
        const durMs = lastEnd ? lastEnd.getTime() - lastStart.getTime() : null;

        // Fetch the parent event once to clone its scope fields for new children.
        const { data: parentFull, error: parentErr } = await supabase
          .from("events")
          .select("*")
          .eq("id", series.parent.id)
          .single();
        if (parentErr) throw parentErr;

        const {
          id: _id,
          created_at: _c,
          updated_at: _u,
          parent_event_id: _p,
          reminder_sent: _r,
          ...template
        } = parentFull as any;

        const newRows: any[] = [];
        let cursor = new Date(lastStart.getTime() + stepMs);
        while (cursor <= endOfDay && newRows.length < 200) {
          const startIso = cursor.toISOString();
          const endIso = durMs ? new Date(cursor.getTime() + durMs).toISOString() : null;
          newRows.push({
            ...template,
            event_date: startIso,
            start_time: startIso,
            end_time: endIso,
            parent_event_id: series.parent.id,
            is_recurring: true,
            recurrence_end_date: newEndDate,
          });
          cursor = new Date(cursor.getTime() + stepMs);
        }

        if (newRows.length > 0) {
          const { error } = await supabase.from("events").insert(newRows);
          if (error) throw error;
        }
      }

      // Sync recurrence_end_date on the parent and all remaining siblings.
      const { error: parentErr } = await supabase
        .from("events")
        .update({ recurrence_end_date: newEndDate })
        .eq("id", series.parent.id);
      if (parentErr) throw parentErr;

      const { error: childErr } = await supabase
        .from("events")
        .update({ recurrence_end_date: newEndDate })
        .eq("parent_event_id", series.parent.id);
      if (childErr) throw childErr;

      toast({
        title: "Series end date updated",
        description:
          preview.action === "trim"
            ? `Removed ${preview.trimCount} future occurrence${preview.trimCount === 1 ? "" : "s"}.`
            : preview.action === "extend"
              ? `Added ${preview.extendCount} occurrence${preview.extendCount === 1 ? "" : "s"}.`
              : "End date saved.",
      });
      setConfirmOpen(false);
      await refetch();
      onUpdated();
    } catch (e: any) {
      toast(friendlyMutationError(e, { description: "Failed to update series end date." }));
    } finally {
      setSaving(false);
    }
  };

  const isChanged =
    !!newEndDate && newEndDate !== (currentEnd?.slice(0, 10) ?? "");

  return (
    <div className="space-y-3 p-3 rounded-lg bg-muted/50">
      <div className="flex items-center gap-2">
        <Repeat className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">This is part of a recurring series</span>
      </div>

      {isLoading ? (
        <div className="text-xs text-muted-foreground">Loading series…</div>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {series?.all.length ?? 0} occurrence{(series?.all.length ?? 0) === 1 ? "" : "s"}
            {latestOccurrence && (
              <> · last on {format(parseISO(latestOccurrence), "EEE d MMM yyyy")}</>
            )}
          </div>

          {canEdit && (
            <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label htmlFor="seriesEndDate" className="text-xs flex items-center gap-1">
                  <CalendarIcon className="h-3 w-3" /> Series ends on
                </Label>
                <Input
                  id="seriesEndDate"
                  type="date"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={!isChanged || preview.action === "none" || saving}
                onClick={() => setConfirmOpen(true)}
              >
                Update
              </Button>
            </div>
          )}

          {isChanged && preview.action === "none" && (
            <p className="text-xs text-muted-foreground">
              New date matches the existing schedule — nothing to change.
            </p>
          )}
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preview.action === "trim" ? "Shorten series?" : "Extend series?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {preview.action === "trim" && (
                <>
                  This will remove {preview.trimCount} future occurrence
                  {preview.trimCount === 1 ? "" : "s"} after{" "}
                  {newEndDate && format(parseISO(newEndDate), "EEE d MMM yyyy")}.
                  RSVPs and duties on those occurrences will be deleted.
                </>
              )}
              {preview.action === "extend" && (
                <>
                  This will add {preview.extendCount} new occurrence
                  {preview.extendCount === 1 ? "" : "s"} using the same cadence,
                  up to {newEndDate && format(parseISO(newEndDate), "EEE d MMM yyyy")}.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={applyChange} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
