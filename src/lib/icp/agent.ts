import { HttpAgent, type Identity } from "@dfinity/agent";

import { icpConfig } from "./config";

/**
 * Create an HttpAgent for the configured replica.
 *
 * When pointed at a local replica the root key is fetched in the background —
 * required for local development, and never done on mainnet.
 */
export function createAgent(identity?: Identity): HttpAgent {
  const agent = new HttpAgent({ host: icpConfig.host, identity });

  if (icpConfig.network !== "ic") {
    void agent
      .fetchRootKey()
      .catch((err) => console.warn("[ICP] fetchRootKey failed:", err));
  }

  return agent;
}

/** Ping the replica. Resolves with status info when the network is reachable. */
export async function checkReplicaStatus(agent: HttpAgent) {
  return agent.status();
}
