import {
  resolveBackendForCountry,
  type BackendProvider,
  type BackendRoutingConfig,
} from "./backendRouting";
import type { IcpTargetConfig } from "./targetRegistry";

/**
 * Per-feature backend routing: which canister serves each feature area, and
 * whether that feature should currently be served by ICP or Supabase.
 *
 * Pure module — no Supabase imports (same module-cycle rule as
 * backendRouting.ts / icpAdminOverrides.ts). The non-pure convenience
 * resolver `getEffectiveBackendForFeature` lives in loadBackendRouting.ts.
 *
 * Fallback rule: a feature is only ever routed to ICP when (a) the routing
 * config resolves ICP for the user's country AND (b) that feature's canister
 * ID is actually configured on the active ICP target. Until a canister is
 * deployed and registered, the feature silently keeps using Supabase, so
 * enabling ICP in placement settings can never break a feature whose
 * canister does not exist yet.
 */

export const FEATURE_AREAS = [
  "events",
  "messaging",
  "media",
  "news",
  "home",
  "membership",
  "competitions",
  "notifications",
  "vault",
  "mini_leagues",
  "points",
  "attendance",
  "analytics",
  "admin",
] as const;

export type FeatureArea = (typeof FEATURE_AREAS)[number];

/**
 * The canister (key in `IcpTargetConfig.canisterIds`) that owns each feature
 * area's data. Features without a dedicated domain canister map onto the
 * domain canister that holds their data:
 * - news -> club_domain (club announcements live in club settings)
 * - home -> events_domain (home schedule/RSVP reads)
 * - membership -> club_domain (teams, guardians, ACL)
 * - vault -> vault_domain (folder/file metadata; PII records stay in pii_access_control)
 * - mini_leagues -> mini_league_domain
 * - points -> club_points_domain
 * - attendance -> events_domain (attendance marking lives with events)
 * - analytics -> insights_domain (perf samples + engagement counters)
 * - admin -> insights_domain (admin alerts, audit logs, feedback)
 */
export const FEATURE_CANISTER_KEYS: Record<FeatureArea, string> = {
  events: "events_domain",
  messaging: "messaging_domain",
  media: "media_metadata",
  news: "club_domain",
  home: "events_domain",
  membership: "club_domain",
  competitions: "competition_domain",
  notifications: "notification_queue",
  vault: "vault_domain",
  mini_leagues: "mini_league_domain",
  points: "club_points_domain",
  attendance: "events_domain",
  analytics: "insights_domain",
  admin: "insights_domain",
};

export function isFeatureArea(value: string): value is FeatureArea {
  return (FEATURE_AREAS as readonly string[]).includes(value);
}

export function featureCanisterKey(feature: FeatureArea): string {
  return FEATURE_CANISTER_KEYS[feature];
}

/** True when the active ICP target has a canister ID registered for this feature. */
export function isFeatureCanisterConfigured(
  target: IcpTargetConfig | null,
  feature: FeatureArea,
): boolean {
  if (!target) return false;
  const id = target.canisterIds[featureCanisterKey(feature)];
  return typeof id === "string" && id.trim() !== "";
}

/**
 * Which backend should serve `feature` for a user in `country` under
 * `config`, given the active ICP target (null when none resolves).
 *
 * The per-feature canister-availability flag is fed into the shared resolver
 * as `icpAvailable`, so every existing safety rule applies per feature: a
 * global ICP default or an ICP-only country still falls back to Supabase for
 * any feature whose canister is not configured yet.
 */
export function resolveFeatureBackend(
  config: BackendRoutingConfig,
  country: string | null,
  target: IcpTargetConfig | null,
  feature: FeatureArea,
): BackendProvider {
  return resolveBackendForCountry(
    config,
    country,
    isFeatureCanisterConfigured(target, feature),
  );
}
