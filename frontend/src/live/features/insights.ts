import { connectLiveInsightsDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, toNat64, unwrapCandid } from "./candid";

/**
 * Analytics/perf + admin surfaces -> insights_domain canister.
 *
 * Shared by two feature areas (see featureBackend.ts):
 *  - "analytics": web vitals, perf samples/aggregates, engagement counters
 *    and the 7 club_engagement_* read mirrors.
 *  - "admin": admin alerts, audit logs, feedback.
 *
 * Provisional mappings (undocumented elsewhere, called out per canister
 * guard since there is no live canister to verify against yet):
 *  - `account_id` / "actor" passed to engagement counters is the caller's
 *    Internet Identity principal text (`ctx.identity.getPrincipal().toText()`)
 *    when no app user id is available at the call site — callers that already
 *    have a Supabase-style user id pass that string instead so the Supabase
 *    and ICP engagement totals stay comparable for the same person.
 *  - `audit_logs.actor_id` filter takes a `Principal`; callers that only have
 *    a user id string pass it through `Principal.fromText` and catch/ignore
 *    on parse failure (falls back to an unfiltered list) since the canister
 *    only accepts real principals.
 *  - perf-sample `surface` values reuse the Supabase table name's prefix
 *    (e.g. "home_open", "inbox_open", "chat_open", "schedule_open",
 *    "realtime", "client_perf") so `perf_aggregate` queries can group the
 *    same way the old per-table dashboards did. Rich per-surface context
 *    (stage breakdowns, section counts, etc.) has no canister equivalent yet
 *    and is dropped on the ICP branch — only the bounded (surface, source,
 *    duration_ms, cache_hit, platform) sample survives.
 */

type InsightsDomainActor = Awaited<ReturnType<typeof connectLiveInsightsDomain>>["actor"];
export type LivePerfSampleInput = Parameters<InsightsDomainActor["record_perf_samples_batch"]>[0][number];

function toAlertStatus(status: "Open" | "Resolved") {
  return status === "Open" ? { Open: null } : { Resolved: null };
}

function toFeedbackStatus(status: "Open" | "InProgress" | "Resolved") {
  if (status === "Open") return { Open: null };
  if (status === "InProgress") return { InProgress: null };
  return { Resolved: null };
}

// ---------------- Web vitals / perf ----------------

export async function recordLiveWebVital(
  ctx: FeatureBackendContext,
  metricName: string,
  metricValue: number,
  rating: string,
  pagePath: string,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.record_web_vital(metricName, metricValue, rating, pagePath),
    "Record web vital",
  );
}

export async function recordLivePerfSample(
  ctx: FeatureBackendContext,
  surface: string,
  source: string,
  durationMs: number,
  cacheHit: boolean,
  platform: string,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.record_perf_sample(surface, source, Math.max(0, Math.round(durationMs)), cacheHit, platform),
    "Record perf sample",
  );
}

/** Bounded to 50 samples per call by the canister — callers must chunk larger batches. */
export const LIVE_PERF_SAMPLES_BATCH_LIMIT = 50;

export async function recordLivePerfSamplesBatch(
  ctx: FeatureBackendContext,
  samples: LivePerfSampleInput[],
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  const chunks: LivePerfSampleInput[][] = [];
  for (let i = 0; i < samples.length; i += LIVE_PERF_SAMPLES_BATCH_LIMIT) {
    chunks.push(samples.slice(i, i + LIVE_PERF_SAMPLES_BATCH_LIMIT));
  }
  let total = 0;
  for (const chunk of chunks) {
    total += await unwrapCandid(actor.record_perf_samples_batch(chunk), "Record perf samples batch");
  }
  return total;
}

export async function getLivePerfAggregate(
  ctx: FeatureBackendContext,
  surface: string,
  source: string | null,
  sinceMs: number,
  untilMs: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.perf_aggregate(surface, candidOpt(source), toNat64(sinceMs), toNat64(untilMs)),
    "Get perf aggregate",
  );
}

