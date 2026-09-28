import { Actor } from '@icp-sdk/core/agent';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from './bindings/identity_access/declarations/identity_access.did.js';
import type { _SERVICE } from './bindings/identity_access/declarations/identity_access.did.js';
import { createIdentityAccessClient, type IdentityAccessClient } from './identityAccessClient';
import { createLocalAgent, createLocalAgentWithIdentity, fetchLocalLabConfig } from './localActor';

export interface LocalIdentityAccessConnection {
  canisterId: Principal;
  client: IdentityAccessClient;
}

let activePersona: string | undefined;
let activeConnection: Promise<LocalIdentityAccessConnection> | undefined;
let generation = 0;

export function resetLocalIdentityAccessClient(): void {
  generation += 1;
  activePersona = undefined;
  const stale = activeConnection;
  activeConnection = undefined;
  void stale?.then(({ client }) => client.dispose(), () => undefined);
}

export function connectLocalIdentityAccessClient(persona: string): Promise<LocalIdentityAccessConnection> {
  if (activeConnection && activePersona === persona) return activeConnection;
  resetLocalIdentityAccessClient();
  activePersona = persona;
  const connectionGeneration = generation;
  const pending = (async () => {
    const config = await fetchLocalLabConfig();
    const identityAccessCanisterId = config.identityAccessCanisterId ?? config.canisterIds?.identity_access;
    if (!identityAccessCanisterId) {
      throw new Error('Local identity access canister is not configured.');
    }
    const agent = await createLocalAgent(config, persona, location.origin);
    const canisterId = Principal.fromText(identityAccessCanisterId);
    const actor = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId });
    const client = createIdentityAccessClient(actor);
    if (connectionGeneration !== generation) {
      client.dispose();
      throw new Error('Identity changed; connection discarded');
    }
    return { canisterId, client };
  })();
  activeConnection = pending.catch((error: unknown) => {
    if (connectionGeneration === generation) {
      activeConnection = undefined;
      activePersona = undefined;
    }
    throw error;
  });
  return activeConnection;
}

export async function connectLocalIdentityAccessClientWithIdentity(identity: Identity): Promise<LocalIdentityAccessConnection> {
  resetLocalIdentityAccessClient();
  const config = await fetchLocalLabConfig();
  const identityAccessCanisterId = config.identityAccessCanisterId ?? config.canisterIds?.identity_access;
  if (!identityAccessCanisterId) {
    throw new Error('Local identity access canister is not configured.');
  }
  const agent = await createLocalAgentWithIdentity(config, identity, location.origin);
  const canisterId = Principal.fromText(identityAccessCanisterId);
  const actor = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId });
  return { canisterId, client: createIdentityAccessClient(actor) };
}
