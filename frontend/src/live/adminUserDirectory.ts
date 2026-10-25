import type { FeatureBackendContext } from "./featureRouter";
import { connectLiveIdentityAccessClientWithIdentity } from "./identityAccess";
import { unwrapCandid } from "./features/candid";

export async function readAdminUserDirectory(ctx: FeatureBackendContext, query: string, after: string | null) {
  const { createLiveActor } = await import("./icpAgent");
  const { idlFactory } = await import("../lab/bindings/identity_access/declarations/identity_access.did.js");
  const { actor } = await createLiveActor<import("../lab/bindings/identity_access/declarations/identity_access.did.js")._SERVICE>(ctx.target, ctx.identity, "identity_access", "Identity", idlFactory);
  return unwrapCandid(actor.list_admin_accounts(query.trim(), after ? [after] : [], 100), "Read admin user directory");
}

export async function updateAdminAccountStatus(ctx: FeatureBackendContext, account: string, status: "Active" | "Suspended") {
  const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
  try { return await client.setAccountStatus(account, status); }
  finally { client.dispose(); }
}