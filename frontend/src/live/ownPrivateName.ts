import { onPrivateProfileSessionRetired } from './privateProfileSession';

/** In-memory only: the signed-in person's own unlocked name, so their own
 * rows (events, chats, posts, lists) never show "Unknown" after a secure save.
 * Never persisted; dropped when the private-profile session retires. */
let own: { principal: string; name: string } | undefined;
onPrivateProfileSessionRetired(() => { own = undefined; });

export function rememberOwnPrivateName(principal: string, name: string): void {
  const value = name.trim();
  if (principal && value) own = { principal, name: value };
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
