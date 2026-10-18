/** Write adapters for the explicit inactive group session (not registered in
 * production dispatch). Every write targets the club's assigned group as one
 * unit: bytes, encryption records and metadata all land in that group. */
import type { openGroupSession } from './groupSession';
import type { LiveEventInput } from './features/events';
import type { LiveMessageAttachment } from './features/messaging';
type Session = Awaited<ReturnType<typeof openGroupSession>>;

export function groupWriteFeatures(session: Session) {
  return {
    sendMessage: (clubId: string, conversationId: string, body: string, key: string,
      attachment?: LiveMessageAttachment | null, replyToId?: string | null) =>
      session.writeClub(clubId, 'messaging_domain', key, async (ctx, k) => {
        const { sendLiveMessage } = await import('./features/messaging');
        return sendLiveMessage(ctx, conversationId, body, k, attachment, replyToId);
      }),
    createEvent: (input: LiveEventInput, key: string) =>
      session.writeClub(input.clubId, 'events_domain', key, async ctx => {
        const { createLiveEvent } = await import('./features/events');
        return createLiveEvent(ctx, input);
      }, 1), // canister has no idempotency key for create: never auto-retry
    updateEvent: (clubId: string, eventId: string, input: Omit<LiveEventInput, 'clubId' | 'teamId'>, key: string) =>
      session.writeClub(clubId, 'events_domain', key, async ctx => {
        const { updateLiveEvent } = await import('./features/events');
        return updateLiveEvent(ctx, eventId, input); // full overwrite: idempotent
      }),
    createVaultFolder: (clubId: string, id: string, teamId: string | null, parentId: string | null, name: string, roles: string[]) =>
      session.writeClub(clubId, 'vault_domain', id, async ctx => {
        const { createLiveVaultFolder } = await import('./features/vault');
        return createLiveVaultFolder(ctx, id, clubId, teamId, parentId, name, roles);
      }),
    uploadClubMedia: (clubId: string, storagePath: string, file: Blob, mime: string, lock: 'club' | 'own' = 'club') => {
      if (!storagePath.startsWith(`clubs/${clubId}/`)) throw new Error('Media path outside routed club');
      return session.writeClub(clubId, 'media_metadata', storagePath, async ctx => {
        const [{ uploadBytesToBlobStore }, pii, vault, { MEDIA_BLOB_PII_FIELD }, { sha256Hex }] = await Promise.all([
          import('./blobStoreUpload'), import('./piiVetKeys'), import('./features/vault'), import('./mediaDecrypt'), import('./blobStoreProtocol')]);
        if (file.size > 10 * 1024 * 1024) throw new Error('This file is larger than 10 MB. Please choose a smaller file.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (lock === 'club' && await pii.isClubMediaLockSupported(ctx)) {
          return uploadBytesToBlobStore(ctx.target, ctx.identity, storagePath, await pii.encryptClubMedia(ctx, clubId, bytes), mime);
        }
        const ciphertext = await pii.encryptPiiValue(ctx, storagePath, MEDIA_BLOB_PII_FIELD, bytes);
        await vault.registerLivePii(ctx, storagePath, MEDIA_BLOB_PII_FIELD, new TextEncoder().encode(await sha256Hex(ciphertext)), ctx.identity.getPrincipal());
        await vault.grantLiveClubPiiRead(ctx, storagePath, MEDIA_BLOB_PII_FIELD, clubId);
        return uploadBytesToBlobStore(ctx.target, ctx.identity, storagePath, ciphertext, mime);
      });
    },
    registerVaultFile: (clubId: string, f: { id: string; folderId: string; teamId: string | null; name: string; url: string; size: number; mime: string;
      blobRef: Parameters<typeof import('./features/vault').registerLiveVaultFile>[10] }) =>
      session.writeClub(clubId, 'vault_domain', f.id, async ctx => {
        const { registerLiveVaultFile } = await import('./features/vault');
        return registerLiveVaultFile(ctx, f.id, f.folderId, clubId, f.teamId, f.name, f.url, f.size, f.mime, false, f.blobRef);
      }),
  };
}
