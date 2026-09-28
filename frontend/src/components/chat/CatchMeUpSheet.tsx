import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sparkles,
  AlertCircle,
  CheckCircle2,
  CalendarClock,
  Paperclip,
  RefreshCw,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Pin,
  Loader2,
  X,
} from "lucide-react";
import type { ChatSummaryResult, OutstandingAction, OutstandingQuestion } from "@/hooks/useChatCatchUp";
import { normalizeQuestion } from "@/hooks/useChatCatchUp";
import { parseRecapTimeTag, parseRecapTagDate, stripRecapDatePrefix, isVagueRecapBullet } from "@/lib/recapFormat";
import { scheduleTypewriter } from "@/lib/typewriterScheduler";


/**
 * Static-reveal mode skips per-character typewriter animation entirely.
 * Previously we forced this on every native build because running many
 * concurrent setInterval-driven typewriters crashed Android WebView. The
 * crash was actually driven by interval count + payload size, not animation
 * itself, so we now only opt-in to static mode when the user prefers
 * reduced motion. Native cadence is tuned slower below (see CHAR_MS) to
 * keep main-thread work modest while still showing the typewriter effect.
 */
function useStaticReveal(): boolean {
  const computeStatic = () => {
    if (typeof window === "undefined") return true;
    try {
      const osPref = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      const userPref = document.documentElement.classList.contains("rm");
      return osPref || userPref;
    } catch { return false; }
  };
  const [staticMode, setStaticMode] = useState<boolean>(computeStatic);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const recompute = () => setStaticMode(computeStatic());
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener?.("change", recompute);
      // Observe class changes on <html> so user toggle is honoured live.
      const mo = new MutationObserver(recompute);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      return () => {
        mq.removeEventListener?.("change", recompute);
        mo.disconnect();
      };
    } catch { /* ignore */ }
  }, []);
  return staticMode;
}




const LOADING_STAGES = [
  "Reading recent messages…",
  "Sorting by when they arrived…",
  "Pulling out actions & questions…",
  "Polishing the summary…",
];

function useLoadingStage(active: boolean) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!active) { setStage(0); return; }
    const id = setInterval(() => setStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1)), 1800);
    return () => clearInterval(id);
  }, [active]);
  return stage;
}

interface CatchMeUpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  result: ChatSummaryResult | null;
  unreadCount: number;
  onRegenerate: () => void;
  onLookback?: (hours: number) => void;
  onUpgrade?: () => void;
}

const LOOKBACK_OPTIONS: { label: string; hours: number }[] = [
  { label: "Last 24h", hours: 24 },
  { label: "Last 7 days", hours: 24 * 7 },
  { label: "Last 30 days", hours: 24 * 30 },
];

function cleanHeadline(text: string | null | undefined): string {
  const cleaned = stripRecapDatePrefix(text ?? "").trim();
  return /nothing actionable|casual chat/i.test(cleaned) ? "" : cleaned;
}

function formatLookbackLabel(hours: number): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1 ? "last 24 hours" : `last ${days} days`;
  }
  return `last ${hours} hours`;
}

function formatSinceLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "just now";
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
}

