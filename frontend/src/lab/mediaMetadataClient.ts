import type { _SERVICE } from './bindings/media_metadata/declarations/media_metadata.did.js';

export type MediaMetadataClient = ReturnType<typeof createMediaMetadataClient>;

/**
 * Thin, typed wrapper around the raw candid actor for the media_metadata
 * canister. Mirrors identityAccessClient.ts: unwrap {Ok}/{Err} results into
 * throw/return, translate optional params to candid's `[] | [T]` shape, and
 * fail closed once the underlying identity/session is discarded.
 */
export function createMediaMetadataClient(actor: _SERVICE) {
  let disposed = false;
  const live = () => { if (disposed) throw new Error('Identity changed; operation discarded'); };
  const call = async <T>(operation: () => Promise<{ Ok: T } | { Err: string }>) => {
    live();
    const result = await operation();
    live();
    if ('Err' in result) throw new Error(result.Err);
    return result.Ok;
  };
  return {
    registerAsset: (
      clubId: string,
      kind: string,
      mime: string,
      checksum: string,
      storagePath: string,
      visibility: string,
      expiresAtMs: bigint,
    ) => call(() => actor.register_asset(clubId, kind, mime, checksum, storagePath, visibility, expiresAtMs)),
    getAsset: (assetId: string) => { live(); return actor.get_asset(assetId); },
    listAssets: (clubId: string) => { live(); return actor.list_assets(clubId); },
    deleteAsset: (assetId: string) => call(() => actor.delete_asset(assetId)),
    issueCapability: (assetId: string, action: string, purpose: string, expiresAtMs: bigint) =>
      call(() => actor.issue_capability(assetId, action, purpose, expiresAtMs)),
    addReaction: (assetId: string, kind: string, createdAtMs: bigint) =>
      call(() => actor.add_reaction(assetId, kind, createdAtMs)),
    removeReaction: (assetId: string) => call(() => actor.remove_reaction(assetId)),
    listReactions: (assetId: string) => { live(); return actor.list_reactions(assetId); },
    addComment: (assetId: string, body: string, createdAtMs: bigint) =>
      call(() => actor.add_comment(assetId, body, createdAtMs)),
    listComments: (assetId: string) => { live(); return actor.list_comments(assetId); },
    deleteComment: (commentId: string) => call(() => actor.delete_comment(commentId)),
    grantRole: (principal: Parameters<_SERVICE['grant_role']>[0], role: string, clubId?: string, teamId?: string) =>
      call(() => actor.grant_role(principal, role, clubId ? [clubId] : [], teamId ? [teamId] : [])),
    dispose() { disposed = true; },
  };
}
