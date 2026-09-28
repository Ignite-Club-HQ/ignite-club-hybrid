import { Check, Repeat2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTrainingDefault } from "@/hooks/useTrainingDefault";
import { toast } from "@/hooks/use-toast";

interface Props {
  teamId: string | null | undefined;
  /** Pass exactly one of childId or userId. */
  childId?: string | null;
  userId?: string | null;
  /** Display name used in microcopy (e.g. "Teddy" or "you"). */
  subjectName: string;
  /** Most recent RSVP status the user just gave for this event. */
  currentRsvpStatus?: "going" | "maybe" | "not_going" | null;
  /** True only when this event is a training. */
  isTraining: boolean;
}




/**
 * Inline default-RSVP control shown under the RSVP buttons on training events.
 *
 * - Only renders when isTraining is true.
 * - If a default already exists: shows a small chip with "Auto-going to trainings · Change".
 * - Else if the parent just RSVP'd "going" or "not_going": offers to make it the default.
 * - Else: renders nothing (we don't ask cold).
 */
export function TrainingDefaultControl({
  teamId,
  childId,
  userId,
  subjectName,
  currentRsvpStatus,
  isTraining,
}: Props) {
  const { defaultRow, setDefault, clearDefault, isSaving } = useTrainingDefault({
    teamId,
    childId,
    userId,
  });



  if (!isTraining || !teamId) return null;

  // Already has a default — render management chip (or paused notice)
  if (defaultRow) {
    if (defaultRow.auto_paused_at) {
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <Repeat2 className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <span className="text-foreground/90">
            Auto-RSVP paused for {subjectName} — we haven't heard from you in a while.
          </span>
          <Button
            size="sm"
            disabled={isSaving}
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => {
              setDefault(defaultRow.default_status);
              toast({ title: "Auto-RSVP resumed." });
            }}
          >
            Resume
          </Button>
        </div>
      );
    }
    const isGoing = defaultRow.default_status === "going";
    const label = isGoing
      ? `Auto-RSVP'ing ${subjectName} as Going to trainings`
      : `Auto-RSVP'ing ${subjectName} as Not going to trainings`;
    const otherStatus: "going" | "not_going" = isGoing ? "not_going" : "going";
    const otherLabel = isGoing ? "Switch to Not going" : "Switch to Going";
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
        <Repeat2 className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-foreground/90">{label}</span>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => {
              setDefault(otherStatus);
              toast({ title: isGoing ? "Default switched to Not going." : "Default switched to Going." });
            }}
            className="text-primary underline-offset-2 hover:underline touch-manipulation disabled:opacity-50"
          >
            {otherLabel}
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => {
              clearDefault();
              toast({ title: "We'll ask you each time from now on." });
            }}
            className="text-muted-foreground underline-offset-2 hover:underline touch-manipulation disabled:opacity-50"
          >
            Stop
          </button>
        </div>
      </div>
    );
  }

  // No default set yet — always show a permanent opt-in prompt so it's
  // discoverable without having to first RSVP. Defaults to "Going" (most
  // common for trainings); parent can also pick "Not going".

  // If the user just RSVP'd, pre-select that as the suggested default; else "going".
  const suggested: "going" | "not_going" =
    currentRsvpStatus === "not_going" ? "not_going" : "going";
  const verb = suggested === "going" ? "Going" : "Not going";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-xs">
      <Repeat2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="text-foreground/90 min-w-0">
        Auto-RSVP {subjectName} as <span className="font-medium">{verb}</span> to all trainings?
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="default"
          disabled={isSaving}
          className="h-7 px-2 text-xs gap-1"
          onClick={() => {
            setDefault(suggested);
            toast({
              title: `Auto-RSVP on for ${subjectName}`,
              description: "We'll RSVP for every new training. Change any one before kickoff.",
            });
          }}
        >
          <Check className="h-3 w-3" /> Turn on
        </Button>
      </div>
    </div>
  );
}
