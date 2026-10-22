// Allowed configured sizes; admission and allocator headroom still apply.
export const GIB = 1_073_741_824n;
/** Every new group's photo store is set to this size at install (owner rule 2026-10-22). */
export const NEW_GROUP_PHOTO_STORE_GIB = 200;
export const ENLARGE_CONFIRMATION = 'ENLARGE GROUP 1 PHOTO STORE';
export function groupNumber(group) {
  const g = String(group ?? '1').trim().replace(/^g/i, '');
  if (!/^[1-9][0-9]?$/.test(g)) throw new Error('Group must be a number such as 1 or 2; nothing changed');
  return g;
}
export const confirmationFor = group => `ENLARGE GROUP ${groupNumber(group)} PHOTO STORE`;
export function assertEnlargeConfirmation(value, group = '1') {
  const want = confirmationFor(group);
  if (typeof value !== 'string' || value.trim() !== want) {
    throw new Error(`Confirmation must be exactly ${want}; nothing changed`);
  }
}
export function capacityBytesFor(gib) {
  const n = Number(gib);
  if (!Number.isInteger(n) || n < 3 || n > 200) throw new Error("Size must be a whole number of GB from 3 to 200");
  return BigInt(n) * GIB;
}
