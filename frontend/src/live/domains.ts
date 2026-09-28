import type { Identity } from "@icp-sdk/core/agent";
import type { Principal } from "@icp-sdk/core/principal";
import { createLiveActor } from "./icpAgent";
import type { IcpTargetConfig } from "./targetRegistry";

import { idlFactory as clubDomainIdl } from "../lab/bindings/club_domain/declarations/club_domain.did.js";
import type { _SERVICE as ClubDomainActor } from "../lab/bindings/club_domain/declarations/club_domain.did.js";
import { idlFactory as competitionDomainIdl } from "../lab/bindings/competition_domain/declarations/competition_domain.did.js";
import type { _SERVICE as CompetitionDomainActor } from "../lab/bindings/competition_domain/declarations/competition_domain.did.js";
import { idlFactory as eventsDomainIdl } from "../lab/bindings/events_domain/declarations/events_domain.did.js";
import type { _SERVICE as EventsDomainActor } from "../lab/bindings/events_domain/declarations/events_domain.did.js";
import { idlFactory as mediaMetadataIdl } from "../lab/bindings/media_metadata/declarations/media_metadata.did.js";
import type { _SERVICE as MediaMetadataActor } from "../lab/bindings/media_metadata/declarations/media_metadata.did.js";
import { idlFactory as messagingDomainIdl } from "../lab/bindings/messaging_domain/declarations/messaging_domain.did.js";
import type { _SERVICE as MessagingDomainActor } from "../lab/bindings/messaging_domain/declarations/messaging_domain.did.js";
import { idlFactory as migrationCoordinatorIdl } from "../lab/bindings/migration_coordinator/declarations/migration_coordinator.did.js";
import type { _SERVICE as MigrationCoordinatorActor } from "../lab/bindings/migration_coordinator/declarations/migration_coordinator.did.js";
import { idlFactory as notificationQueueIdl } from "../lab/bindings/notification_queue/declarations/notification_queue.did.js";
import type { _SERVICE as NotificationQueueActor } from "../lab/bindings/notification_queue/declarations/notification_queue.did.js";
import { idlFactory as piiAccessControlIdl } from "../lab/bindings/pii_access_control/declarations/pii_access_control.did.js";
import type { _SERVICE as PiiAccessControlActor } from "../lab/bindings/pii_access_control/declarations/pii_access_control.did.js";
import { idlFactory as placementRegistryIdl } from "../lab/bindings/placement_registry/declarations/placement_registry.did.js";
import type { _SERVICE as PlacementRegistryActor } from "../lab/bindings/placement_registry/declarations/placement_registry.did.js";
import { idlFactory as secretWorkloadIdentityIdl } from "../lab/bindings/secret_workload_identity/declarations/secret_workload_identity.did.js";
import type { _SERVICE as SecretWorkloadIdentityActor } from "../lab/bindings/secret_workload_identity/declarations/secret_workload_identity.did.js";
import { idlFactory as shardRouterIdl } from "../lab/bindings/shard_router/declarations/shard_router.did.js";
import type { _SERVICE as ShardRouterActor } from "../lab/bindings/shard_router/declarations/shard_router.did.js";
import { idlFactory as timerJobsIdl } from "../lab/bindings/timer_jobs/declarations/timer_jobs.did.js";
import type { _SERVICE as TimerJobsActor } from "../lab/bindings/timer_jobs/declarations/timer_jobs.did.js";

/**
 * Typed live (mainnet / Cloud Engine) connectors for every backend canister,
 * built on the shared agent in `icpAgent.ts` and the dfx-generated bindings
 * under `lab/bindings/`. `identity_access` has its own module
 * (`identityAccess.ts`) because sign-in provisioning depends on it.
 *
 * Each connector resolves the canister ID from the active target's
 * `canisterIds` map (build-time env merged with the app-admin overrides from
 * /admin/placement-settings) and throws a descriptive error when the ID is
 * not configured — callers should route through `featureBackend.ts`, which
 * keeps unconfigured features on Supabase instead of ever hitting that throw.
 */

export const DOMAIN_LABELS: Record<string, string> = {
  club_domain: "Club domain",
  competition_domain: "Competition domain",
  events_domain: "Events domain",
  identity_access: "Identity access",
  media_metadata: "Media metadata",
  messaging_domain: "Messaging domain",
  migration_coordinator: "Migration coordinator",
  notification_queue: "Notification queue",
  pii_access_control: "PII access control",
  placement_registry: "Placement registry",
  secret_workload_identity: "Secret workload identity",
  shard_router: "Shard router",
  timer_jobs: "Timer jobs",
};

export function isDomainConfigured(target: IcpTargetConfig, domainKey: string): boolean {
  const id = target.canisterIds[domainKey];
  return typeof id === "string" && id.trim() !== "";
}

export interface LiveDomainConnection<T> {
  actor: T;
  canisterId: Principal;
}

async function connect<T>(
  target: IcpTargetConfig,
  identity: Identity,
  domainKey: string,
  idlFactory: Parameters<typeof createLiveActor<T>>[4],
): Promise<LiveDomainConnection<T>> {
  return createLiveActor<T>(target, identity, domainKey, DOMAIN_LABELS[domainKey] ?? domainKey, idlFactory);
}

export const connectLiveClubDomain = (target: IcpTargetConfig, identity: Identity) =>
  connect<ClubDomainActor>(target, identity, "club_domain", clubDomainIdl);

export const connectLiveCompetitionDomain = (target: IcpTargetConfig, identity: Identity) =>
  connect<CompetitionDomainActor>(target, identity, "competition_domain", competitionDomainIdl);

export const connectLiveEventsDomain = (target: IcpTargetConfig, identity: Identity) =>
  connect<EventsDomainActor>(target, identity, "events_domain", eventsDomainIdl);

export const connectLiveMediaMetadata = (target: IcpTargetConfig, identity: Identity) =>
  connect<MediaMetadataActor>(target, identity, "media_metadata", mediaMetadataIdl);

export const connectLiveMessagingDomain = (target: IcpTargetConfig, identity: Identity) =>
  connect<MessagingDomainActor>(target, identity, "messaging_domain", messagingDomainIdl);

export const connectLiveMigrationCoordinator = (target: IcpTargetConfig, identity: Identity) =>
  connect<MigrationCoordinatorActor>(target, identity, "migration_coordinator", migrationCoordinatorIdl);

export const connectLiveNotificationQueue = (target: IcpTargetConfig, identity: Identity) =>
  connect<NotificationQueueActor>(target, identity, "notification_queue", notificationQueueIdl);

export const connectLivePiiAccessControl = (target: IcpTargetConfig, identity: Identity) =>
  connect<PiiAccessControlActor>(target, identity, "pii_access_control", piiAccessControlIdl);

export const connectLivePlacementRegistry = (target: IcpTargetConfig, identity: Identity) =>
  connect<PlacementRegistryActor>(target, identity, "placement_registry", placementRegistryIdl);

export const connectLiveSecretWorkloadIdentity = (target: IcpTargetConfig, identity: Identity) =>
  connect<SecretWorkloadIdentityActor>(target, identity, "secret_workload_identity", secretWorkloadIdentityIdl);

export const connectLiveShardRouter = (target: IcpTargetConfig, identity: Identity) =>
  connect<ShardRouterActor>(target, identity, "shard_router", shardRouterIdl);

export const connectLiveTimerJobs = (target: IcpTargetConfig, identity: Identity) =>
  connect<TimerJobsActor>(target, identity, "timer_jobs", timerJobsIdl);
