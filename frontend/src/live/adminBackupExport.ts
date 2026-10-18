import type { FeatureBackendContext } from "./featureRouter";

export const BACKUP_DOMAINS = ["club_domain", "events_domain", "messaging_domain", "competition_domain", "media_metadata", "club_points_domain", "identity_access"] as const;

/** Export only through existing privileged APIs; denial must never become an empty backup. */
export async function exportAdminDomain(ctx: FeatureBackendContext, domain: typeof BACKUP_DOMAINS[number]) {
  const d = await import("./domains");
  let result: unknown;
  if (domain === "identity_access") {
    const { connectLiveIdentityAccessClientWithIdentity } = await import("./identityAccess");
    const { client } = await connectLiveIdentityAccessClientWithIdentity(ctx.target, ctx.identity);
    try { return await client.exportState(); } finally { client.dispose(); }
  }
  switch (domain) {
    case "club_domain": {
      const { actor } = await d.connectLiveClubDomain(ctx.target, ctx.identity);
      result = await actor.export_identity_state(); break;
    }
    case "events_domain": result = await (await d.connectLiveEventsDomain(ctx.target, ctx.identity)).actor.export_state(); break;
    case "messaging_domain": result = await (await d.connectLiveMessagingDomain(ctx.target, ctx.identity)).actor.export_state(); break;
    case "competition_domain": result = await (await d.connectLiveCompetitionDomain(ctx.target, ctx.identity)).actor.export_state(); break;
    case "media_metadata": result = await (await d.connectLiveMediaMetadata(ctx.target, ctx.identity)).actor.export_state(); break;
    case "club_points_domain": result = await (await d.connectLiveClubPointsDomain(ctx.target, ctx.identity)).actor.export_state(); break;
  }
  if (!result || typeof result !== "object" || !("Ok" in result)) {
    throw new Error(result && typeof result === "object" && "Err" in result ? String(result.Err) : "Invalid export response");
  }
  return result.Ok;
}