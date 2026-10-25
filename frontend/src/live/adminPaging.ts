/** Read a bounded offset API without silently publishing a truncated inventory.
 * A changed total, empty intermediate page or duplicate identity refuses completion.
 * This is a display inventory, not an authorization or snapshot receipt.
 */
export async function readAdminPages<T>(
  read: (offset: number, limit: number) => Promise<{ items: T[]; total: number }>,
  key: (item: T) => string,
  limit = 200,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let expected: number | undefined;
  for (let page = 0; page < 10000; page++) {
    const reply = await read(rows.length, limit);
    if (!Number.isSafeInteger(reply.total) || reply.total < 0 || reply.items.length > limit) throw new Error("Invalid admin inventory");
    if (expected !== undefined && reply.total !== expected) throw new Error("Admin inventory changed; refresh to retry");
    expected = reply.total;
    for (const row of reply.items) {
      const id = key(row);
      if (!id || seen.has(id)) throw new Error("Admin inventory changed; refresh to retry");
      seen.add(id);
      rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (!reply.items.length || rows.length > expected) throw new Error("Incomplete admin inventory; refresh to retry");
  }
  throw new Error("Admin inventory is too large; narrow the selection");
}