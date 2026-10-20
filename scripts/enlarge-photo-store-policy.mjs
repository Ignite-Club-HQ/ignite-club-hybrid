// Allowed photo-store sizes for the larger stable-backed mode (store ceiling is 32 GiB).
export const GIB = 1_073_741_824n;
export function capacityBytesFor(gib) {
  const n = Number(gib);
  if (!Number.isInteger(n) || n < 3 || n > 32) throw new Error('Size must be a whole number of GB from 3 to 32');
  return BigInt(n) * GIB;
}
