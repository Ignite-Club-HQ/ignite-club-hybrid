import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Loader2, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { hapticImpactLight } from "@/lib/haptics";
import { RsvpNoteSheet } from "@/components/rsvp/RsvpNoteSheet";

type Status = "going" | "maybe" | "not_going";

interface Props {
  eventId: string;
  messageId: string;
}

// Tracks per-message RSVP confirmation locally so the buttons stay in their
// "answered" state across re-renders without needing a schema column.
const STORAGE_KEY = "ignite_inline_rsvp_answered";

function readAnswered(messageId: string): Status | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, Status>;
    return map[messageId] ?? null;
  } catch {
    return null;
  }
}

function writeAnswered(messageId: string, status: Status) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, Status>) : {};
    map[messageId] = status;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

const LABELS: Record<Status, string> = {
  going: "Going",
  maybe: "Maybe",
  not_going: "Can't",
};

export function InlineRsvpActions({ eventId, messageId }: Props) {
  const navigate = useNavigate();
  const [answered, setAnswered] = useState<Status | null>(() => readAnswered(messageId));
  const [submitting, setSubmitting] = useState<Status | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Sync if another DM tab updated it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setAnswered(readAnswered(messageId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [messageId]);

  const submit = async (status: Status) => {
    if (submitting || answered) return;
    setSubmitting(status);
    hapticImpactLight();
    try {
      const { data, error } = await supabase.rpc("quick_rsvp_from_dm", {
        _event_id: eventId,
        _status: status,
      });
      if (error) throw error;
      const inserted = Array.isArray(data) && data[0]?.inserted_count ? data[0].inserted_count : 0;
      writeAnswered(messageId, status);
      setAnswered(status);
      toast({
        title:
          inserted > 0
            ? `Marked ${LABELS[status]}`
            : `You've already RSVP'd for this event`,
        description: inserted > 1 ? `Updated ${inserted} responses (you + kids).` : undefined,
      });
    } catch (err: any) {
      console.error("inline rsvp failed", err);
      toast({
        title: "Couldn't save RSVP",
        description: err?.message ?? "Please tap to open the event and try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(null);
    }
  };

  if (answered) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 text-primary text-xs font-medium px-3 py-1.5">
          <Check className="h-3 w-3" />
          You marked {LABELS[answered]}
        </div>
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline touch-manipulation"
        >
          <MessageSquare className="h-3 w-3" />
          {note ? "Edit note" : "Add a note"}
        </button>
        <button
          type="button"
          onClick={() => navigate(`/events/${eventId}`)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline touch-manipulation"
        >
          Open event
        </button>
        <RsvpNoteSheet
          open={noteOpen}
          onOpenChange={setNoteOpen}
          subjectName="You"
          statusLabel={LABELS[answered]}
          initialNote={note}
          onSave={async (value) => {
            const { data: auth } = await supabase.auth.getUser();
            const userId = auth?.user?.id;
            if (!userId) return;
            const { error } = await supabase
              .from("rsvps")
              .update({ notes: value })
              .eq("event_id", eventId)
              .eq("user_id", userId)
              .is("child_id", null);
            if (error) {
              toast({
                title: "Couldn't save note",
                description: error.message,
                variant: "destructive",
              });
              return;
            }
            setNote(value);
            toast({ title: value ? "Note saved" : "Note removed" });
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {(["going", "maybe", "not_going"] as Status[]).map((s) => {
        const isLoading = submitting === s;
        const tone =
          s === "going"
            ? "bg-primary text-primary-foreground hover:opacity-90"
            : s === "maybe"
            ? "bg-muted text-foreground hover:bg-muted/80"
            : "bg-muted text-foreground hover:bg-muted/80";
        return (
          <button
            key={s}
            type="button"
            disabled={!!submitting}
            onClick={() => submit(s)}
            className={`inline-flex items-center gap-1 rounded-full text-xs font-medium px-3 py-1.5 shadow-sm transition touch-manipulation disabled:opacity-60 ${tone}`}
          >
            {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}
