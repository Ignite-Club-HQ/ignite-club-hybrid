// Allowed configured sizes; admission and allocator headroom still apply.
export const GIB = 1_073_741_824n;
export const ENLARGE_CONFIRMATION = 'ENLARGE GROUP 1 PHOTO STORE';
export function assertEnlargeConfirmation(value) {
  if (typeof value !== 'string' || value.trim() !== ENLARGE_CONFIRMATION) {
    throw new Error(`Confirmation must be exactly ${ENLARGE_CONFIRMATION}; nothing changed`);
  }
}
export function capacityBytesFor(gib) {
  const n = Number(gib);
  if (!Number.isInteger(n) || n < 3 || n > 200) throw new Error("Size must be a whole number of GB from 3 to 200");
  return BigInt(n) * GIB;
}
