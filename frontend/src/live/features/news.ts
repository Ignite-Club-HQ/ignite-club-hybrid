import type { FeatureBackendContext } from "../featureRouter";
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
  return settings.announcement;
}

export async function saveLiveClubAnnouncement(
  ctx: FeatureBackendContext,
  clubId: string,
  announcement: string,
) {
  const settings = await getLiveClubSettings(ctx, clubId);
  return saveLiveClubSettings(ctx, { ...settings, announcement });
}
