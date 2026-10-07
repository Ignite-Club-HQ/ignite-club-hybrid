import { Actor, HttpAgent, type Identity } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import type { IcpTargetConfig } from "./targetRegistry";
import { trackIcpQueryCall, trackIcpUpdateCall } from "./pendingCalls";

/**
 * Update methods the app fires in the background (provisioning self-heal on
 * every chat refresh, read receipts, presence, analytics counters). The user
 * never waits on them, so they must not keep the top pending bar running.
 */
const SILENT_BACKGROUND_UPDATES = new Set<string>([
  "ensure_broadcast_conversation",
  "ensure_club_admin_thread",
  "ensure_club_conversations",
  "mark_read",
  "mark_all_read",
  "presence_heartbeat",
  "record_active_user",
  "record_ad_event",
  "record_chat_notify_batch",
  "record_client_perf",
  "record_event_view",
  "record_message_sent",
  "record_perf_sample",
  "record_perf_samples_batch",
  "record_photo_engagement",
  "record_sponsor_click",
  "record_sponsor_impression",
  "record_sponsor_metric",
  "record_user_activity",
  "record_web_vital",
]);

/**
 * Live (mainnet / Cloud Engine) counterpart of `frontend/src/lab/localActor.ts`.
 *
 * Unlike the lab agent, this never fetches or pins a root key and never restricts
 * requests to a local origin: the IC JS SDK ships the mainnet root key baked in,
 * so a real `HttpAgent` talking to an approved public/Cloud Engine host works
 * out of the box. See the `internet-identity` and `icp-cli` skills
 * (skills.internetcomputer.org) for why `shouldFetchRootKey`/`fetchRootKey()`
 * must never be used against a real network — doing so would let a
 * man-in-the-middle substitute a fake root key.
 */

function resolveTargetHost(target: IcpTargetConfig): string {
  const host = new URL(target.host);
  if (host.protocol !== "https:") {
    throw new Error(`ICP target ${target.alias} must use an HTTPS host.`);
  }
  return host.toString();
}

export function resolveLiveCanisterId(target: IcpTargetConfig, domainKey: string, domainLabel: string): Principal {
  const canisterId = target.canisterIds[domainKey];
  if (!canisterId) {
    throw new Error(
      `${domainLabel} canister is not configured for ICP target ${target.alias}. ` +
        "Deploy it to this network and add its canister ID to IGNITE_LIVE_ICP_CANISTER_IDS_JSON.",
    );
  }
  const principal = Principal.fromText(canisterId);
  if (principal.isAnonymous() || principal.toText() === "aaaaa-aa") {
    throw new Error(`${domainLabel} canister ID configured for ICP target ${target.alias} is invalid.`);
  }
  return principal;
}

/**
 * Per-session agent cache. Creating an `HttpAgent` performs a time-sync
 * handshake with the network; multi-canister pages (home feed hitting events
 * + news + media + messages) would otherwise pay that handshake once per
 * domain actor. Agents are keyed by target alias + host + identity principal,
 * so a different signed-in principal or a different network never reuses a
 * stale agent. Cleared on Internet Identity sign-out via `clearLiveAgentCache`.
 */
const liveAgentCache = new Map<string, Promise<HttpAgent>>();
const liveAgentIdentity = new Map<string, Identity>();

export async function createLiveAgent(target: IcpTargetConfig, identity: Identity): Promise<HttpAgent> {
  const host = resolveTargetHost(target);
  const cacheKey = `${target.alias}|${host}|${identity.getPrincipal().toText()}`;
  const cached = liveAgentCache.get(cacheKey);
  if (cached) {
    // The II session re-mints its short-lived delegation under the SAME
    // principal; a cached agent still signing with the old delegation fails
    // every call once it expires. Swap in the fresh identity.
    if (liveAgentIdentity.get(cacheKey) !== identity) {
      liveAgentIdentity.set(cacheKey, identity);
      const agent = await cached;
      agent.replaceIdentity(identity);
      return agent;
    }
    return cached;
  }
  const created = HttpAgent.create({
    host,
    identity,
    shouldSyncTime: true,
    useQueryNonces: true,
    retryTimes: 2,
  });
  liveAgentCache.set(cacheKey, created);
  liveAgentIdentity.set(cacheKey, identity);
  // A failed handshake must not poison the cache: drop the entry so the next
  // call retries instead of reusing a rejected agent forever.
  created.catch(() => {
    if (liveAgentCache.get(cacheKey) === created) {
      liveAgentCache.delete(cacheKey);
      liveAgentIdentity.delete(cacheKey);
    }
  });
  return created;
}

