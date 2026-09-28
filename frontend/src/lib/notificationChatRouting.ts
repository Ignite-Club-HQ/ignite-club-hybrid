import { supabase } from "@/integrations/supabase/client";
import type { ChatJumpKind } from "@/lib/pendingChatJump";

/**
 * Shared resolution of a notification's `related_id` (a message id) to an
 * accessible chat destination.
 *
 * Every lookup is RLS-scoped, so a deleted or inaccessible message simply
 * resolves to `null`. Callers MUST treat `null` as "route to the safe
 * fallback" (`NOTIFICATION_FALLBACK_PATH`) and must never build a route from
 * an unverified id.
 *
 * IMPORTANT: "no row" and "the lookup failed" are NOT the same thing. On a
 * flaky connection every table probe errors, which previously looked
 * identical to "message deleted" and silently dumped the user on /messages.
 * Use `resolveChatTargetResult` when you need to tell those apart and offer a
 * retry instead of a misleading redirect.
 */

export type ChatTarget = {
  kind: ChatJumpKind;
  targetId: string | null;
  messageId: string;
  path: string;
};

/**
 * `found`       — message resolved to an accessible chat.
 * `not_found`   — every probe SUCCEEDED and returned no row (deleted / no access).
 * `unreachable` — at least one probe failed (network, 5xx, aborted). Recoverable.
 */
export type ChatTargetResolution =
  | { status: "found"; target: ChatTarget }
  | { status: "not_found"; target: null }
  | { status: "unreachable"; target: null };

/** Safe destination when a referenced message cannot be resolved. */
export const NOTIFICATION_FALLBACK_PATH = "/messages";

export const chatTargetPath = (kind: ChatJumpKind, targetId: string | null, messageId: string) => {
  switch (kind) {
    case "team": return targetId ? `/messages/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "club": return targetId ? `/messages/club/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "group": return targetId ? `/groups/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "dm": return targetId ? `/messages/dm/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "club_admin": return targetId ? `/messages/club-admin/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "broadcast": return `/messages/broadcast?message=${messageId}`;
    default: return NOTIFICATION_FALLBACK_PATH;
  }
};

// "No rows" / RLS-hidden results arrive as `data: null` with no error via
// maybeSingle(). Anything else means the probe did NOT prove absence.
function isLookupFailure(table: string, error: unknown): boolean {
  if (!error) return false;
  const code = (error as { code?: string }).code;
  // PGRST116 = no rows for single(); treat as an expected miss, not a failure.
  if (code === "PGRST116") return false;
  console.warn("[NotificationRouting] lookup failed", { table, code: code ?? "unknown" });
  return true;
}

/**
 * Full-fidelity resolution. Probes all six message tables; a single failed
 * probe downgrades an otherwise-empty result to `unreachable` so the caller
 * can retry rather than claim the message is gone.
 */
export async function resolveChatTargetResult(messageId: string): Promise<ChatTargetResolution> {
  if (!messageId) return { status: "not_found", target: null };

  const found = (kind: ChatJumpKind, targetId: string | null): ChatTargetResolution => ({
    status: "found",
    target: { kind, targetId, messageId, path: chatTargetPath(kind, targetId, messageId) },
  });

  let anyFailure = false;

  try {
    const { data: tMsg, error: tErr } = await supabase.from("team_messages").select("team_id").eq("id", messageId).maybeSingle();
    anyFailure = isLookupFailure("team_messages", tErr) || anyFailure;
    if (tMsg?.team_id) return found("team", tMsg.team_id);

    const { data: cMsg, error: cErr } = await supabase.from("club_messages").select("club_id").eq("id", messageId).maybeSingle();
    anyFailure = isLookupFailure("club_messages", cErr) || anyFailure;
    if (cMsg?.club_id) return found("club", cMsg.club_id);

    const { data: gMsg, error: gErr } = await supabase.from("group_messages").select("group_id").eq("id", messageId).maybeSingle();
    anyFailure = isLookupFailure("group_messages", gErr) || anyFailure;
    if (gMsg?.group_id) return found("group", gMsg.group_id);

    const { data: dMsg, error: dErr } = await supabase.from("direct_messages").select("conversation_id").eq("id", messageId).maybeSingle();
    anyFailure = isLookupFailure("direct_messages", dErr) || anyFailure;
    if (dMsg?.conversation_id) return found("dm", dMsg.conversation_id);

    const { data: bMsg, error: bErr } = await supabase.from("broadcast_messages").select("id").eq("id", messageId).maybeSingle();
    anyFailure = isLookupFailure("broadcast_messages", bErr) || anyFailure;
    if (bMsg?.id) return found("broadcast", null);

    const { data: caMsg, error: caErr } = await supabase.from("club_admin_messages").select("conversation_id").eq("id", messageId).maybeSingle();
    anyFailure = isLookupFailure("club_admin_messages", caErr) || anyFailure;
    if (caMsg?.conversation_id) return found("club_admin", caMsg.conversation_id);
  } catch (err) {
    console.warn("[NotificationRouting] unexpected resolution failure", {
      reason: err instanceof Error ? err.name : "unknown",
    });
    return { status: "unreachable", target: null };
  }

  // Offline is proof of nothing.
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (anyFailure || offline) return { status: "unreachable", target: null };

  return { status: "not_found", target: null };
}

/**
 * Back-compat wrapper: returns the target or `null`. Prefer
 * `resolveChatTargetResult` so a dropped connection isn't mistaken for a
 * deleted message.
 */
export async function resolveChatTargetForMessageId(messageId: string): Promise<ChatTarget | null> {
  const result = await resolveChatTargetResult(messageId);
  return result.target;
}
