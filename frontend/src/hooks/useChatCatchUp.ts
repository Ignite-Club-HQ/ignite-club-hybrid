import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ChatScopeType = "team" | "club" | "group" | "club_admin" | "direct";

export interface OutstandingAction {
  text: string;
  owner: string | null;
  priority: "high" | "medium" | "low";
}

export interface OutstandingQuestion {
  text: string;
  date?: string; // ISO date (YYYY-MM-DD) the question was asked
}

export function normalizeQuestion(q: OutstandingQuestion | string): OutstandingQuestion {
  return typeof q === "string" ? { text: q } : q;
}

export interface ChatSummaryPayload {
  headline: string;
  since_last_visit?: {
    today: string[];
    yesterday: string[];
    earlier: string[];
  };
  outstanding_actions?: OutstandingAction[];
  outstanding_questions?: OutstandingQuestion[];
  detailed?: {
    schedule_changes: string[];
    files_shared: string[];
    discussion: string[];
  };
  /** True when the backend had to fall back to a 7-day floor because last_opened_at was missing or stale. */
  used_fallback?: boolean;
  // Legacy fields (may still appear in cached summaries from the previous schema).
  important_updates?: string[];
  actions_needed?: string[];
  schedule_changes?: string[];
  people_mentioned?: string[];
  files_shared?: string[];
  unanswered_questions?: (OutstandingQuestion | string)[];
}

export interface ChatSummaryResult {
  summary: ChatSummaryPayload;
  message_count: number;
  last_message_id: string | null;
  cached: boolean;
  /** True when the backend fell back to a 7-day floor because last_opened_at was missing or stale. */
  used_fallback?: boolean;
  /** When the user explicitly chose a deeper time window, the hours covered. */
  lookback_hours?: number;
  /** ISO timestamp of the start of the time window the summary covers. */
  window_since?: string | null;
  /** True when message_count hit the per-window cap and older messages were dropped. */
  truncated?: boolean;
  /** Per-window message cap applied for this lookback, if any. */
  message_cap?: number | null;

}

function hasUsefulRecapContent(result: ChatSummaryResult | null | undefined): boolean {
  const s = result?.summary;
  if (!s) return false;
  return (
    (s.since_last_visit?.today?.length ?? 0) +
    (s.since_last_visit?.yesterday?.length ?? 0) +
    (s.since_last_visit?.earlier?.length ?? 0) +
    (s.outstanding_actions?.length ?? 0) +
    (s.detailed?.schedule_changes?.length ?? 0) +
    (s.detailed?.files_shared?.length ?? 0) +
    (s.detailed?.discussion?.length ?? 0) +
    (s.important_updates?.length ?? 0) +
    (s.actions_needed?.length ?? 0) +
    (s.schedule_changes?.length ?? 0) +
    (s.files_shared?.length ?? 0)
  ) > 0;
}

const LAST_OPENED_KEY = "chat-catchup:last-opened";
const PREV_OPENED_KEY = "chat-catchup:prev-opened";
const DISMISSED_KEY = "chat-catchup:dismissed";
const UNREAD_MIN = 10;
const STALE_HOURS = 24;
/**
 * Default lookback window for every Chat Recap (single-thread and global).
 * Users can pick deeper windows (7d / 30d) from the sheet on demand.
 */
export const DEFAULT_LOOKBACK_HOURS = 24;
/** Progressive escalation tiers used when a lookback returns no useful content. */
const AUTO_LOOKBACK_TIERS = [DEFAULT_LOOKBACK_HOURS, 24 * 7, 24 * 30];
// Re-opens within this window are treated as the same "visit" — we keep the
// previous-visit timestamp so Chat Recap still has a meaningful cutoff.
const SAME_VISIT_MS = 30 * 60 * 1000;

function storeKey(scope_type: ChatScopeType, scope_id: string) {
  return `${scope_type}:${scope_id}`;
}

function readMap(key: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, map: Record<string, number>) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

