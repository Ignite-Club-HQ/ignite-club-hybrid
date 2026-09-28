import { Actor, HttpAgent, type Identity } from "@icp-sdk/core/agent";
import type { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import type { IcpTargetConfig } from "./targetRegistry";

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

export async function createLiveAgent(target: IcpTargetConfig, identity: Identity): Promise<HttpAgent> {
  const host = resolveTargetHost(target);
  const cacheKey = `${target.alias}|${host}|${identity.getPrincipal().toText()}`;
  const cached = liveAgentCache.get(cacheKey);
  if (cached) return cached;
  const created = HttpAgent.create({
    host,
    identity,
    shouldSyncTime: true,
    useQueryNonces: true,
    retryTimes: 2,
  });
  liveAgentCache.set(cacheKey, created);
  // A failed handshake must not poison the cache: drop the entry so the next
  // call retries instead of reusing a rejected agent forever.
  created.catch(() => {
    if (liveAgentCache.get(cacheKey) === created) liveAgentCache.delete(cacheKey);
  });
  return created;
}

/** Drops every cached agent; called on Internet Identity sign-out. */
export function clearLiveAgentCache(): void {
  liveAgentCache.clear();
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
  return { actor: Actor.createActor<T>(idlFactoryForDomain, { agent, canisterId }), canisterId };
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
