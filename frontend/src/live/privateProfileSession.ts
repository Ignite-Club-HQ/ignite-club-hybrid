/** Synchronous local disclosure retirement; never a canister access grant. */
let generation = 0;
let principal: string | undefined;
const listeners = new Set<() => void>();
export function capturePrivateProfileSession(): () => void {
  const captured = generation;
  return () => {
    if (captured !== generation) throw new Error('Private profile session retired.');
  };
}
export function retirePrivateProfileSession(): void {
  generation++;
  for (const listener of listeners) {
    try { listener(); } catch { /* Retirement must reach every mounted reader. */ }
  }
}
export function observePrivateProfilePrincipal(current: string): void {
  if (principal !== undefined && principal !== current) retirePrivateProfileSession();
  principal = current;
}
export function onPrivateProfileSessionRetired(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const PRIVATE_PROFILE_DISPLAY_LIFETIME_MS = 60_000;