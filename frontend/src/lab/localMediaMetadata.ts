import { Actor } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from './bindings/media_metadata/declarations/media_metadata.did.js';
import type { _SERVICE } from './bindings/media_metadata/declarations/media_metadata.did.js';
import { createMediaMetadataClient, type MediaMetadataClient } from './mediaMetadataClient';
import { createLocalAgent, fetchLocalLabConfig } from './localActor';

export interface LocalMediaMetadataConnection {
  canisterId: Principal;
  client: MediaMetadataClient;
}

let activePersona: string | undefined;
let activeConnection: Promise<LocalMediaMetadataConnection> | undefined;
let generation = 0;

export function resetLocalMediaMetadataClient(): void {
  generation += 1;
  activePersona = undefined;
  const stale = activeConnection;
  activeConnection = undefined;
  void stale?.then(({ client }) => client.dispose(), () => undefined);
}

export function connectLocalMediaMetadataClient(persona: string): Promise<LocalMediaMetadataConnection> {
  if (activeConnection && activePersona === persona) return activeConnection;
  resetLocalMediaMetadataClient();
  activePersona = persona;
  const connectionGeneration = generation;
  const pending = (async () => {
    const config = await fetchLocalLabConfig();
    const mediaMetadataCanisterId = config.canisterIds?.media_metadata;
    if (!mediaMetadataCanisterId) {
      throw new Error('Local media metadata canister is not configured.');
    }
    const agent = await createLocalAgent(config, persona, location.origin);
    const canisterId = Principal.fromText(mediaMetadataCanisterId);
    const actor = Actor.createActor<_SERVICE>(idlFactory, { agent, canisterId });
    const client = createMediaMetadataClient(actor);
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
