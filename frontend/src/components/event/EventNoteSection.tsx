import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StickyNote, Pencil, Send, X, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfileById } from "@/lib/profileCache";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { friendlyMutationError } from "@/lib/friendlyMutationError";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveCoachNote, setLiveCoachNote } from "@/live/features/events";

interface EventNoteSectionProps {
  eventId: string;
  note: string | null | undefined;
  noteUpdatedAt: string | null | undefined;
  noteAuthor: string | null | undefined;
  authorName?: string | null;
  canEdit: boolean;
}

const MAX_LEN = 500;

export function EventNoteSection({
  eventId,
  note,
  noteUpdatedAt,
  noteAuthor,
  authorName,
  canEdit,
}: EventNoteSectionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const isIcpRouted = isFeatureRoutedToIcp("events");

  // On ICP, coach notes live in events_domain (set_coach_note/get_coach_note)
  // rather than on the Supabase `events` row the caller passed props from —
  // fetch directly so Internet Identity accounts see live canister state.
  const { data: icpNote } = useQuery({
    queryKey: ["live-coach-note", eventId],
    enabled: isIcpRouted && !!eventId,
    queryFn: () =>
      withFeatureBackend("events", {
        supabase: async () => null,
        icp: async (ctx) => {
          const result = await getLiveCoachNote(ctx, eventId);
          const raw = result && result.length ? result[0] : null;
          if (!raw) return null;
          return {
            note: raw.note,
            author: raw.updated_by.toText(),
            updated_at: raw.updated_at_ms,
          };
        },
      }),
  });

  const effectiveNote = isIcpRouted ? icpNote?.note ?? null : note ?? null;
  const effectiveNoteAuthor = isIcpRouted ? icpNote?.author ?? null : noteAuthor ?? null;
  const effectiveNoteUpdatedAt = isIcpRouted
    ? icpNote?.updated_at != null
      ? new Date(Number(icpNote.updated_at)).toISOString()
      : null
    : noteUpdatedAt ?? null;

  const [draft, setDraft] = useState(effectiveNote ?? "");

  useEffect(() => {
    if (!editing) setDraft(effectiveNote ?? "");
  }, [effectiveNote, editing]);

  // When entering edit mode, gently scroll the card into view before focusing
  // the textarea. Mobile browsers otherwise scroll the focused input to the
  // very top of the viewport, which yanks the surrounding context off-screen.
  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      // Focus after the scroll starts so the keyboard opens in place.
      setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 250);
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  // On ICP, the author is a principal text (no Supabase profile row to join
  // against) — show the raw author id rather than attempting a profile
  // lookup that would always miss.
  const { data: fetchedAuthor } = useQuery({
    queryKey: ["event-note-author", effectiveNoteAuthor],
    enabled: !!effectiveNoteAuthor && !authorName && !isIcpRouted,
    queryFn: async () => {
      const { data } = await selectCachedProfileById(effectiveNoteAuthor!);
      return data?.display_name ?? null;
    },
  });
  const displayAuthor = authorName ?? fetchedAuthor ?? (isIcpRouted ? effectiveNoteAuthor : null) ?? null;

  const saveMutation = useMutation({
    mutationFn: async (value: string) => {
      const trimmed = value.trim();
      const isUpdate = !!effectiveNote?.trim() && !!trimmed;
      const isClear = !trimmed;

      const savedOnIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          await setLiveCoachNote(ctx, eventId, trimmed);
          return true;
        },
      });
      if (savedOnIcp) {
        queryClient.invalidateQueries({ queryKey: ["live-coach-note", eventId] });
        // Push notifications on note changes stay Supabase-only (push
        // delivery infra); ICP-routed notes are saved but do not notify.
        return { isClear };
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("events")
        .update({
          coach_note: trimmed || null,
          coach_note_author: trimmed ? user.id : null,
          coach_note_updated_at: trimmed ? new Date().toISOString() : null,
        })
        .eq("id", eventId);
      if (error) throw error;

      // Only notify when there's a non-empty note
      if (!isClear) {
        try {
          await supabase.functions.invoke("notify-event-note", {
            body: { eventId, isUpdate },
          });
        } catch (err) {
          console.error("notify-event-note failed", err);
        }
      }
      return { isClear };
    },
    onSuccess: ({ isClear }) => {
      queryClient.invalidateQueries({ queryKey: ["event", eventId] });
      setEditing(false);
      toast({
        title: isClear ? "Note removed" : "Note posted",
        description: isClear ? undefined : "Attendees have been notified.",
      });
    },
    onError: (err: any) => {
      toast(friendlyMutationError(err, { title: "Couldn't save note", description: err?.message || "Please try again." }));
    },
  });

  const hasNote = !!effectiveNote?.trim();

  if (!hasNote && !canEdit) return null;

  if (editing) {
    return (
      <Card ref={cardRef} className="border-primary/30 scroll-mt-20">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <StickyNote className="h-4 w-4 text-primary" />
            {hasNote ? "Edit event note (visible to everyone)" : "Post event note (visible to everyone)"}
          </div>
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_LEN))}
            placeholder="e.g. Bring both kits, parking is on Smith St, arrive 15 min early."
            rows={3}
          />
          <p className="text-xs text-muted-foreground">
            {draft.length}/{MAX_LEN} · Sends a push to RSVP'd members
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setDraft(effectiveNote ?? "");
              }}
              disabled={saveMutation.isPending}
            >
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            {hasNote && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => saveMutation.mutate("")}
                disabled={saveMutation.isPending}
              >
                Remove
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => saveMutation.mutate(draft)}
              disabled={saveMutation.isPending || !draft.trim() || draft.trim() === (effectiveNote ?? "").trim()}
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              {hasNote ? "Update & notify" : "Post & notify"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!hasNote) {
    return (
      <Button
        variant="outline"
        className="w-full justify-start text-muted-foreground"
        onClick={() => setEditing(true)}
      >
        <StickyNote className="h-4 w-4 mr-2" />
        Add an event note (visible to everyone)
      </Button>
    );
  }

  return (
    <Card className="border-primary/30 bg-primary/[0.04]">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <StickyNote className="h-4 w-4" />
            Event note (visible to everyone)
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          )}
        </div>
        <p className="text-sm whitespace-pre-line">{effectiveNote}</p>
        {(displayAuthor || effectiveNoteUpdatedAt) && (
          <p className="text-xs text-muted-foreground">
            {displayAuthor ? `By ${displayAuthor}` : "Posted"}
            {effectiveNoteUpdatedAt &&
              ` · ${formatDistanceToNow(new Date(effectiveNoteUpdatedAt), { addSuffix: true })}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
