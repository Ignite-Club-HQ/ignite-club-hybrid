import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles,
  CheckCircle2,
  ChevronRight,
  X,
  AlertCircle,
  RefreshCw,
  Inbox,
  Loader2,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import {
  getCatchUpLastOpened,
  DEFAULT_LOOKBACK_HOURS,
  type ChatScopeType,
  type ChatSummaryPayload,
  type ChatSummaryResult,
  type OutstandingAction,
  type OutstandingQuestion,
  normalizeQuestion,
} from "@/hooks/useChatCatchUp";
import { parseRecapTimeTag, parseRecapTagDate, stripRecapDatePrefix, isVagueRecapBullet } from "@/lib/recapFormat";

const GLOBAL_LOOKBACK_OPTIONS: { label: string; hours: number }[] = [
  { label: "Last 24h", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 30 days", hours: 24 * 30 },
];

export interface RecapScopeRef {
  scope_type: ChatScopeType;
  scope_id: string;
  name: string;
  link: string;
  unreadCount: number;
  typeLabel?: string;
}

interface GlobalChatRecapSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Conversations to recap (typically those with unread messages). */
  scopes: RecapScopeRef[];
}

interface PerScope {
  ref: RecapScopeRef;
  loading: boolean;
  error: string | null;
  result: ChatSummaryResult | null;
}

// Lower concurrency on native Android WebView: each in-flight edge-function
// invocation holds its response payload in memory, and 4-up parallelism while
// the user is on the recap sheet has caused white-screen crashes on lower-end
// devices. Web keeps the original 4-up batch size.
const CONCURRENCY = Capacitor.isNativePlatform() ? 2 : 4;


function priorityBadgeClasses(p: OutstandingAction["priority"]) {
  switch (p) {
    case "high":
      return "bg-rose-500/15 text-rose-600 dark:text-rose-400";
    case "low":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  }
}

async function parseInvokeError(error: any): Promise<string> {
  let code = "unknown";
  try {
    const ctx: any = error?.context;
    const r: Response | undefined =
      ctx instanceof Response ? ctx : ctx?.response instanceof Response ? ctx.response : undefined;
    if (r) {
      const j = await r.clone().json().catch(() => null);
      if (j?.error) code = String(j.error);
    } else if (typeof ctx === "object" && ctx?.error) {
      code = String(ctx.error);
    }
  } catch { /* ignore */ }
  return code;
}

async function getLLMFnName(): Promise<string> {
  try {
    const { data: prov } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ai_summary_provider")
      .maybeSingle();
    const v = (prov as any)?.value;
    const provider = typeof v === "string" ? v : (v ? String(v) : "gemini");
    if (provider === "icp" || provider === '"icp"') return "summarize-chat-icp";
  } catch { /* default to gemini */ }
  return "summarize-chat";
}

async function fetchOne(ref: RecapScopeRef, lookbackHours: number): Promise<{ result: ChatSummaryResult | null; error: string | null }> {
  const lastOpenedMs = getCatchUpLastOpened(ref.scope_type, ref.scope_id);
  const last_opened_at = lastOpenedMs ? new Date(lastOpenedMs).toISOString() : null;
  const body: Record<string, unknown> = {
    scope_type: ref.scope_type,
    scope_id: ref.scope_id,
    last_opened_at,
    lookback_hours: lookbackHours,
  };
  try {
    // assemble-catchup supports team / club / group only. For DMs and admin
    // groups go straight to the LLM summariser so users get a real recap
    // instead of "Open the thread to see new messages."
    const supportsDigest = ref.scope_type === "team" || ref.scope_type === "club" || ref.scope_type === "group";
    if (supportsDigest) {
      const { data, error } = await supabase.functions.invoke("assemble-catchup", { body });
      const fastCode = (data as any)?.error as string | undefined;
      if (!error && data && !fastCode) {
        return { result: data as ChatSummaryResult, error: null };
      }
      const code = error ? await parseInvokeError(error) : (fastCode ?? "unknown");
      if (code !== "digests_missing" && code !== "unknown") {
        return { result: null, error: code };
      }
      // fall through to LLM
    }
    const fnName = await getLLMFnName();
    const { data: llmData, error: llmErr } = await supabase.functions.invoke(fnName, { body });
    if (llmErr) return { result: null, error: await parseInvokeError(llmErr) };
    const llmCode = (llmData as any)?.error as string | undefined;
    if (llmCode) return { result: null, error: llmCode };
    return { result: llmData as ChatSummaryResult, error: null };
  } catch (e: any) {
    return { result: null, error: e?.message || "unknown" };
  }
}

export interface TimelineEntry { time: string | null; text: string }

