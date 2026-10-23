/** Shared operator-only source observation transport. Generated update methods
 * only; no writes, public query fallback or authorization evidence. */
import { Actor, type HttpAgent } from '@icp-sdk/core/agent';
import { idlFactory as clubIdl } from '../src/lab/bindings/club_domain/declarations/club_domain.did.js';
import type { _SERVICE as ClubService, Cursor } from '../src/lab/bindings/club_domain/declarations/club_domain.did';
import { directorySources } from '../../scripts/membership-lookup-release-policy.mjs';
import { fingerprint } from '../../scripts/membership-source-configuration.mjs';

type Source = { groupId: string; canisterId: string };
export function membershipOwnershipTransport(agent: HttpAgent, registry: () => Promise<{ revision: bigint; groups: unknown[]; placements: unknown[] }>) {
  const actors = new Map<string, ClubService>();
  const actor = (source: Source) => {
    let service = actors.get(source.canisterId);
    if (!service) {
      service = Actor.createActor<ClubService>(clubIdl, { agent, canisterId: source.canisterId });
      actors.set(source.canisterId, service);
    }
    return service;
  };
  return {
    async registry() {
      const snapshot = await registry();
      return { sources: directorySources(snapshot), fingerprint: fingerprint(snapshot) };
    },
    read: (source: Source, cursor: Cursor | null) => actor(source).read_membership_source_page(cursor ? [cursor] : []),
    async status(source: Source) {
      const reply = await actor(source).read_membership_discovery_status();
      if ('Err' in reply) throw new Error(reply.Err);
      return reply.Ok;
    },
  };
}