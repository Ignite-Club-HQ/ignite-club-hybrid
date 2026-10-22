/** Gallery continuations live only in the owning account/target request. */
export type MediaPageCursor = { club_id: string; revision: bigint; before: string };
export type MediaAssetPage<T> = { assets: T[]; next: MediaPageCursor | null; bounded: boolean };

export async function readCompatibleMediaPage<T>(
  paged: () => Promise<{ Ok: { assets: T[]; next: [] | [MediaPageCursor] } } | { Err: string }>,
  legacy: () => Promise<T[]>,
  first: boolean,
): Promise<MediaAssetPage<T>> {
  let reply: Awaited<ReturnType<typeof paged>>;
  try {
    reply = await paged();
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? error);
    // Only an explicit missing method permits legacy compatibility. Denied,
    // unavailable, stale and interrupted continuations must remain failures.
    if (first && /has no (query|update) method|method not found/i.test(message) && /(?:read_account_)?list_assets_page\b/.test(message)) {
      return { assets: await legacy(), next: null, bounded: false };
    }
    throw error;
  }
  if ('Err' in reply) {
    if (first && reply.Err === 'Media page index not ready') return { assets: await legacy(), next: null, bounded: false };
    throw new Error(reply.Err);
  }
  return { assets: reply.Ok.assets, next: reply.Ok.next[0] ?? null, bounded: true };
}