function parseTimelineTimestamp(time: string | null | undefined, text?: string): number {
  // Cap to end-of-today: a recap groups messages by when they were SENT, not
  // by dates referenced inside the message ("this Saturday", "next week").
  // The LLM occasionally tags a bullet with a future date that came from the
  // message body — clamp those out so the bullet falls back to today's bucket.
  const endOfToday = (() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
  })();

  const fromTag = (() => {
    if (!time) return 0;
    const d = parseRecapTagDate(time);
    if (!d) return 0;
    const clock = time.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (clock) {
      let hours = Number(clock[1]);
      const minutes = Number(clock[2] ?? 0);
      const meridiem = clock[3].toLowerCase();
      if (meridiem === "pm" && hours !== 12) hours += 12;
      if (meridiem === "am" && hours === 12) hours = 0;
      d.setHours(hours, minutes, 0, 0);
    }
    return d.getTime();
  })();
  if (fromTag && fromTag <= endOfToday) return fromTag;

  // No reliable send-date — bucket as "today" rather than dropping the bullet
  // or labelling it with a future date pulled from the message body.
  return endOfToday;
}

function timelineDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function normalise(summary: ChatSummaryPayload | undefined) {
  if (!summary) return { actions: [] as OutstandingAction[], questions: [] as OutstandingQuestion[], headline: "", details: [] as TimelineEntry[] };
  const actions: OutstandingAction[] = (summary.outstanding_actions ??
    (summary.actions_needed ?? []).map((t) => ({ text: t, owner: null, priority: "medium" as const })))
    .map((a) => ({ ...a, text: stripRecapDatePrefix(a.text) }))
    .filter((a) => !isVagueRecapBullet(a.text));
  const questions: OutstandingQuestion[] = (summary.outstanding_questions ?? summary.unanswered_questions ?? []).map(normalizeQuestion);
  // Build a chronological-ish timeline. Each bullet's leading [time] tag is
  // parsed out so the UI can render it as a chip next to the bullet.
  const details: TimelineEntry[] = [];
  const seen = new Set<string>();
  const push = (arr?: string[] | null) => {
    if (!arr) return;
    for (const raw of arr) {
      const s = (raw ?? "").toString().trim();
      if (!s) continue;
      const parsed = parseRecapTimeTag(s);
      const clean = parsed.text || stripRecapDatePrefix(s);
      if (!clean || seen.has(clean)) continue;
      if (isVagueRecapBullet(clean)) continue;
      seen.add(clean);
      details.push({ time: parsed.time, text: clean });
    }
  };
  push(summary.since_last_visit?.today);
  push(summary.since_last_visit?.yesterday);
  push(summary.detailed?.schedule_changes);
  push(summary.schedule_changes);
  push(summary.detailed?.discussion);
  push(summary.since_last_visit?.earlier);
  push(summary.detailed?.files_shared);
  push(summary.files_shared);
  push(summary.important_updates);
  details.sort((a, b) => parseTimelineTimestamp(b.time, b.text) - parseTimelineTimestamp(a.time, a.text));
  return { actions, questions, headline: stripRecapDatePrefix(summary.headline ?? ""), details };
}