/** Drops every cached agent; called on Internet Identity sign-out. */
export function clearLiveAgentCache(): void {
  liveAgentCache.clear();
  liveAgentIdentity.clear();
}

export async function createLiveActor<T>(
  target: IcpTargetConfig,
  identity: Identity,
  domainKey: string,
  domainLabel: string,
  idlFactoryForDomain: IDL.InterfaceFactory,
): Promise<{ actor: T; canisterId: Principal }> {
  const canisterId = resolveLiveCanisterId(target, domainKey, domainLabel);
  const agent = await createLiveAgent(target, identity);
  const actor = wrapUpdateCallsForPendingIndicator(
    Actor.createActor<T>(idlFactoryForDomain, { agent, canisterId }),
    idlFactoryForDomain,
  );
  return { actor, canisterId };
}

/**
 * Wraps an actor's methods so in-flight calls register with the global
 * pending indicator (see pendingCalls.ts, rendered by IcpPendingBar):
 *   - UPDATE methods are always tracked (writes are user-initiated).
 *   - Query / composite-query methods are tracked only in the short window
 *     after a navigation, so page-load reads show the bar while background
 *     polling never flashes it.
 * Introspection failures degrade to the unwrapped actor — an indicator must
 * never break a call path.
 */
function wrapUpdateCallsForPendingIndicator<T>(actor: T, idlFactory: IDL.InterfaceFactory): T {
  let queryMethodNames: Set<string>;
  try {
    const service = idlFactory({ IDL }) as unknown as {
      _fields?: Array<[string, { annotations?: unknown }]>;
    };
    queryMethodNames = new Set(
      (service._fields ?? [])
        .filter(([, type]) => {
          const annotations = Array.isArray(type?.annotations) ? (type.annotations as string[]) : [];
          return annotations.includes("query") || annotations.includes("composite_query");
        })
        .map(([name]) => name),
    );
  } catch {
    return actor;
  }
  const source = actor as Record<string, unknown>;
  const wrapped: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (typeof value !== "function") {
      wrapped[key] = value;
      continue;
    }
    const fn = value as (...callArgs: unknown[]) => unknown;
    wrapped[key] = SILENT_BACKGROUND_UPDATES.has(key)
      ? fn
      : queryMethodNames.has(key)
      ? (...args: unknown[]) => trackIcpQueryCall(fn(...args))
      : (...args: unknown[]) => trackIcpUpdateCall(fn(...args));
  }
  return wrapped as T;
}

/**
 * Shared "resolve canister id -> build agent -> build actor" wiring for the
 * per-domain live canister services, mirroring
 * `frontend/src/lab/localActor.ts`'s `connectLocalDomainActor`.
 */
export async function connectLiveDomainActor<T>(
  target: IcpTargetConfig,
  identity: Identity,
  domainKey: string,
  domainLabel: string,
  idlFactoryForDomain: IDL.InterfaceFactory,
): Promise<T> {
  const { actor } = await createLiveActor<T>(target, identity, domainKey, domainLabel, idlFactoryForDomain);
  return actor;
}

/**
 * Best-effort health check: confirms the configured canister ID resolves to
 * a running canister on the target network by issuing a cheap query call.
 * Callers should treat a thrown error as "not deployed / not reachable yet",
 * not as a fatal application error.
 */
export async function checkLiveCanisterHealth(
  target: IcpTargetConfig,
  identity: Identity,
  domainKey: string,
  domainLabel: string,
  probe: (agent: HttpAgent, canisterId: Principal) => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const canisterId = resolveLiveCanisterId(target, domainKey, domainLabel);
    const agent = await createLiveAgent(target, identity);
    await probe(agent, canisterId);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
