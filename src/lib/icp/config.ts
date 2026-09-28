/**
 * ICP connection configuration.
 *
 * Values come from VITE_ICP_* environment variables (see .env) so the same
 * build can point at a local replica or the IC mainnet. Canister IDs are not
 * secrets — it is safe for them to be public/client-side.
 */

const env = import.meta.env;

export const icpConfig = {
  /** "ic" for mainnet, "local" for a local replica (dfx start). */
  network: (env["VITE_ICP_NETWORK"] ?? "ic") as string,
  /** Replica host. Defaults to the IC mainnet boundary node. */
  host: (env["VITE_ICP_HOST"] ?? "https://icp0.io") as string,
  /** Internet Identity provider URL used for login. */
  identityProviderUrl: (env["VITE_II_URL"] ??
    "https://identity.internetcomputer.org") as string,
};

export interface CanisterRef {
  name: string;
  id: string;
}

/**
 * Canisters the app knows about, parsed from VITE_ICP_CANISTER_IDS.
 * Format: "backend:aaaaa-aa,ledger:bbbbb-bb" (comma-separated name:id pairs).
 * Empty until the canisters are deployed and their IDs are added to .env.
 */
export const configuredCanisters: CanisterRef[] = (
  (env["VITE_ICP_CANISTER_IDS"] ?? "") as string
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [name = "canister", id = ""] = entry.split(":");
    return { name: name.trim(), id: id.trim() };
  })
  .filter((canister) => canister.id.length > 0);
