import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Database } from "@/integrations/supabase/types";

export type ScheduledChatType =
  | "team"
  | "club"
  | "group"
  | "direct"
  | "club_admin"
  | "broadcast";

export type ScheduledMessageStatus = "pending" | "sent" | "failed" | "cancelled";

export type ScheduledMessageRecurrence = "none" | "daily" | "weekly" | "monthly";

export interface ScheduledMessageRow {
  id: string;
  author_id: string;
  chat_type: ScheduledChatType;
  team_id: string | null;
  club_id: string | null;
  group_id: string | null;
  conversation_id: string | null;
  text: string;
  image_url: string | null;
  reply_to_id: string | null;
  scheduled_for: string;
  status: ScheduledMessageStatus;
  sent_message_id: string | null;
  error_message: string | null;
  attempted_at: string | null;
  recurrence: ScheduledMessageRecurrence;
  recurrence_until: string | null;
  recurrence_parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleTarget {
  chat_type: ScheduledChatType;
  team_id?: string | null;
  club_id?: string | null;
  group_id?: string | null;
  conversation_id?: string | null;
}

export interface CreateScheduledMessageInput extends ScheduleTarget {
  text: string;
  image_url?: string | null;
  reply_to_id?: string | null;
  scheduled_for: Date;
  recurrence?: ScheduledMessageRecurrence;
  recurrence_until?: Date | null;
}

function targetKey(t: ScheduleTarget): string {
  return [
    t.chat_type,
    t.team_id || "",
    t.club_id || "",
    t.group_id || "",
    t.conversation_id || "",
  ].join("|");
}

function targetMatches(row: ScheduledMessageRow, t: ScheduleTarget): boolean {
  if (row.chat_type !== t.chat_type) return false;
  return (
    (row.team_id || null) === (t.team_id || null) &&
    (row.club_id || null) === (t.club_id || null) &&
    (row.group_id || null) === (t.group_id || null) &&
    (row.conversation_id || null) === (t.conversation_id || null)
  );
}

/**
 * Pending scheduled messages for a specific thread (current user only).
 */
export function useThreadScheduledMessages(target: ScheduleTarget | null) {
  const { user } = useAuth();
  const key = target ? targetKey(target) : "";

  return useQuery({
    queryKey: ["scheduled-messages-thread", user?.id, key],
    queryFn: async (): Promise<ScheduledMessageRow[]> => {
      if (!user?.id || !target) return [];
      let q = supabase
        .from("scheduled_messages" as any)
        .select("*")
        .eq("author_id", user.id)
        .eq("status", "pending")
        .eq("chat_type", target.chat_type)
        .order("scheduled_for", { ascending: true });

      if (target.team_id) q = q.eq("team_id", target.team_id);
      else q = q.is("team_id", null);
      if (target.club_id) q = q.eq("club_id", target.club_id);
      else q = q.is("club_id", null);
      if (target.group_id) q = q.eq("group_id", target.group_id);
      else q = q.is("group_id", null);
      if (target.conversation_id) q = q.eq("conversation_id", target.conversation_id);
      else q = q.is("conversation_id", null);

      const { data, error } = await q;
      if (error) {
        console.error("[scheduled-messages] thread fetch error", error);
        // Reject rather than return `[]` so React Query enters an error
        // state — the UI must warn that existing scheduled messages may
        // still send, instead of implying the schedule is empty.
        const e = new Error(error.message || "Failed to load scheduled messages");
        (e as any).code = "scheduled_messages_read_failed";
        throw e;
      }
      return (data || []) as unknown as ScheduledMessageRow[];
    },
    enabled: !!user?.id && !!target,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    // Transient failures dominate here: an Android resume aborts in-flight
    // GETs and a flaky mobile connection fails the first attempt. Retry a few
    // times with backoff, and always re-run on reconnect, before the UI is
    // allowed to claim the schedule couldn't be loaded.
    retry: 3,
    retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 6000),
    refetchOnReconnect: "always",
    // Keep previously loaded rows visible during a background refetch that
    // fails, so a transient error doesn't blank the banner and tempt users
    // into recreating the same message.
    placeholderData: keepPreviousData,
  });
}


/**
 * All of the user's scheduled messages, optionally filtered by status.
 */
