import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, unwrapCandidOpt } from "./candid";
import { getLiveClubSettings, saveLiveClubSettings } from "./club";

/**
 * News feature -> club_domain canister (club announcements live in club
 * settings; there is no dedicated news canister in the backend topology).
 *
 * NOTE: untested against a live canister until deployment. The Supabase news
 * surface (posts with attachments, per-club feeds) is richer than a single
 * announcement string — the full post model is expected to land in
 * club_domain; until then the ICP branch covers the announcement only.
 */

export async function getLiveClubAnnouncement(
  ctx: FeatureBackendContext,
  clubId: string,
): Promise<string> {
  const settings = await getLiveClubSettings(ctx, clubId);
  if (settings.length === 0) return "";
  return settings[0].announcement[0] ?? "";
}

export async function saveLiveClubAnnouncement(
  ctx: FeatureBackendContext,
  clubId: string,
  announcement: string,
) {
  const settings = unwrapCandidOpt(
    await getLiveClubSettings(ctx, clubId),
    "Load club settings",
  );
  return saveLiveClubSettings(ctx, {
    ...settings,
    announcement: candidOpt(announcement),
  });
}