/** Persist that the user just opened this thread. Call on mount. */
export function markChatOpened(scope_type: ChatScopeType, scope_id: string) {
  if (!scope_id) return;
  const k = storeKey(scope_type, scope_id);
  const lastMap = readMap(LAST_OPENED_KEY);
  const prevMap = readMap(PREV_OPENED_KEY);
  const now = Date.now();
  const prior = lastMap[k];
  // Only roll the previous-visit pointer forward when this is a distinct visit.
  if (prior && now - prior > SAME_VISIT_MS) {
    prevMap[k] = prior;
    writeMap(PREV_OPENED_KEY, prevMap);
  } else if (!prior) {
    // First ever open — leave prev empty so cutoff falls back to the 7-day floor.
  }
  lastMap[k] = now;
  writeMap(LAST_OPENED_KEY, lastMap);
}

/**
 * Returns the timestamp Chat Recap should treat as the user's previous visit.
 * Prefers the stored previous-visit marker (set when a new visit begins) and
 * falls back to the very first open we recorded. Exported so the global
 * cross-thread recap can reuse the same cutoff logic per scope.
 */
export function getCatchUpLastOpened(scope_type: ChatScopeType, scope_id: string): number | null {
  const k = storeKey(scope_type, scope_id);
  const prev = readMap(PREV_OPENED_KEY)[k];
  if (prev) return prev;
  const last = readMap(LAST_OPENED_KEY)[k];
  if (last) return last;
  return null;
}

function getLastOpened(scope_type: ChatScopeType, scope_id: string): number | null {
  return getCatchUpLastOpened(scope_type, scope_id);
}

function getDismissedFor(scope_type: ChatScopeType, scope_id: string): string | null {
  const map = readMap(DISMISSED_KEY) as unknown as Record<string, string>;
  return map[storeKey(scope_type, scope_id)] ?? null;
}

