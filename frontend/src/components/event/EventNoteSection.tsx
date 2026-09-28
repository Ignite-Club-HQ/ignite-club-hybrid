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
  const [draft, setDraft] = useState(note ?? "");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(note ?? "");
  }, [note, editing]);

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

  const { data: fetchedAuthor } = useQuery({
    queryKey: ["event-note-author", noteAuthor],
    enabled: !!noteAuthor && !authorName,
    queryFn: async () => {
      const { data } = await selectCachedProfileById(noteAuthor!);
      return data?.display_name ?? null;
    },
  });
  const displayAuthor = authorName ?? fetchedAuthor ?? null;

  const saveMutation = useMutation({
    mutationFn: async (value: string) => {
      const trimmed = value.trim();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const isUpdate = !!note?.trim() && !!trimmed;
      const isClear = !trimmed;

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

  const hasNote = !!note?.trim();

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
                setDraft(note ?? "");
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
              disabled={saveMutation.isPending || !draft.trim() || draft.trim() === (note ?? "").trim()}
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
        <p className="text-sm whitespace-pre-line">{note}</p>
        {(displayAuthor || noteUpdatedAt) && (
          <p className="text-xs text-muted-foreground">
            {displayAuthor ? `By ${displayAuthor}` : "Posted"}
            {noteUpdatedAt &&
              ` · ${formatDistanceToNow(new Date(noteUpdatedAt), { addSuffix: true })}`}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