export function GlobalChatRecapSheet({ open, onOpenChange, scopes }: GlobalChatRecapSheetProps) {
  const [perScope, setPerScope] = useState<PerScope[]>([]);
  const [runId, setRunId] = useState(0);
  const [myNames, setMyNames] = useState<string[]>([]);
  const [lookbackHours, setLookbackHours] = useState<number>(DEFAULT_LOOKBACK_HOURS);

  // Reset to the default window whenever the sheet is closed so the next open
  // starts fresh on the last 24 hours.
  useEffect(() => {
    if (!open) setLookbackHours(DEFAULT_LOOKBACK_HOURS);
  }, [open]);

  // Resolve the current user's name tokens so "Needs your attention" can be
  // filtered to actions actually assigned to *you* (or unassigned), not to
  // other people in the thread.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) return;
        const { data: prof } = await supabase
          .from("profiles")
          .select("display_name, first_name")
          .eq("id", uid)
          .maybeSingle();
        if (cancelled) return;
        const tokens = new Set<string>();
        const push = (v: string | null | undefined) => {
          if (!v) return;
          const t = v.trim().toLowerCase();
          if (t) tokens.add(t);
          const first = t.split(/\s+/)[0];
          if (first) tokens.add(first);
        };
        push((prof as any)?.display_name);
        push((prof as any)?.first_name);
        setMyNames(Array.from(tokens));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Kick off batched fetches whenever the sheet opens with a fresh set of scopes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const initial: PerScope[] = scopes.map((ref) => ({ ref, loading: true, error: null, result: null }));
    setPerScope(initial);

    (async () => {
      let cursor = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, scopes.length) }, async () => {
        while (!cancelled) {
          const idx = cursor++;
          if (idx >= scopes.length) return;
          const ref = scopes[idx];
          const { result, error } = await fetchOne(ref, lookbackHours);
          if (cancelled) return;
          setPerScope((prev) => {
            const next = prev.slice();
            next[idx] = { ref, loading: false, result, error };
            return next;
          });
        }
      });
      await Promise.all(workers);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runId, lookbackHours]);

  const totalLoading = perScope.filter((p) => p.loading).length;
  const completed = perScope.length - totalLoading;

  const GENERIC_GROUP = new Set(["everyone", "all", "team", "club", "we", "us", "parents", "players", "members", "anyone"]);
  const GENERIC_YOU = new Set(["you", "me", "self", "your", "yours"]);

  const nameMatchesMe = (name: string): boolean => {
    const o = name.trim().toLowerCase();
    if (!o) return false;
    if (GENERIC_YOU.has(o)) return true;
    if (myNames.length === 0) return false;
    return myNames.some((n) => n.length >= 2 && (o === n || o.split(/\s+/)[0] === n));
  };

  // Extract a leading "Name(s) to ..." pattern from the action text — the LLM
  // often puts owners in the sentence rather than the owner field.
  const inferOwnersFromText = (text: string): string[] | null => {
    const m = text.match(/^\s*([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)?(?:\s*(?:,|&|and)\s*[A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+)?)*)\s+(?:to|will|should|needs? to|is going to|are going to)\b/);
    if (!m) return null;
    return m[1].split(/\s*(?:,|&|and)\s*/).map((s) => s.trim()).filter(Boolean);
  };

  // Strict: only surface actions the *current user* is specifically asked to do.
  // Generic group references (everyone/team/all) and unassigned items DO NOT count.
  const isMine = (action: OutstandingAction): boolean => {
    const text = action.text ?? "";
    const lower = text.toLowerCase();

    // 1. Explicit owner field.
    if (action.owner && action.owner.trim()) {
      const o = action.owner.trim().toLowerCase();
      if (GENERIC_GROUP.has(o)) return false;
      return nameMatchesMe(action.owner);
    }

    // 2. @mention of me.
    for (const n of myNames) {
      if (n.length >= 2 && new RegExp(`@${n}\\b`, "i").test(text)) return true;
    }

    // 3. Leading "Name to ..." pattern — must include me.
    const inferred = inferOwnersFromText(text);
    if (inferred && inferred.length > 0) {
      return inferred.some((o) => {
        const lo = o.toLowerCase();
        if (GENERIC_GROUP.has(lo)) return false;
        return nameMatchesMe(o);
      });
    }

    // 4. Direct second-person address to the reader.
    if (/\byou(?:'re| are| need| should| must| can| have to| will)\b/i.test(lower)) return true;
    if (/\b(?:your)\s+(?:turn|action|input|response|reply|confirmation|approval)\b/i.test(lower)) return true;
    if (/^\s*please\b/i.test(lower)) return true;

    // 5. Otherwise: not specifically directed at me.
    return false;
  };

  const aggregated = useMemo(() => {
    const actions: Array<{ scope: RecapScopeRef; action: OutstandingAction }> = [];
    const questions: Array<{ scope: RecapScopeRef; text: string; date?: string }> = [];
    const overviews: Array<{ scope: RecapScopeRef; headline: string; details: TimelineEntry[] }> = [];
    for (const p of perScope) {
      if (!p.result) continue;
      const n = normalise(p.result.summary);
      if (n.headline || n.details.length > 0) {
        overviews.push({ scope: p.ref, headline: n.headline, details: n.details.slice(0, 6) });
      }
      n.actions.forEach((a) => {
        if (isMine(a)) actions.push({ scope: p.ref, action: a });
      });
      // Only surface questions when the backend actually scoped to the unread
      // window. If it fell back to the 7-day floor (no last_opened_at cutoff),
      // the "questions" may be ancient and not from unread messages — skip
      // them to match the per-thread behaviour.
      const usedFallback = !!(p.result as any).used_fallback;
      if (!usedFallback) {
        n.questions.forEach((q) => questions.push({ scope: p.ref, text: q.text, date: q.date }));
      }
    }
    const rank = (p: OutstandingAction["priority"]) => (p === "high" ? 0 : p === "low" ? 2 : 1);
    actions.sort((a, b) => rank(a.action.priority) - rank(b.action.priority));
    overviews.sort((a, b) => {
      const latest = (items: TimelineEntry[]) => Math.max(0, ...items.map((item) => parseTimelineTimestamp(item.time, item.text)));
      return latest(b.details) - latest(a.details);
    });
    return { actions, questions, overviews };
  }, [perScope, myNames]);

  const allEmpty =
    !totalLoading &&
    perScope.length > 0 &&
    perScope.every((p) => {
      const n = normalise(p.result?.summary);
      return n.actions.length === 0 && n.questions.length === 0 && !n.headline;
    });

  // Auto-escalate lookback when every scope is empty (and no blocking errors).
  useEffect(() => {
    if (totalLoading > 0) return;
    if (perScope.length === 0) return;
    const hasBlockingError = perScope.some(
      (p) => p.error && p.error !== "no_messages" && p.error !== "digests_missing"
    );
    if (hasBlockingError) return;
    if (!allEmpty) return;
    const tierHours = GLOBAL_LOOKBACK_OPTIONS.map((o) => o.hours);
    const idx = tierHours.indexOf(lookbackHours);
    if (idx >= 0 && idx < tierHours.length - 1) {
      setLookbackHours(tierHours[idx + 1]);
    }
  }, [totalLoading, perScope, allEmpty, lookbackHours]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[88vh] flex flex-col rounded-t-2xl px-0 pb-0">
        <SheetHeader className="relative px-4 pt-1 text-left">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-8 w-8 text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </Button>
          <SheetTitle className="flex items-center gap-2.5 text-2xl font-semibold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </span>
            Recap all chats
          </SheetTitle>
          <p className="text-sm text-muted-foreground">
            {(() => {
              const windowLabel =
                lookbackHours === 24
                  ? "the last 24 hours"
                  : lookbackHours % 24 === 0
                    ? `the last ${lookbackHours / 24} days`
                    : `the last ${lookbackHours} hours`;
              if (scopes.length === 0) return "You're all caught up.";
              if (totalLoading > 0) {
                return `Summarising ${completed} of ${scopes.length} thread${scopes.length === 1 ? "" : "s"} from ${windowLabel}…`;
              }
              return `Summarised ${scopes.length} thread${scopes.length === 1 ? "" : "s"} from ${windowLabel}.`;
            })()}
          </p>
          {scopes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {GLOBAL_LOOKBACK_OPTIONS.map((opt) => {
                const active = lookbackHours === opt.hours;
                return (
                  <Button
                    key={opt.hours}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-7 text-xs"
                    disabled={totalLoading > 0 || active}
                    onClick={() => setLookbackHours(opt.hours)}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
          )}
        </SheetHeader>

        <div className="px-4 pt-3 pb-6 overflow-y-auto flex-1 min-h-0">
          {scopes.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/60 mb-3" />
              <p className="text-base font-medium text-foreground">No unread chats</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Open a thread directly and use Chat Recap inside it for a deeper summary.
              </p>
            </div>
          )}

          {scopes.length > 0 && totalLoading > 0 && (
            <div className="py-6">
              <div className="mb-4 flex items-center gap-3">
                <div className="relative h-5 w-5 shrink-0">
                  <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
                  <Sparkles className="relative h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    Reading your latest messages…
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Summarised {completed} of {scopes.length} · {totalLoading} to go
                  </p>
                </div>
              </div>
              <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-500"
                  style={{ width: `${scopes.length === 0 ? 0 : (completed / scopes.length) * 100}%` }}
                />
              </div>
              <ul className="space-y-2">
                {perScope.map((p) => (
                  <li
                    key={`${p.ref.scope_type}-${p.ref.scope_id}`}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
                  >
                    {p.loading ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    ) : p.error ? (
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    )}
                    <span className="truncate text-sm text-foreground">{p.ref.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {scopes.length > 0 && totalLoading === 0 && (
            <>
              {/* Cross-thread overview: headline + key detail bullets per thread */}
              {aggregated.overviews.length > 0 && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <p className="text-base font-semibold text-muted-foreground">
                      Across your chats
                    </p>
                  </div>
                  <ul className="space-y-3.5">
                    {aggregated.overviews.map(({ scope, headline, details }, i) => (
                      <li key={`${scope.scope_id}-h-${i}`} className="border-l-2 border-border pl-3">
                        <p className="text-base font-semibold text-foreground">{scope.name}</p>
                        {headline && (
                          <p className="mt-0.5 text-base leading-snug text-muted-foreground">{headline}</p>
                        )}
                        {details.length > 0 && (() => {
                          const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
                          const MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                          const dayGroups: { label: string; ts: number; items: TimelineEntry[] }[] = [];
                          const idx = new Map<string, number>();
                          for (const d of details) {
                            const ts = parseTimelineTimestamp(d.time, d.text);
                            if (!ts) continue; // drop undated items
                            const key = `d:${timelineDayKey(ts)}`;
                            const dt = new Date(ts);
                            dt.setHours(0, 0, 0, 0);
                            const label = `${WD[dt.getDay()]} ${dt.getDate()} ${MO[dt.getMonth()]}`;
                            const existing = idx.get(key);
                            if (existing != null) {
                              dayGroups[existing].items.push(d);
                            } else {
                              idx.set(key, dayGroups.length);
                              dayGroups.push({ label, ts: dt.getTime(), items: [d] });
                            }
                          }
                          dayGroups.sort((a, b) => b.ts - a.ts);
                          if (dayGroups.length === 0) return null;
                          return (
                            <div className="mt-2 space-y-3">
                              {dayGroups.map((g, gi) => (
                                <div key={`${scope.scope_id}-g-${i}-${gi}`}>
                                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                                  <ul className="space-y-2 border-l border-border/70 pl-3">
                                    {g.items.map((d, j) => (
                                      <li
                                        key={`${scope.scope_id}-d-${i}-${gi}-${j}`}
                                        className="text-base leading-snug text-foreground"
                                      >
                                        {d.text}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                        <Link
                          to={scope.link}
                          onClick={() => onOpenChange(false)}
                          className="mt-1.5 inline-flex items-center text-xs text-muted-foreground hover:text-primary"
                        >
                          Open {scope.name}
                          <ChevronRight className="h-3 w-3" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}


              {/* Roll-up: outstanding actions across all threads */}
              {aggregated.actions.length > 0 && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <p className="text-base font-semibold text-muted-foreground">
                      Needs your attention
                    </p>
                  </div>
                  <ul className="space-y-3">
                    {aggregated.actions.slice(0, 8).map(({ scope, action }, i) => (
                      <li key={`${scope.scope_id}-a-${i}`} className="flex items-start gap-3">
                        <span className={`mt-[0.15em] w-14 shrink-0 rounded-md px-1.5 py-0.5 text-center text-xs font-semibold ${priorityBadgeClasses(action.priority)}`}>
                          {action.priority === "high" ? "High" : action.priority === "low" ? "Low" : "Medium"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-medium leading-relaxed text-foreground">{action.text}</p>
                          <Link
                            to={scope.link}
                            onClick={() => onOpenChange(false)}
                            className="mt-0.5 inline-flex items-center text-xs text-muted-foreground hover:text-primary"
                          >
                            {scope.name}
                            <ChevronRight className="h-3 w-3" />
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Open questions section removed — folded into per-thread details for richer context */}

              {/* Per-thread cards */}
              <div className="mb-2 mt-4 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  By thread
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setRunId((n) => n + 1)}
                  disabled={totalLoading > 0}
                >
                  <RefreshCw className="h-3 w-3" />
                  Refresh
                </Button>
              </div>

              <div className="space-y-2">
                {perScope.map((p) => (
                  <ThreadCard key={`${p.ref.scope_type}-${p.ref.scope_id}`} item={p} onOpen={() => onOpenChange(false)} />
                ))}
              </div>

              {allEmpty && (
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  Nothing urgent in your unread threads.
                </p>
              )}
            </>
          )}

          <p className="mt-4 text-xs text-muted-foreground/70">
            AI summaries can make mistakes. Check key details before acting.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ThreadCard({ item, onOpen }: { item: PerScope; onOpen: () => void }) {
  const { ref, loading, error, result } = item;
  const n = normalise(result?.summary);

  return (
    <Link
      to={ref.link}
      onClick={onOpen}
      className="block rounded-xl border border-border bg-card p-3 transition active:scale-[0.99] hover:border-primary/40"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{ref.name}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ref.unreadCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {ref.unreadCount > 99 ? "99+" : ref.unreadCount}
            </span>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {loading && (
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}

      {!loading && error && error !== "unsupported" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
          {error === "digests_missing"
            ? "Recap not ready for this thread yet."
            : error === "sensitive_content"
              ? "Sensitive content — read directly."
              : error === "no_messages"
                ? "No recent messages."
                : "Couldn't summarise this thread."}
        </p>
      )}

      {!loading && error === "unsupported" && (
        <p className="text-xs text-muted-foreground">Open the thread to see new messages.</p>
      )}

      {!loading && !error && result && (
        <>
          {n.headline && <p className="text-sm leading-snug text-foreground">{n.headline}</p>}
          {n.actions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                {n.actions.length} action{n.actions.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
        </>
      )}
    </Link>
  );
}