// ---------------- Engagement counters (writes) ----------------

export async function recordLiveMessageSent(ctx: FeatureBackendContext, clubId: string, accountId: string) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.record_message_sent(clubId, accountId), "Record message sent");
}

export async function recordLiveRsvpCompleted(ctx: FeatureBackendContext, clubId: string, accountId: string) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.record_rsvp_completed(clubId, accountId), "Record RSVP completed");
}

export async function recordLiveActiveUser(ctx: FeatureBackendContext, clubId: string, accountId: string) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.record_active_user(clubId, accountId), "Record active user");
}

export async function recordLiveSponsorImpression(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.record_sponsor_impression(clubId), "Record sponsor impression");
}

export async function recordLiveSponsorClick(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.record_sponsor_click(clubId), "Record sponsor click");
}

// ---------------- Club engagement query mirrors ----------------

export async function getLiveClubEngagementTotals(
  ctx: FeatureBackendContext,
  clubId: string,
  sinceMs: number,
  untilMs: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.club_engagement_totals(clubId, toNat64(sinceMs), toNat64(untilMs)),
    "Get club engagement totals",
  );
}

export async function getLiveClubEngagementActiveUsers(
  ctx: FeatureBackendContext,
  clubId: string,
  sinceMs: number,
  untilMs: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.club_engagement_active_users(clubId, toNat64(sinceMs), toNat64(untilMs)),
    "Get club engagement active users",
  );
}

export async function getLiveClubEngagementMessageVolume(
  ctx: FeatureBackendContext,
  clubId: string,
  sinceMs: number,
  untilMs: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.club_engagement_message_volume(clubId, toNat64(sinceMs), toNat64(untilMs)),
    "Get club engagement message volume",
  );
}

export async function getLiveClubEngagementRsvpCompletionSeries(
  ctx: FeatureBackendContext,
  clubId: string,
  sinceMs: number,
  untilMs: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.club_engagement_rsvp_completion_series(clubId, toNat64(sinceMs), toNat64(untilMs)),
    "Get club engagement RSVP completion series",
  );
}

export async function getLiveClubEngagementSponsorPerformance(
  ctx: FeatureBackendContext,
  clubId: string,
  sinceMs: number,
  untilMs: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.club_engagement_sponsor_performance(clubId, toNat64(sinceMs), toNat64(untilMs)),
    "Get club engagement sponsor performance",
  );
}

export async function getLiveClubEngagementTotalUniqueReach(
  ctx: FeatureBackendContext,
  clubId: string,
  sinceMs: number,
  untilMs: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.club_engagement_total_unique_reach(clubId, toNat64(sinceMs), toNat64(untilMs)),
    "Get club engagement total unique reach",
  );
}

export async function getLiveClubEngagementBenchmarks(
  ctx: FeatureBackendContext,
  clubId: string,
  sinceMs: number,
  untilMs: number,
  prevSinceMs: number,
  prevUntilMs: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.club_engagement_benchmarks(
      clubId,
      toNat64(sinceMs),
      toNat64(untilMs),
      toNat64(prevSinceMs),
      toNat64(prevUntilMs),
    ),
    "Get club engagement benchmarks",
  );
}

// ---------------- Admin alerts ----------------

export async function createLiveAdminAlert(ctx: FeatureBackendContext, alertType: string, details: string) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.create_admin_alert(alertType, details), "Create admin alert");
}

export async function listLiveAdminAlerts(ctx: FeatureBackendContext, status?: "Open" | "Resolved" | null) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_admin_alerts(candidOpt(status ? toAlertStatus(status) : null)),
    "List admin alerts",
  );
}

export async function resolveLiveAdminAlert(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.resolve_admin_alert(id), "Resolve admin alert");
}

// ---------------- Audit logs ----------------

export async function appendLiveAuditLog(
  ctx: FeatureBackendContext,
  actionType: string,
  tableName: string,
  targetUserId: string | null,
  targetUserName: string | null,
  details: string,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.append_audit_log(actionType, tableName, candidOpt(targetUserId), candidOpt(targetUserName), details),
    "Append audit log",
  );
}

