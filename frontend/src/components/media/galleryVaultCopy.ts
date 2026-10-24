import type { FeatureBackendContext } from '@/live/featureRouter';
import { connectLiveClubDomain, connectLiveVaultDomain } from '@/live/domains';
import { unwrapCandid } from '@/live/features/candid';
import { tryUploadMediaToBlobStore } from '@/live/mediaUpload';

/** Separate per-file encryption keeps a Vault copy private to its authorized readers. */
export async function copyGalleryAssetToVault(ctx: FeatureBackendContext, input: {
  assetId: string; clubId: string; teamId: string | null; file: Blob; name: string;
}) {
  const { actor: club } = await connectLiveClubDomain(ctx.target, ctx.identity);
  const allowance = await unwrapCandid(club.get_media_allowance(input.clubId, input.teamId ? [input.teamId] : []), 'Gallery copy allowance');
  if (!allowance.premium) return null;
  const { actor: vault } = await connectLiveVaultDomain(ctx.target, ctx.identity);
  const existing = await unwrapCandid(vault.get_gallery_copy(input.assetId), 'Gallery Vault copy');
  if (existing[0]) return existing[0];
  const storagePath = `clubs/${input.clubId}/vault/${input.teamId ? `teams/${input.teamId}/` : ''}gallery-${crypto.randomUUID()}`;
  const uploaded = await tryUploadMediaToBlobStore({ context: ctx, storagePath, file: input.file, mime: input.file.type || 'application/octet-stream', lock: 'own' });
  if (!uploaded) throw new Error('Could not save the private Vault copy');
  return unwrapCandid(vault.register_gallery_copy(input.assetId, input.name.slice(0, 160), uploaded.url,
    BigInt(input.file.size), input.file.type || 'application/octet-stream', uploaded.blobRef), 'Save gallery Vault copy');
}