interface RecapTimelineItem { time: string | null; text: string }

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WD_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function endOfTodayTs(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function timelineSendTimestamp(time: string | null | undefined): number {
  const fallback = endOfTodayTs();
  if (!time) return fallback;
  const d = parseRecapTagDate(time);
  if (!d) return fallback;
  const clock = time.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (clock) {
    let hours = Number(clock[1]);
    const minutes = Number(clock[2] ?? 0);
    const meridiem = clock[3].toLowerCase();
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    d.setHours(hours, minutes, 0, 0);
  }
  const ts = d.getTime();
  // Future tags are usually event dates copied from the message body, not the
  // actual send date. Keep those in today's activity bucket instead of showing
  // misleading future headers such as "Sat 4 Jul".
  return ts > fallback ? fallback : ts;
}

function localDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function errorMessage(code: string | null): { title: string; body: string; isPro?: boolean; isSensitive?: boolean } {
  switch (code) {
    case "pro_required":
      return {
        title: "Pro feature",
        body: "AI ‘Chat Recap’ summaries are available on Pro clubs. Upgrade to unlock instant recap for your members.",
        isPro: true,
      };
    case "feature_disabled":
      return { title: "Turned off for this club", body: "An admin has disabled AI ‘Chat Recap’ for this club. Ask a club admin to re-enable it in club settings." };
    case "disclosure_required":
      return { title: "One-time acknowledgement needed", body: "Please accept the AI privacy notice to use Chat Recap." };
    case "rate_limited":
      return { title: "Slow down", body: "Too many summary requests just now. Please try again in a minute." };
    case "credits_exhausted":
      return { title: "AI temporarily unavailable", body: "Our AI provider has run out of credits. Please try again later." };
    case "no_messages":
      return { title: "Nothing to summarise", body: "There aren’t any recent messages in this chat yet." };
    case "fetch_failed":
      return { title: "Couldn’t read messages", body: "We couldn’t load the recent messages for this chat. Check your connection and try again." };
    case "ai_not_configured":
      return { title: "AI not configured", body: "The AI provider isn’t set up yet. Ask an app admin to add the required API key." };
    case "ai_failed":
      return { title: "AI service unreachable", body: "We couldn’t reach the AI service. This usually clears up in a minute — please try again." };
    case "ai_timeout":
      return { title: "AI took too long", body: "The on-chain AI model timed out on this thread (long threads can exceed its window). Tap Regenerate to retry, or ask an app admin to switch the AI provider to Gemini in App Settings for faster results." };
    case "ai_invalid_output":
      return { title: "AI returned an unreadable summary", body: "The AI didn’t return valid output for this thread (often happens on very long or sparse chats). Try Regenerate, or ask an app admin to switch the AI provider in App Settings." };
    case "sensitive_content":
      return {
        title: "Summary blocked",
        body: "This thread contains sensitive content (medical, safeguarding or disciplinary). For privacy we don’t send these messages to AI — please read them directly.",
        isSensitive: true,
      };
    case "server_error":
      return { title: "Something went wrong", body: "An unexpected error occurred while preparing your summary. Please try again." };
    default:
      return { title: "Couldn’t generate summary", body: "Something went wrong while preparing your summary. Please try again, or switch providers in App Settings if it keeps happening." };
  }
}

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

export function CatchMeUpSheet({
  open, onOpenChange, loading, error, result, unreadCount, onRegenerate, onLookback, onUpgrade,
}: CatchMeUpSheetProps) {
  const err = error ? errorMessage(error) : null;
  const [showDetailed, setShowDetailed] = useState(false);
  const staticMode = useStaticReveal();
  const loadingStage = useLoadingStage(loading && !result);
  const [pendingLookback, setPendingLookback] = useState<number | null>(null);
  useEffect(() => {
    if (!loading) setPendingLookback(null);
  }, [loading, result]);


  // Increment on each open so Typed/Reveal components remount and replay the
  // typewriter — critical when the result was cached/pre-fetched, where the
  // sheet pops open with `result` already populated and would otherwise reuse
  // the previous mount's "fully typed" state. Also offsets the start of typing
  // so it doesn't run while the sheet is still sliding in.
  const [openKey, setOpenKey] = useState(0);
  useEffect(() => {
    if (open) setOpenKey((k) => k + 1);
  }, [open]);

  // Normalise to new schema (handle legacy cached summaries from previous version).
  const view = useMemo(() => {
    if (!result) return null;
    const s = result.summary;
    const clean = (arr?: string[] | null) => (arr ?? []).map(stripRecapDatePrefix).filter((t) => !isVagueRecapBullet(t));
    const since = {
      today: clean(s.since_last_visit?.today),
      yesterday: clean(s.since_last_visit?.yesterday),
      earlier: clean(s.since_last_visit?.earlier),
    };
    const sinceTimeline: RecapTimelineItem[] = [];
    const seenSince = new Set<string>();
    const pushSince = (arr?: string[] | null) => {
      for (const raw of arr ?? []) {
        const parsed = parseRecapTimeTag(raw);
        const text = parsed.text || stripRecapDatePrefix(raw);
        if (!text || seenSince.has(text)) continue;
        if (isVagueRecapBullet(text)) continue;
        seenSince.add(text);
        sinceTimeline.push({ time: parsed.time, text });
      }
    };
    pushSince(s.since_last_visit?.today);
    pushSince(s.since_last_visit?.yesterday);
    pushSince(s.since_last_visit?.earlier);
    if (!s.since_last_visit) {
      since.today = (s.important_updates?.slice(0, 3) ?? []).map(stripRecapDatePrefix).filter((t) => !isVagueRecapBullet(t));
    }
    // Build the set of dates that appear in the recent activity timeline so
    // we can drop any "outstanding action" that is anchored to an older date
    // (the LLM sometimes carries forward asks from the past week).
    const stripTimeForDate = (t?: string | null) =>
      (t ?? "").replace(/\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*$/i, "").trim();
    const recentDates = new Set<string>();
    for (const item of sinceTimeline) {
      const d = stripTimeForDate(item.time);
      if (d) recentDates.add(d.toLowerCase());
    }
    const actions: OutstandingAction[] = (s.outstanding_actions
      ?? (s.actions_needed ?? []).map((t) => ({ text: t, owner: null, priority: "medium" as const })))
      .map((a) => {
        const parsed = parseRecapTimeTag(a.text);
        return { ...a, text: stripRecapDatePrefix(parsed.text || a.text), _time: parsed.time };
      })
      .filter((a) => !isVagueRecapBullet(a.text))
      .filter((a) => {
        // Keep actions with no time anchor (assumed current) OR whose date is
        // part of the recent activity window. Drop anything older.
        const d = stripTimeForDate((a as { _time?: string | null })._time).toLowerCase();
        if (!d) return true;
        if (recentDates.size === 0) return true;
        return recentDates.has(d);
      })
      .map(({ _time, ...rest }: OutstandingAction & { _time?: string | null }) => rest);
    const questions: OutstandingQuestion[] = (s.outstanding_questions ?? s.unanswered_questions ?? []).map(normalizeQuestion);
    const detailedRaw = s.detailed ?? {
      schedule_changes: s.schedule_changes ?? [],
      files_shared: s.files_shared ?? [],
      discussion: s.important_updates ?? [],
    };
    let detailed = {
      schedule_changes: clean(detailedRaw.schedule_changes),
      files_shared: clean(detailedRaw.files_shared),
      discussion: clean(detailedRaw.discussion),
    };
    let detailedHasAny =
      detailed.schedule_changes.length + detailed.files_shared.length + detailed.discussion.length > 0;

    // Fallback: when the model didn't return a since_last_visit timeline but
    // we DO have detailed bullets, synthesize the activity feed from those so
    // users always see a narrative timeline rather than just Outstanding actions.
    const usedDetailedFallback = sinceTimeline.length === 0 && detailedHasAny;
    if (usedDetailedFallback) {
      const pushDetailed = (arr: string[]) => {
        for (const raw of arr) {
          const parsed = parseRecapTimeTag(raw);
          const text = parsed.text || stripRecapDatePrefix(raw);
          if (!text || seenSince.has(text)) continue;
          if (isVagueRecapBullet(text)) continue;
          seenSince.add(text);
          sinceTimeline.push({ time: parsed.time, text });
        }
      };
      pushDetailed(detailed.schedule_changes);
      pushDetailed(detailed.discussion);
      pushDetailed(detailed.files_shared);
    }

    // Dedupe detailed bullets against the timeline so the "View detailed
    // summary" section adds depth, not a re-statement of what's above. Skip
    // when timeline was synthesized FROM detailed (fallback) — there'd be
    // nothing left to show.
    if (!usedDetailedFallback && sinceTimeline.length > 0) {
      const sigWords = (str: string) =>
        str.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3);
      const timelineSigs = sinceTimeline.map((i) => new Set(sigWords(i.text)));
      const isDupOfTimeline = (text: string) => {
        const ws = sigWords(stripRecapDatePrefix(text));
        if (ws.length === 0) return false;
        return timelineSigs.some((ts) => {
          const overlap = ws.filter((w) => ts.has(w)).length;
          return overlap / ws.length >= 0.6;
        });
      };
      const dedup = (arr: string[]) => arr.filter((t) => !isDupOfTimeline(t));
      detailed = {
        schedule_changes: dedup(detailed.schedule_changes),
        files_shared: dedup(detailed.files_shared),
        discussion: dedup(detailed.discussion),
      };
      detailedHasAny =
        detailed.schedule_changes.length + detailed.files_shared.length + detailed.discussion.length > 0;
    }

    // Sort by message send tag only. Do not infer timeline dates from words in
    // the summary body, because phrases like "this Saturday" describe an event,
    // not when the message was sent.
    sinceTimeline.sort((a, b) => timelineSendTimestamp(b.time) - timelineSendTimestamp(a.time));

    const sinceHasAny = sinceTimeline.length > 0 || since.today.length + since.yesterday.length + since.earlier.length > 0;
    const anythingAtAll = sinceHasAny || actions.length > 0 || questions.length > 0 || detailedHasAny;
    return { headline: cleanHeadline(s.headline), since, sinceTimeline, actions, questions, detailed, detailedHasAny, sinceHasAny, anythingAtAll };
  }, [result]);

  // Auto-expand the detailed summary when there is no top-level activity feed
  // to show, otherwise users only see Outstanding actions with no narrative.
  useEffect(() => {
    if (view && view.detailedHasAny && !view.sinceHasAny) {
      setShowDetailed(true);
    }
  }, [view?.detailedHasAny, view?.sinceHasAny]);

  // Sequential top-to-bottom typing: each line waits for all previous lines to
  // finish typing before it starts. We compute the cumulative delay per line
  // from the running character total + a small gap between lines.
  // In staticMode (native / reduced motion) we collapse all delays to 0 so
  // every Typed/Reveal renders instantly — no per-character setInterval storm.
  // Native cadence is a touch slower to keep Android WebView main-thread
  // work modest while still showing the typewriter; web stays snappy.
  const isNative = Capacitor.isNativePlatform();
  const CHAR_MS = staticMode ? 0 : (isNative ? 22 : 16);
  const GAP_MS = staticMode ? 0 : 120;
  const HEADER_REVEAL_MS = staticMode ? 0 : 220;
  // Sheet slide-in is ~300ms; buffer the first character so typing is visible
  // even when results were cached and the sheet opens with content ready.
  const OPEN_BUFFER_MS = staticMode ? 0 : 320;

  const delayRef = useRef(0);
  delayRef.current = OPEN_BUFFER_MS;
  const scheduleType = (text: string) => {
    if (staticMode) return 0;
    const start = delayRef.current;
    delayRef.current = start + text.length * CHAR_MS + GAP_MS;
    return start;
  };
  const scheduleReveal = (ms: number = HEADER_REVEAL_MS) => {
    if (staticMode) return 0;
    const start = delayRef.current;
    delayRef.current = start + ms;
    return start;
  };



  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" hideCloseButton className="max-h-[85vh] flex flex-col rounded-t-2xl px-0 pb-0">
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
            Chat Recap
            {unreadCount > 0 && (
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {unreadCount} unread
              </span>
            )}
          </SheetTitle>
          {onLookback && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {LOOKBACK_OPTIONS.map((opt) => {
                const currentHours = pendingLookback ?? result?.lookback_hours ?? 24;
                const active = currentHours === opt.hours;
                return (
                  <Button
                    key={opt.hours}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-7 text-xs"
                    disabled={loading || active}
                    onClick={() => {
                      setPendingLookback(opt.hours);
                      onLookback(opt.hours);
                    }}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
          )}
        </SheetHeader>


        <div className="px-4 pt-2 pb-6 overflow-y-auto flex-1 min-h-0" key={openKey}>
          {loading && !result && (
            <LoadingTypewriter stage={loadingStage} staticMode={staticMode} />
          )}


          {!loading && err && (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-semibold">{err.title}</p>
              </div>
              <p className="text-sm text-muted-foreground">{err.body}</p>
              <div className="mt-3 flex gap-2">
                {err.isPro && onUpgrade && <Button size="sm" onClick={onUpgrade}>Upgrade to Pro</Button>}
                {!err.isPro && !err.isSensitive && (
                  <Button size="sm" variant="secondary" onClick={onRegenerate}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Try again
                  </Button>
                )}
              </div>
            </div>
          )}

          {!loading && !err && view && (
            <>
              {view.headline && (
                <p className="mb-3 text-base font-normal leading-relaxed text-foreground">
                  <Typed text={view.headline} delayMs={scheduleType(view.headline)} charMs={CHAR_MS} />
                </p>
              )}

              {/* Recent activity / Since your last visit — timeline-style activity feed */}
              {view.sinceHasAny && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <Reveal delayMs={scheduleReveal()} className="mb-3 flex items-center gap-2">
                    <Pin className="h-4 w-4 text-primary" />
                    <p className="text-base font-semibold text-muted-foreground">
                      {result?.lookback_hours
                        ? `Last ${formatLookbackLabel(result.lookback_hours).replace(/^last\s+/i, "")}`
                        : (result?.used_fallback || unreadCount === 0)
                          ? "Recent activity"
                          : "Since your last visit"}
                    </p>
                  </Reveal>
                  <div className="space-y-4">
                    {(() => {
                       const stripTime = (t?: string | null) => {
                         if (!t) return "";
                         return t.replace(/\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*$/i, "").trim();
                       };
                       const WEEKDAYS = "(?:Mon|Tue|Tues|Wed|Wednes|Thu|Thur|Thurs|Fri|Sat|Satur|Sun)(?:day)?";
                       const MONTHS = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*";
                       const RELATIVE_WORDS = /^(?:earlier|recent|recently|previously|past|older|today|tonight|this\s+week|this\s+weekend|last\s+week)$/i;
                       const isMeaningfulDate = (s: string) => {
                         if (!s) return false;
                         if (RELATIVE_WORDS.test(s.trim())) return false;
                         return new RegExp(`${WEEKDAYS}|${MONTHS}|\\d`, "i").test(s);
                       };
                       const extractDateFromText = (text: string): string => {
                         // Pattern: "Monday 8 June" or "Thursday 4 June"
                         const wkdayDate = new RegExp(`\\b(${WEEKDAYS})\\s+(\\d{1,2})\\s+(${MONTHS})\\b`, "i").exec(text);
                         if (wkdayDate) {
                           const wd = wkdayDate[1][0].toUpperCase() + wkdayDate[1].slice(1).toLowerCase();
                           const mo = wkdayDate[3][0].toUpperCase() + wkdayDate[3].slice(1).toLowerCase();
                           return `${wd} ${wkdayDate[2]} ${mo}`;
                         }
                         // Pattern: "8 June" / "June 8"
                         const dm = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\b`, "i").exec(text);
                         if (dm) return `${dm[1]} ${dm[2][0].toUpperCase() + dm[2].slice(1).toLowerCase()}`;
                         const md = new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})\\b`, "i").exec(text);
                         if (md) return `${md[1][0].toUpperCase() + md[1].slice(1).toLowerCase()} ${md[2]}`;
                          // Pattern: bare weekday e.g. "Saturday's game" → resolve to nearest date
                          const wd = new RegExp(`\\b(${WEEKDAYS})(?:'s)?\\b`, "i").exec(text);
                          if (wd) {
                            const WD_MAP: Record<string, number> = {
                              sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, wednes: 3,
                              thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, satur: 6,
                            };
                            const key = wd[1].toLowerCase().replace(/day$/, "");
                            const target = WD_MAP[key];
                            if (target != null) {
                              const now = new Date();
                              const today = now.getDay();
                              // pick nearest occurrence within ±3 days, prefer upcoming on tie
                              let bestDiff = 99;
                              let best = 0;
                              for (let off = -3; off <= 3; off++) {
                                const d = (today + off + 7) % 7;
                                if (d === target && Math.abs(off) < bestDiff) {
                                  bestDiff = Math.abs(off);
                                  best = off;
                                }
                              }
                              const dt = new Date(now);
                              dt.setDate(now.getDate() + best);
                              const wdLabel = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dt.getDay()];
                              const moLabel = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()];
                              return `${wdLabel} ${dt.getDate()} ${moLabel}`;
                            }
                            return wd[1][0].toUpperCase() + wd[1].slice(1).toLowerCase();
                          }
                          return "";
                       };
                        // Resolve a label to a timestamp so we can canonicalise
                        // variants like "SAT 27 JUN" / "Sat 27 June" / "Saturday 27 June".
                        const labelToTs = (label: string): number | null => {
                          if (!label || label === "Earlier") return null;
                          const d = parseRecapTagDate(label);
                          if (d) return d.getTime();
                          const dm = new RegExp(`\\b(\\d{1,2})\\s+(${MONTHS})\\b`, "i").exec(label);
                          if (dm) {
                            const m = MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(dm[2].slice(0, 3).toLowerCase()));
                            if (m >= 0) return new Date(new Date().getFullYear(), m, Number(dm[1])).getTime();
                          }
                          const md = new RegExp(`\\b(${MONTHS})\\s+(\\d{1,2})\\b`, "i").exec(label);
                          if (md) {
                            const m = MONTH_NAMES.findIndex((n) => n.toLowerCase().startsWith(md[1].slice(0, 3).toLowerCase()));
                            if (m >= 0) return new Date(new Date().getFullYear(), m, Number(md[2])).getTime();
                          }
                          return null;
                        };
                        const WD_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
                        const MO_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                        const canonicalFromTs = (ts: number) => {
                          const dt = new Date(ts);
                          return `${WD_SHORT[dt.getDay()]} ${dt.getDate()} ${MO_SHORT[dt.getMonth()]}`;
                        };

                        const groups: { date: string; ts: number; items: typeof view.sinceTimeline }[] = [];
                        const indexByKey = new Map<string, number>();
                        for (const item of view.sinceTimeline) {
                          // Group by the message SEND timestamp only. Never
                          // pull a date from the summary body, because that
                          // may be a future fixture mentioned in chat (e.g.
                          // "this Saturday") rather than when it was said.
                          const ts = timelineSendTimestamp(item.time);
                          const displayLabel = canonicalFromTs(ts);
                          const key = `ts:${localDayKey(ts)}`;
                          const existing = indexByKey.get(key);
                          if (existing != null) {
                            groups[existing].items.push(item);
                          } else {
                            indexByKey.set(key, groups.length);
                            groups.push({ date: displayLabel, ts, items: [item] });
                          }
                        }
                        // Most recent day first.
                        groups.sort((a, b) => b.ts - a.ts);
                      return groups.map((g, gi) => (
                        <div key={`${g.date}-${gi}`}>
                          <Reveal delayMs={scheduleReveal(80)} as="div" className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {g.date}
                          </Reveal>
                          <ul className="space-y-3">
                            {g.items.map((item) => {
                              const delay = scheduleType(item.text);
                              return (
                                <li key={`${item.time ?? "item"}-${item.text}`} className="text-base leading-relaxed text-foreground">
                                  <Typed text={item.text} delayMs={delay} charMs={CHAR_MS} />
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ));
                    })()}
                  </div>
                </section>
              )}

              {/* Action items */}
              {view.actions.length > 0 && (
                <section className="mb-3 rounded-xl border border-border bg-card p-3">
                  <Reveal delayMs={scheduleReveal()} className="mb-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <p className="text-base font-semibold text-muted-foreground">
                      {view.actions.length === 1 ? "Action item" : "Action items"}
                    </p>
                  </Reveal>
                  <ul className="space-y-4">
                    {view.actions.map((a, i) => {
                      const badgeDelay = scheduleReveal(80);
                      const textDelay = scheduleType(a.text);
                      const ownerDelay = a.owner ? scheduleReveal(120) : 0;
                      return (
                        <li key={i} className="flex items-start gap-3">
                          <Reveal delayMs={badgeDelay} as="span" className={`mt-[0.15em] w-14 shrink-0 rounded-md px-1.5 py-0.5 text-center text-xs font-semibold ${priorityBadgeClasses(a.priority)}`}>
                            {a.priority === "high" ? "High" : a.priority === "low" ? "Low" : "Medium"}
                          </Reveal>
                          <div className="min-w-0 flex-1">
                            <span className="text-base font-medium leading-relaxed text-foreground">
                              <Typed text={a.text} delayMs={textDelay} charMs={CHAR_MS} />
                            </span>
                            {a.owner && (
                              <Reveal delayMs={ownerDelay} className="mt-1 text-sm font-normal text-muted-foreground">
                                Owner • {a.owner}
                              </Reveal>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Outstanding questions removed — folded into activity for richer detail */}

              {!view.anythingAtAll && (
                <div className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
                  <Typed text="No useful team updates were found in the recent messages." delayMs={scheduleType("No useful team updates were found in the recent messages.")} charMs={CHAR_MS} />
                </div>
              )}
            </>
          )}


          {!loading && !err && view && (
            <>


              {/* Detailed (collapsed) */}
              {view.detailedHasAny && (
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setShowDetailed((v) => !v)}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/60"
                  >
                    <span>{showDetailed ? "Hide detailed summary" : "View detailed summary"}</span>
                    {showDetailed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                  {showDetailed && (
                    <div className="mt-1 divide-y divide-border/60 rounded-xl border border-border bg-card">
                      {view.detailed.schedule_changes.length > 0 && (
                      <DetailBlock
                          icon={<CalendarClock className="h-4 w-4 text-amber-500" />}
                          label="Schedule changes"
                          items={view.detailed.schedule_changes}
                          scheduleType={scheduleType}
                          scheduleReveal={scheduleReveal}
                          charMs={CHAR_MS}
                          disableAnimation
                        />
                      )}
                      {view.detailed.files_shared.length > 0 && (
                      <DetailBlock
                          icon={<Paperclip className="h-4 w-4 text-violet-500" />}
                          label="Files & photos shared"
                          items={view.detailed.files_shared}
                          scheduleType={scheduleType}
                          scheduleReveal={scheduleReveal}
                          charMs={CHAR_MS}
                          disableAnimation
                        />
                      )}
                      {view.detailed.discussion.length > 0 && (
                      <DetailBlock
                          icon={<MessageSquare className="h-4 w-4 text-blue-500" />}
                          label="Other discussion"
                          items={view.detailed.discussion}
                          scheduleType={scheduleType}
                          scheduleReveal={scheduleReveal}
                          charMs={CHAR_MS}
                          disableAnimation
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {(() => {
                    const n = result!.message_count;
                    const msg = `${n} message${n === 1 ? "" : "s"}`;
                    if (result!.lookback_hours) {
                      const base = `Summarised ${msg} from the ${formatLookbackLabel(result!.lookback_hours)}`;
                      return result!.truncated
                        ? `${base}. Showing the most recent ${n} — older messages in this window were trimmed for length.`
                        : `${base}.`;
                    }
                    if (result!.used_fallback) {
                      return `Summarised ${msg} from the last 7 days.`;
                    }

                    const since = formatSinceLabel(result!.window_since);
                    // If the user has nothing unread, "since your last visit" is misleading —
                    // their read state was updated elsewhere (push, another device, mark-as-read).
                    if (unreadCount === 0) {
                      return since
                        ? `Summarised ${msg} of recent activity (${since}).`
                        : `Summarised ${msg} of recent activity.`;
                    }
                    return since
                      ? `Summarised ${n} new message${n === 1 ? "" : "s"} since your last visit (${since}).`
                      : `Summarised ${n} new message${n === 1 ? "" : "s"} since your last visit.`;
                  })()}
                </p>
                <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={onRegenerate}>
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </Button>
              </div>

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

function DetailBlock({
  icon,
  label,
  items,
  scheduleType,
  scheduleReveal,
  charMs,
  disableAnimation = false,
}: {
  icon: React.ReactNode;
  label: string;
  items: string[];
  scheduleType: (text: string) => number;
  scheduleReveal: (ms?: number) => number;
  charMs: number;
  disableAnimation?: boolean;
}) {
  if (disableAnimation) {
    return (
      <div className="px-3 py-3">
        <div className="mb-2 flex items-center gap-2">
          {icon}
          <p className="text-base font-semibold text-muted-foreground">{label}</p>
        </div>
        {items.length === 1 ? (
          <p className="text-base leading-relaxed text-foreground">{items[0]}</p>
        ) : (
          <div className="space-y-3">
            {items.map((item, i) => (
              <div key={i} className="text-base leading-relaxed text-foreground">
                {item}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="px-3 py-3">
      <Reveal delayMs={scheduleReveal()} className="mb-2 flex items-center gap-2">
        {icon}
        <p className="text-base font-semibold text-muted-foreground">{label}</p>
      </Reveal>
      {items.length === 1 ? (
        <p className="text-base leading-relaxed text-foreground">
          <Typed text={items[0]} delayMs={scheduleType(items[0])} charMs={charMs} />
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <div key={i} className="text-base leading-relaxed text-foreground">
              <Typed text={item} delayMs={scheduleType(item)} charMs={charMs} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Streams `text` one character at a time after an optional `delayMs`, used to
 * give the summary a ChatGPT-style top-down typing reveal. Reserves the full
 * line height via an invisible underlay so the sheet doesn't shift as it types.
 */
function Typed({
  text,
  delayMs = 0,
  charMs = 16,
}: {
  text: string;
  delayMs?: number;
  charMs?: number;
}) {
  // staticMode is signalled by charMs === 0 (set by useStaticReveal): render
  // the full text immediately, no scheduling, no per-character re-render.
  const isStatic = charMs <= 0;
  const [n, setN] = useState(isStatic ? text.length : 0);
  useEffect(() => {
    if (isStatic) { setN(text.length); return; }
    setN(0);
    const handle = scheduleTypewriter({
      delayMs,
      charMs,
      length: text.length,
      onTick: setN,
    });
    return () => handle.cancel();
  }, [text, delayMs, charMs, isStatic]);

  // Grid stack: invisible full text reserves space; visible partial overlays it.
  return (
    <span className="grid">
      <span className="invisible col-start-1 row-start-1" aria-hidden>{text}</span>
      <span className="col-start-1 row-start-1">{text.slice(0, n)}</span>
    </span>
  );
}


/**
 * Fades children in after `delayMs`. Reserves layout space upfront (renders
 * invisibly) so the sheet height stays stable while siblings reveal.
 */
function Reveal({
  delayMs = 0,
  as: As = "div",
  className,
  children,
}: {
  delayMs?: number;
  as?: "div" | "span" | "p";
  className?: string;
  children: React.ReactNode;
}) {
  const [shown, setShown] = useState(delayMs === 0);
  useEffect(() => {
    setShown(delayMs === 0);
    if (delayMs === 0) return;
    const t = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  return (
    <As
      className={className}
      style={{ opacity: shown ? 1 : 0, transition: "opacity 180ms ease-out" }}
    >
      {children}
    </As>
  );
}



/**
 * Typewriter shown while we wait for the summary to land. Starts typing
 * immediately on mount (no skeleton wait), then types each subsequent stage
 * line as `stage` advances. Gives the perception that work has already begun.
 */
function LoadingTypewriter({ stage, staticMode = false }: { stage: number; staticMode?: boolean }) {
  // Lines to type so far: every stage up to and including the current one.
  const lines = LOADING_STAGES.slice(0, Math.max(1, stage + 1));
  const isFinalStage = stage >= LOADING_STAGES.length - 1;
  const [showReassurance, setShowReassurance] = useState(false);

  useEffect(() => {
    if (!isFinalStage) { setShowReassurance(false); return; }
    const t = setTimeout(() => setShowReassurance(true), 2500);
    return () => clearTimeout(t);
  }, [isFinalStage, stage]);

  return (
    <div className="space-y-2 py-1">
      {lines.map((line, i) => (
        <TypewriterLine
          key={i}
          text={line}
          showCaret={!staticMode && i === lines.length - 1}
          staticMode={staticMode}
        />
      ))}
      {showReassurance && (
        <div className="flex items-center gap-2 pt-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Almost there… this usually takes a few seconds.
          </p>
        </div>
      )}
    </div>
  );
}

function TypewriterLine({ text, showCaret, staticMode = false }: { text: string; showCaret: boolean; staticMode?: boolean }) {
  const [shown, setShown] = useState(staticMode ? text.length : 0);
  useEffect(() => {
    if (staticMode) { setShown(text.length); return; }
    setShown(0);
    const handle = scheduleTypewriter({
      delayMs: 0,
      charMs: 28,
      length: text.length,
      onTick: setShown,
    });
    return () => handle.cancel();
  }, [text, staticMode]);
  const done = shown >= text.length;

  return (
    <p className="text-sm leading-snug text-foreground">
      {text.slice(0, shown)}
      {showCaret && (
        <span
          className={`ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 bg-primary ${done ? "animate-pulse" : ""}`}
          aria-hidden
        />
      )}
    </p>

  );
}
