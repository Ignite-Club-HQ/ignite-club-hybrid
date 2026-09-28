import { Actor, HttpAgent, type Identity } from '@icp-sdk/core/agent';
import type { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from './bindings/declarations/club_links.did.js';
import type { _SERVICE } from './bindings/declarations/club_links.did.js';
import { syntheticIdentity } from './syntheticIdentities.mjs';

export interface LocalConfig { canisterId: string; rootKey: string; network: 'local' }
export interface LocalLabConfig extends LocalConfig {
  identityAccessCanisterId?: string;
  internetIdentityCanisterId?: string;
  internetIdentityAuthorizeUrl?: string;
  canisterIds?: Record<string, string | undefined>;
}

function validateCanisterId(value: string, label: string): Principal {
  const id = Principal.fromText(value);
  if (id.isAnonymous() || id.toText() === 'aaaaa-aa') throw new Error(`Invalid local ${label} canister ID`);
  return id;
}

export function validateLocalConfig(value: LocalConfig): LocalConfig {
  if (value?.network !== 'local' || !/^[0-9a-f]{266}$/i.test(value.rootKey)) throw new Error('Local ICP configuration is missing or invalid');
  validateCanisterId(value.canisterId, 'club links');
  return value;
}

export function validateLocalLabConfig(value: LocalLabConfig): LocalLabConfig {
  validateLocalConfig(value);
  if (value.identityAccessCanisterId !== undefined) {
    validateCanisterId(value.identityAccessCanisterId, 'identity access');
  }
  if (value.internetIdentityCanisterId !== undefined) {
    validateCanisterId(value.internetIdentityCanisterId, 'internet identity');
  }
  if (value.internetIdentityAuthorizeUrl !== undefined) {
    const authorizeUrl = new URL(value.internetIdentityAuthorizeUrl);
    if (authorizeUrl.protocol !== 'http:' || authorizeUrl.hostname !== 'id.ai.localhost' || authorizeUrl.pathname !== '/authorize' || authorizeUrl.username || authorizeUrl.password) {
      throw new Error('Local Internet Identity authorize URL is missing or invalid');
    }
  }
  for (const [name, canisterId] of Object.entries(value.canisterIds ?? {})) {
    if (canisterId !== undefined) validateCanisterId(canisterId, name);
  }
  return value;
}

function createLocalReplicaFetch(origin: string, transport: typeof fetch = globalThis.fetch): typeof fetch {
  return (input, init) => {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);
    const base = new URL(origin);
    if (target.origin !== base.origin || !/^\/api\/(v2|v3|v4)\//.test(target.pathname) || target.username || target.password || target.hash || !['http:', 'https:'].includes(target.protocol)) {
      throw new Error('Non-local ICP request blocked');
    }
    target.pathname = `/icp${target.pathname}`;
    return transport(target, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store' });
  };
}

export async function createLocalAgentWithIdentity(config: LocalConfig, identity: Identity, origin: string, transport: typeof fetch = globalThis.fetch) {
  validateLocalConfig(config);
  const base = new URL(origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.origin !== origin) throw new Error('Invalid lab origin');
  // The current SDK resolves absolute /api paths. Rewrite every call to the fixed same-origin
  // lab proxy, including Codespaces custom domains. Never allow the SDK's mainnet default host.
  return HttpAgent.create({
    host: origin, identity,
    rootKey: Uint8Array.from(config.rootKey.match(/../g)!, b => parseInt(b,16)),
    shouldFetchRootKey: false, shouldSyncTime: false, useQueryNonces: true,
    fetch: createLocalReplicaFetch(origin, transport), retryTimes: 1,
  });
}

export async function createLocalAgent(config: LocalConfig, persona: string, origin: string, transport: typeof fetch = globalThis.fetch) {
  return createLocalAgentWithIdentity(config, syntheticIdentity(persona), origin, transport);
}

export async function createLocalActor(config: LocalConfig, persona: string, origin: string, transport: typeof fetch = globalThis.fetch) {
  const agent = await createLocalAgent(config, persona, origin, transport);
  // Raw generated Candid declarations use the core Actor API, not bindgen's wrapper API.
  return Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId: config.canisterId });
}

export async function fetchLocalLabConfig(): Promise<LocalLabConfig> {
  const response = await fetch('/icp/api/v2/lab-config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Local ICP is not configured. Start and deploy the local canisters.');
  return validateLocalLabConfig(await response.json());
}

/**
 * Shared "resolve canister id -> build agent -> build actor" wiring for the
 * per-domain local canister services (events, competition, messaging, ...).
 * Each domain service still owns its own idl/type imports and domain client,
 * this only removes the copy-pasted connect-actor boilerplate.
 */
export async function connectLocalDomainActor<T>(
  persona: string,
  domainKey: string,
  domainLabel: string,
  idlFactoryForDomain: IDL.InterfaceFactory,
): Promise<T> {
  const config = await fetchLocalLabConfig();
  const canisterId = config.canisterIds?.[domainKey];
  if (!canisterId) throw new Error(`Local ${domainLabel} domain canister is not configured.`);
  const agent = await createLocalAgent(config, persona, location.origin);
  return Actor.createActor<T>(idlFactoryForDomain, { agent, canisterId: Principal.fromText(canisterId) });
}

export async function connectLocalActor(persona: string) {
  return (await connectLocalActorWithConfig(persona)).actor;
}

export async function connectLocalActorWithConfig(persona: string): Promise<{ actor: _SERVICE; canisterId: Principal }> {
  const config = await fetchLocalLabConfig();
  return { actor: await createLocalActor(config, persona, location.origin), canisterId: Principal.fromText(config.canisterId) };
}
