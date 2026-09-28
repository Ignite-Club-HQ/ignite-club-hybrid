import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  performEventDeletion,
  type DeletableEvent,
  type DeleteType,
  type EventDeletionOutcome,
} from "@/lib/eventSeriesDeletion";
import { purgeDeletedEventFromCaches } from "@/lib/eventDeletionCache";

interface UseDeleteEventOptions {
  /** Called only after the database has confirmed the deletion. */
  onDeleted?: (outcome: Extract<EventDeletionOutcome, { kind: "success" }>) => void;
  /** Label used in toasts, e.g. "Game". Defaults to "Event". */
  entityLabel?: string;
}

/**
 * Single reliable event deletion path used by every entry point.
 *
 * Contract:
 * - awaits Supabase and inspects the returned error AND the deleted ids;
 * - exactly one request per confirmation (ref gate — two taps can land before
 *   React re-renders, so state alone cannot guard it);
 * - success toast + navigation happen only after confirmation;
 * - failure keeps the user where they are and shows a destructive toast;
 * - caches are purged and every event query refetched before `onDeleted`.
 */
export function useDeleteEvent(options: UseDeleteEventOptions = {}) {
  const { onDeleted, entityLabel = "Event" } = options;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const inFlightRef = useRef(false);
  const [isPending, setIsPending] = useState(false);

  const deleteEvent = useCallback(
    async (event: DeletableEvent | null | undefined, deleteType: DeleteType) => {
      if (inFlightRef.current) return;
      if (!event?.id) return;

      inFlightRef.current = true;
      setIsPending(true);

      let outcome: EventDeletionOutcome;
      try {
        outcome = await performEventDeletion(supabase, event, deleteType);
      } catch (err: any) {
        outcome = { kind: "failed", message: err?.message ?? "Unknown error" };
      }

      if (outcome.kind !== "failed") {
        try {
          await purgeDeletedEventFromCaches(queryClient, outcome.deletedIds);
        } catch {
          // Cache maintenance must never turn a committed delete into a failure.
        }
      }

      inFlightRef.current = false;
      setIsPending(false);

      if (outcome.kind === "success") {
        toast({
          title: deleteType === "series" ? "Series deleted" : `${entityLabel} deleted`,
        });
        onDeleted?.(outcome);
        return;
      }

      console.error("[EventDelete] deletion failed", {
        eventId: event.id,
        deleteType,
        kind: outcome.kind,
        error: outcome.message,
      });

      if (outcome.kind === "partial-series") {
        toast({
          title: "Series only partially deleted",
          description: `The repeating events were removed but the original event could not be deleted. ${outcome.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${entityLabel} deletion failed`,
          description: `Nothing was deleted — the ${entityLabel.toLowerCase()} still exists. ${outcome.message}`,
          variant: "destructive",
        });
      }
    },
    [entityLabel, onDeleted, queryClient, toast],
  );

  return { deleteEvent, isPending };
}
