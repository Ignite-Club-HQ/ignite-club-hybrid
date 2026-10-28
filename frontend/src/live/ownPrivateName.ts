import { onPrivateProfileSessionRetired } from './privateProfileSession';

/** In-memory only: the signed-in person's own unlocked name, so their own
 * rows (events, chats, posts, lists) never show "Unknown" after a secure save.
 * Never persisted; dropped when the private-profile session retires. */
let own: { principal: string; name: string } | undefined;
onPrivateProfileSessionRetired(() => { own = undefined; });

export function rememberOwnPrivateName(principal: string, name: string): void {
  const value = name.trim();
  if (!principal || !value) return;
  own = { principal, name: value };
  // Screens that asked "who is this?" before the unlock finished may already
  // have saved a blank copy of my own row for an hour. Replace those copies
  // now, so every open screen shows the name without waiting for a refetch.
  void refreshSavedOwnRows(principal, value);
}

async function refreshSavedOwnRows(principal: string, name: string): Promise<void> {
  try {
    const [{ getProfileFromCache, updateProfileCache }, { accountIdForPrincipal }] = await Promise.all([
      import('../lib/profileCache'),
      import('./features/identityAccessClient'),
    ]);
    const ids = new Set([principal, `principal:${principal}`]);
    const accountId = await accountIdForPrincipal(principal);
    if (accountId) ids.add(accountId);
    for (const id of ids) {
      // Only rows the app has already saved: inventing an entry would mark an
      // un-fetched profile fresh and stop its avatar ever loading.
      const cached = getProfileFromCache(id);
      if (!cached || cached.display_name === name) continue;
      updateProfileCache({ id, display_name: name, avatar_url: cached.avatar_url });
    }
  } catch {
    // Display-only refresh; the unlocked name is still remembered in memory.
  }
}

export function recallOwnPrivateName(principal: string): string | undefined {
  return own && own.principal === principal ? own.name : undefined;
}

/** Replace the caller's own private reference with their remembered name. */
export function fillOwnPrivateName<T extends { display_name: string | null }>(rows: T[], caller: string): T[] {
  const name = recallOwnPrivateName(caller);
  if (!name) return rows;
  return rows.map(row => {
    const ref = row.display_name;
    if (!ref?.startsWith('pii-display-name:')) return row;
    const subject = ref.split(':').pop();
    return subject === caller ? { ...row, display_name: name } : row;
  });
}
