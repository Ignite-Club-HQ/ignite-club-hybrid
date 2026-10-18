import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { tryUploadMediaToBlobStore } from "@/live/mediaUpload";

/**
 * ICP-routed save path for the monogram logo generator. Uploads the
 * generated PNG to the encrypted blob store and writes the resulting URL
 * onto the club's profile via the club domain canister, mirroring the
 * Supabase `club-logos` bucket + `clubs.logo_url` update used for email
 * sessions.
 */
export async function saveIcpMonogramLogo(clubId: string, blob: Blob): Promise<string> {
  if (!clubId) throw new Error("Choose a club before saving a logo");
  const id = crypto.randomUUID();
  return withFeatureBackend("membership", {
    supabase: () => { throw new Error("Monogram logo save could not connect to ICP. Please try again."); },
    icp: async (ctx) => {
      const uploaded = await tryUploadMediaToBlobStore({
        storagePath: `clubs/${clubId}/logos/${id}.png`,
        file: blob,
        mime: "image/png",
      });
      if (!uploaded) throw new Error("Logo upload could not connect to ICP storage. Please try again.");
      const { getLiveClubProfile, saveLiveClubProfile } = await import("@/live/features/club");
      const existing = await getLiveClubProfile(ctx, clubId);
      const profile = existing.length ? existing[0] : { id: clubId };
      await saveLiveClubProfile(ctx, { ...profile, id: clubId, logo_url: uploaded.url } as any);
      return uploaded.url;
    },
  }, writeOnce({ clubId: clubId! }));
}
