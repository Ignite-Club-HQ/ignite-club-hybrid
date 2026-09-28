import type { Identity } from "@icp-sdk/core/agent";
import type { Principal } from "@icp-sdk/core/principal";
import { idlFactory } from "../lab/bindings/identity_access/declarations/identity_access.did.js";
import type { _SERVICE } from "../lab/bindings/identity_access/declarations/identity_access.did.js";
import { createIdentityAccessClient, type IdentityAccessClient } from "../lab/identityAccessClient";
import { createLiveActor } from "./icpAgent";
import type { IcpTargetConfig } from "./targetRegistry";

export interface LiveIdentityAccessConnection {
  canisterId: Principal;
  client: IdentityAccessClient;
}

const IDENTITY_ACCESS_DOMAIN_KEY = "identity_access";
const IDENTITY_ACCESS_DOMAIN_LABEL = "Identity access";

/** Live (mainnet / Cloud Engine) counterpart of `frontend/src/lab/localIdentityAccess.ts`. */
export async function connectLiveIdentityAccessClientWithIdentity(
  target: IcpTargetConfig,
  identity: Identity,
): Promise<LiveIdentityAccessConnection> {
  const { actor, canisterId } = await createLiveActor<_SERVICE>(
    target,
    identity,
    IDENTITY_ACCESS_DOMAIN_KEY,
    IDENTITY_ACCESS_DOMAIN_LABEL,
    idlFactory,
  );
  return { canisterId, client: createIdentityAccessClient(actor) };
}

export function isLiveIdentityAccessConfigured(target: IcpTargetConfig): boolean {
  return Boolean(target.canisterIds[IDENTITY_ACCESS_DOMAIN_KEY]);
}