export function useAllScheduledMessages(statuses: ScheduledMessageStatus[] = ["pending"]) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["scheduled-messages-all", user?.id, statuses.join(",")],
    queryFn: async (): Promise<ScheduledMessageRow[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("scheduled_messages" as any)
        .select("*")
        .eq("author_id", user.id)
        .in("status", statuses)
        .order("scheduled_for", { ascending: true });
      if (error) {
        console.error("[scheduled-messages] all fetch error", error);
        const e = new Error(error.message || "Failed to load scheduled messages");
        (e as any).code = "scheduled_messages_read_failed";
        throw e;
      }
      return (data || []) as unknown as ScheduledMessageRow[];
    },
    enabled: !!user?.id,
    staleTime: 30 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(800 * 2 ** attempt, 6000),
    refetchOnReconnect: "always",
    placeholderData: keepPreviousData,
  });
}

async function invokeWrite(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("scheduled-messages-write", {
    body,
  });
  if (error) {
    // Surface server-provided error payload when possible.
    const ctx: any = (error as any).context;
    let serverMsg: string | undefined;
    let httpStatus: number | undefined = typeof ctx?.status === "number" ? ctx.status : undefined;
    try {
      const parsed = ctx && typeof ctx.json === "function" ? await ctx.json() : undefined;
      if (parsed?.error === "pro_required") {
        const e = new Error("Pro required");
        (e as any).code = "pro_required";
        (e as any).payload = parsed;
        throw e;
      }
      serverMsg = typeof parsed?.error === "string" ? parsed.error : undefined;
    } catch (inner) {
      if ((inner as any)?.code === "pro_required") throw inner;
    }
    const combined = `${serverMsg || ""} ${error.message || ""}`.toLowerCase();
    const isSessionExpired =
      httpStatus === 401 ||
      /not authenticated|unauthori[sz]ed|jwt|session/i.test(combined);
    const outMsg = isSessionExpired
      ? "Your session has expired. Please sign in again."
      : serverMsg || error.message || "Request failed";
    const e = new Error(outMsg);
    if (isSessionExpired) (e as any).code = "session_expired";
    throw e;
  }
  return data;
}

export function useCreateScheduledMessage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateScheduledMessageInput) => {
      if (!user?.id) throw new Error("Not authenticated");
      const data = await invokeWrite({
        action: "create",
        chat_type: input.chat_type,
        team_id: input.team_id ?? null,
        club_id: input.club_id ?? null,
        group_id: input.group_id ?? null,
        conversation_id: input.conversation_id ?? null,
        text: input.text || "",
        image_url: input.image_url ?? null,
        reply_to_id: input.reply_to_id ?? null,
        scheduled_for: input.scheduled_for.toISOString(),
        recurrence: input.recurrence ?? "none",
        recurrence_until: input.recurrence_until
          ? input.recurrence_until.toISOString()
          : null,
      });
      return (data as any)?.row as ScheduledMessageRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-messages-thread"] });
      qc.invalidateQueries({ queryKey: ["scheduled-messages-all"] });
    },
  });
}

export function useUpdateScheduledMessage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      text?: string;
      image_url?: string | null;
      scheduled_for?: Date;
      recurrence?: ScheduledMessageRecurrence;
      recurrence_until?: Date | null;
    }) => {
      if (!user?.id) throw new Error("Not authenticated");
      const body: Record<string, unknown> = { action: "update", id: input.id };
      if (input.text !== undefined) body.text = input.text;
      if (input.image_url !== undefined) body.image_url = input.image_url;
      if (input.scheduled_for) body.scheduled_for = input.scheduled_for.toISOString();
      if (input.recurrence !== undefined) body.recurrence = input.recurrence;
      if (input.recurrence_until !== undefined) {
        body.recurrence_until = input.recurrence_until
          ? input.recurrence_until.toISOString()
          : null;
      }
      const data = await invokeWrite(body);
      return (data as any)?.row as ScheduledMessageRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-messages-thread"] });
      qc.invalidateQueries({ queryKey: ["scheduled-messages-all"] });
    },
  });
}

export function useCancelScheduledMessage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error("Not authenticated");
      await invokeWrite({ action: "cancel", id });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-messages-thread"] });
      qc.invalidateQueries({ queryKey: ["scheduled-messages-all"] });
    },
  });
}

export { targetMatches };