function setDismissedFor(scope_type: ChatScopeType, scope_id: string, marker: string) {
  const map = readMap(DISMISSED_KEY) as unknown as Record<string, string>;
  map[storeKey(scope_type, scope_id)] = marker;
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

interface UseChatCatchUpArgs {
  scope_type: ChatScopeType;
  scope_id: string | null | undefined;
  unreadCount?: number;
  /** Used to evaluate the "admin/coach broadcast generated multiple replies" trigger. */
  hasRecentBroadcastWithReplies?: boolean;
  /** When false, the inline card never shows (e.g. Pro gating not satisfied). */
  cardEnabled?: boolean;
  /** Identifier used to dedupe dismissal — usually latest message id. */
  latestMessageId?: string | null;
}

export function useChatCatchUp({
  scope_type,
  scope_id,
  unreadCount = 0,
  hasRecentBroadcastWithReplies = false,
  cardEnabled = true,
  latestMessageId = null,
}: UseChatCatchUpArgs) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChatSummaryResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dismissTick, setDismissTick] = useState(0);

  // Evaluate eligibility for the inline card.
  const eligible = useMemo(() => {
    if (!scope_id || !cardEnabled) return false;
    const dismissed = getDismissedFor(scope_type, scope_id);
    if (dismissed && latestMessageId && dismissed === latestMessageId) return false;

    if (unreadCount >= UNREAD_MIN) return true;
    if (hasRecentBroadcastWithReplies) return true;

    const lastOpened = getLastOpened(scope_type, scope_id);
    if (lastOpened === null) return false;
    const hours = (Date.now() - lastOpened) / (1000 * 60 * 60);
    return hours >= STALE_HOURS;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope_type, scope_id, unreadCount, hasRecentBroadcastWithReplies, cardEnabled, latestMessageId, dismissTick]);

  const summarize = useCallback(
    async (opts?: { force?: boolean; openSheet?: boolean; lookbackHours?: number }) => {
      if (!scope_id) return;
      const explicitLookback = opts?.lookbackHours;
      const isExplicit = explicitLookback != null;
      const tiers = isExplicit ? [explicitLookback] : AUTO_LOOKBACK_TIERS;
      const forceFresh = !!opts?.force || (isExplicit && explicitLookback !== DEFAULT_LOOKBACK_HOURS);

      setLoading(true);
      setError(null);
      if (forceFresh) setResult(null);
      if (opts?.openSheet) setSheetOpen(true);

      const parseErr = async (error: any): Promise<string> => {
        let code = "unknown";
        try {
          const ctx: any = (error as any).context;
          const resp: Response | undefined =
            ctx instanceof Response ? ctx : ctx?.response instanceof Response ? ctx.response : undefined;
          if (resp) {
            const j = await resp.clone().json().catch(() => null);
            if (j?.error) code = j.error;
          } else if (typeof ctx === "object" && ctx?.error) {
            code = String(ctx.error);
          }
        } catch { /* ignore */ }
        return code;
      };

      const fetchTier = async (hours: number, force: boolean): Promise<{ result: ChatSummaryResult | null; error: string | null }> => {
        const lastOpenedMs = getLastOpened(scope_type, scope_id);
        const last_opened_at = lastOpenedMs ? new Date(lastOpenedMs).toISOString() : null;
        const body: Record<string, unknown> = {
          scope_type,
          scope_id,
          force,
          last_opened_at,
          lookback_hours: hours,
        };

        try {
          if (scope_type === "team" || scope_type === "club" || scope_type === "group") {
            const { data: fast, error: fastErr } = await supabase.functions.invoke("assemble-catchup", { body });
            const fastCode = (fast as any)?.error as string | undefined;
            if (!fastErr && fast && !fastCode) {
              const fastResult = { ...(fast as ChatSummaryResult), lookback_hours: hours };
              if (hasUsefulRecapContent(fastResult)) {
                return { result: fastResult, error: null };
              }
            }
            if (fastErr) {
              const code = await parseErr(fastErr);
              if (code !== "digests_missing" && code !== "unknown") {
                return { result: null, error: code };
              }
            } else if (fastCode && fastCode !== "digests_missing") {
              return { result: null, error: fastCode };
            }
          }

          let fnName = "summarize-chat";
          try {
            const { data: prov } = await supabase
              .from("app_settings")
              .select("value")
              .eq("key", "ai_summary_provider")
              .maybeSingle();
            const v = (prov as any)?.value;
            const provider = typeof v === "string" ? v : (v ? String(v) : "gemini");
            if (provider === "icp" || provider === '"icp"') fnName = "summarize-chat-icp";
          } catch { /* default to gemini */ }
          const { data, error } = await supabase.functions.invoke(fnName, { body });
          if (error) return { result: null, error: await parseErr(error) };
          const llmCode = (data as any)?.error as string | undefined;
          if (llmCode) return { result: null, error: llmCode };
          return { result: { ...(data as ChatSummaryResult), lookback_hours: hours }, error: null };
        } catch (e: any) {
          return { result: null, error: e?.message ?? "unknown" };
        }
      };

      let finalResult: ChatSummaryResult | null = null;
      let finalError: string | null = null;

      for (let i = 0; i < tiers.length; i++) {
        const hours = tiers[i];
        const shouldForce = forceFresh || (!isExplicit && i > 0);
        const { result: tierResult, error: tierError } = await fetchTier(hours, shouldForce);

        if (tierError && tierError !== "no_messages" && tierError !== "digests_missing") {
          finalError = tierError;
          break;
        }

        finalResult = tierResult;
        finalError = tierError;

        if (tierResult && hasUsefulRecapContent(tierResult)) {
          break;
        }
      }

      setResult(finalResult);
      if (finalError) setError(finalError);
      setLoading(false);
    },
    [scope_type, scope_id],
  );

  const openSheet = useCallback(() => {
    setSheetOpen(true);
    if (!result && !loading) void summarize({ openSheet: true });
  }, [result, loading, summarize]);

  const dismissCard = useCallback(() => {
    if (!scope_id) return;
    setDismissedFor(scope_type, scope_id, latestMessageId ?? "dismissed");
    setDismissTick((n) => n + 1);
  }, [scope_type, scope_id, latestMessageId]);

  // Reset result if scope changes
  useEffect(() => {
    setResult(null);
    setError(null);
    setSheetOpen(false);
  }, [scope_type, scope_id]);

  return {
    eligible,
    loading,
    error,
    result,
    sheetOpen,
    setSheetOpen,
    summarize,
    openSheet,
    dismissCard,
  };
}
