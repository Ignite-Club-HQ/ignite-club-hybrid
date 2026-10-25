/** Exact authorized attachment reads; labels never scan unrelated club data. */
export async function fetchIcpEventTitleMap(ids: readonly string[]): Promise<Record<string, string>> {
  const [{ withFeatureBackend }, { listLiveEvents }] = await Promise.all([
    import('@/live/featureRouter'), import('@/live/features/events'),
  ]);
  const entries = await Promise.all(ids.map(id => withFeatureBackend('events', {
    supabase: async () => { throw new Error('ICP event preview cannot use Supabase'); },
    icp: async ctx => {
      const rows = await listLiveEvents(ctx);
      const row = rows.find(event => event.id.toLowerCase() === id.toLowerCase());
      return row ? [id.toLowerCase(), row.title] as const : null;
    },
  }, { eventId: id })));
  return Object.fromEntries(entries.filter(entry => entry !== null));
}

export async function fetchIcpVaultNameMap(ids: readonly string[], kind: 'folder' | 'file'): Promise<Record<string, string>> {
  const [{ withFeatureBackend }, { getLiveVaultFolder, getLiveVaultFile }] = await Promise.all([
    import('@/live/featureRouter'), import('@/live/features/vault'),
  ]);
  const entries = await Promise.all(ids.map(id => withFeatureBackend('vault', {
    supabase: async () => { throw new Error('ICP Vault preview cannot use Supabase'); },
    icp: async ctx => {
      const row = kind === 'folder' ? await getLiveVaultFolder(ctx, id) : await getLiveVaultFile(ctx, id);
      return row ? [id.toLowerCase(), row.name] as const : null;
    },
  }, kind === 'folder' ? { vaultFolderId: id } : { vaultFileId: id })));
  return Object.fromEntries(entries.filter(entry => entry !== null));
}