export async function listLiveAuditLogs(
  ctx: FeatureBackendContext,
  opts: {
    /** Principal text; invalid/unparsable values are treated as "no filter". */
    actorId?: string | null;
    actionType?: string | null;
    tableName?: string | null;
    offset?: number;
    limit?: number;
  } = {},
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  let actorPrincipal: import("@icp-sdk/core/principal").Principal | null = null;
  if (opts.actorId) {
    try {
      const { Principal } = await import("@icp-sdk/core/principal");
      actorPrincipal = Principal.fromText(opts.actorId);
    } catch {
      actorPrincipal = null; // not a principal — fall back to unfiltered by actor
    }
  }
  return unwrapCandid(
    actor.list_audit_logs(
      candidOpt(actorPrincipal),
      candidOpt(opts.actionType),
      candidOpt(opts.tableName),
      opts.offset ?? 0,
      opts.limit ?? 100,
    ),
    "List audit logs",
  );
}

// ---------------- Feedback ----------------

export async function submitLiveFeedback(
  ctx: FeatureBackendContext,
  kind: string,
  title: string | null,
  message: string,
  pageUrl: string | null,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.submit_feedback(kind, candidOpt(title), message, candidOpt(pageUrl)),
    "Submit feedback",
  );
}

export async function getLiveMyFeedback(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return actor.my_feedback();
}

export async function listLiveFeedback(
  ctx: FeatureBackendContext,
  status: "Open" | "InProgress" | "Resolved" | null,
  offset: number,
  limit: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_feedback(candidOpt(status ? toFeedbackStatus(status) : null), offset, limit),
    "List feedback",
  );
}

export async function updateLiveFeedbackStatus(
  ctx: FeatureBackendContext,
  id: string,
  status: "Open" | "InProgress" | "Resolved",
  adminNotes: string | null,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_feedback_status(id, toFeedbackStatus(status), candidOpt(adminNotes)),
    "Update feedback status",
  );
}

// ---------------- Client perf (client-side perf entries/aggregate) ----------------

export type LiveClientPerfEntry = Parameters<InsightsDomainActor["record_client_perf"]>[0][number];

export async function recordLiveClientPerf(ctx: FeatureBackendContext, entries: LiveClientPerfEntry[]) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.record_client_perf(entries), "Record client perf");
}

export async function getLiveClientPerfAggregate(
  ctx: FeatureBackendContext,
  path: string,
  metric: string | null,
  sinceMs: number,
  untilMs: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.client_perf_aggregate(path, candidOpt(metric), toNat64(sinceMs), toNat64(untilMs)),
    "Get client perf aggregate",
  );
}

// ---------------- Benchmarks ----------------

export async function setLiveBenchmark(
  ctx: FeatureBackendContext,
  metricKey: string,
  period: string,
  value: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_benchmark(metricKey, period, value), "Set benchmark");
}

export async function getLiveBenchmarks(ctx: FeatureBackendContext, metricKeys: string[]) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_benchmarks(metricKeys), "Get benchmarks");
}

// ---------------- Sponsor metrics / performance ----------------

export async function recordLiveSponsorMetric(
  ctx: FeatureBackendContext,
  sponsorId: string,
  metric: string,
  delta: number,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.record_sponsor_metric(sponsorId, metric, delta),
    "Record sponsor metric",
  );
}

export async function getLiveSponsorPerformance(
  ctx: FeatureBackendContext,
  sponsorId: string,
  period: string,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.get_sponsor_performance(sponsorId, period),
    "Get sponsor performance",
  );
}

export async function getLiveSponsorBenchmarks(
  ctx: FeatureBackendContext,
  sponsorIds: string[],
  sincePeriod: string,
  untilPeriod: string,
) {
  const { actor } = await connectLiveInsightsDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.get_sponsor_benchmarks(sponsorIds, sincePeriod, untilPeriod),
    "Get sponsor benchmarks",
  );
}
