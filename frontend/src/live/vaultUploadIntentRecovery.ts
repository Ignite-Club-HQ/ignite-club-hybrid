import type { FeatureBackendContext } from "./featureRouter";
import type { VaultFile } from "../lab/bindings/vault_domain/declarations/vault_domain.did.js";

/** Readback first: never rewrite ciphertext or private access records to guess an outcome. */
export async function reconcileVaultUploadIntent(
  ctx: FeatureBackendContext,
  id: string,
  ops: {
    read: () => Promise<{ file: VaultFile; ready: boolean }>;
    marker: (path: string) => Promise<string | null>;
    grant: (file: VaultFile, path: string) => Promise<void>;
    acknowledge: () => Promise<unknown>;
    recover: () => Promise<unknown>;
  },
): Promise<void> {
  const intent = await ops.read();
  if (intent.file.id !== id || intent.file.uploaded_by.toText() !== ctx.identity.getPrincipal().toText()) throw new Error("Upload owner changed");
  if (!intent.ready) {
    const ref = intent.file.blob_ref[0];
    if (!ref) throw new Error("Upload provenance unavailable");
    if (await ops.marker(ref.path) !== ref.content_hash) return; // unresolved: retain without rewriting/deleting
    await ops.grant(intent.file, ref.path);
    // The canister independently verifies original store/hash/size/current scope.
    await ops.acknowledge();
  }
  await ops.recover();
}