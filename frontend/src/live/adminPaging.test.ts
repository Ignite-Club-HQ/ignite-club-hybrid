import { describe, expect, it } from "vitest";
import { readAdminPages } from "./adminPaging";
describe("complete admin display inventories", () => {
  it("retrieves all 501 preferences rather than stopping at 500", async () => {
    const source = Array.from({ length: 501 }, (_, id) => ({ id: String(id) }));
    const rows = await readAdminPages(async (offset, limit) => ({ items: source.slice(offset, offset + limit), total: 501 }), row => row.id, 500);
    expect(rows.length).toBe(501);
    expect(rows.at(-1)?.id).toBe("500");
  });
  it("rejects a missing intermediate page instead of claiming completion", async () => {
    await expect(readAdminPages(async () => ({ items: [], total: 501 }), (row: { id: string }) => row.id)).rejects.toThrow("Incomplete");
  });
  it("rejects duplicate rows and changing totals", async () => {
    await expect(readAdminPages(async () => ({ items: [{ id: "same" }], total: 2 }), row => row.id, 1)).rejects.toThrow("changed");
    await expect(readAdminPages(async offset => ({ items: [{ id: String(offset) }], total: offset ? 3 : 2 }), row => row.id, 1)).rejects.toThrow("changed");
  });
});