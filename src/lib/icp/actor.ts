import { Actor, type ActorSubclass, type Identity } from "@dfinity/agent";
import type { IDL } from "@dfinity/candid";

import { createAgent } from "./agent";

/**
 * Create a typed actor for a canister.
 *
 * Pass the IDL factory from the generated declarations for your canister
 * (see src/lib/icp/declarations/README.md). Until canisters are deployed and
 * declarations are generated, this factory is the integration point — nothing
 * else needs to change.
 */
export function createActor<T>(
  canisterId: string,
  interfaceFactory: IDL.InterfaceFactory,
  identity?: Identity,
): ActorSubclass<T> {
  return Actor.createActor<T>(interfaceFactory, {
    agent: createAgent(identity),
    canisterId,
  });
}
