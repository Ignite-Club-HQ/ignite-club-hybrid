import { beforeEach, describe, expect, it, vi } from "vitest";
const routing = vi.hoisted(() => ({ icp: false }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => routing.icp }));
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertClubMediaFits, clubMediaLimit, listStoredClubMedia, uploadWithinClubMediaAllowance } from "./clubMediaAllowance";
type Client = SupabaseClient<Database>;
const gib = 1024 ** 3;

function fakeClient(options: { error?: unknown; used?: number; purchased?: number; pro?: boolean; version?: string } = {}) {
  const list = vi.fn(async (folder: string) => ({
    data: folder === "clubs/club-a" ? [{ id: "object", name: "image.jpg", metadata: { size: (options.used ?? 0) / 3 } }] : [],
    error: options.error ?? null,
  }));
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({
    data: { plan: "standard", pricing_version: options.version ?? "usd_v2", is_pro: options.pro ?? true, storage_purchased_gb: options.purchased ?? 0 }, error: null,
  }) };
  return { client: { from: () => query, storage: { from: () => ({ list }) } } as unknown as Client, list };
}

describe("Combined club media allowance", () => {
  beforeEach(() => { routing.icp = false; });
  it("never lists Supabase media when storage is routed to ICP", async () => {
    routing.icp = true;
    const fake = fakeClient();
    await expect(listStoredClubMedia("club-a", fake.client)).rejects.toThrow("Internet Computer");
    expect(fake.list).not.toHaveBeenCalled();
  });
  it("never queries or uploads through Supabase in ICP mode, including personal uploads", async () => {
    routing.icp = true;
    const from = vi.fn();
    const client = { from } as unknown as Client;
    const upload = vi.fn();
    await expect(uploadWithinClubMediaAllowance("club-a", 1, upload, client)).rejects.toThrow("Internet Computer");
    await expect(uploadWithinClubMediaAllowance(null, 1, upload, client)).rejects.toThrow("Internet Computer");
    expect(from).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
  it("allows exactly 3 GiB combined and refuses one byte more", () => {
    expect(clubMediaLimit(0)).toBe(3_221_225_472);
    expect(() => assertClubMediaFits(2 * gib, gib, 0)).not.toThrow();
    expect(() => assertClubMediaFits(2 * gib, gib + 1, 0)).toThrow();
  });
  it("adds purchased GB to the one shared allowance", () => {
    expect(clubMediaLimit(2)).toBe(5 * gib);
    expect(() => assertClubMediaFits(3 * gib, 2 * gib, 2)).not.toThrow();
    expect(() => assertClubMediaFits(3 * gib, 2 * gib + 1, 2)).toThrow();
  });
  it("counts gallery, vault and chat physical objects rather than duplicate row references", async () => {
    const fake = fakeClient({ used: 600 });
    const objects = await listStoredClubMedia("club-a", fake.client);
    expect(objects.map(object => object.bucket)).toEqual(["photos", "chat-attachments", "competition-vault"]);
    expect(objects.reduce((sum, object) => sum + object.size, 0)).toBe(600);
    expect(fake.list.mock.calls.every(([path]) => path === "clubs/club-a")).toBe(true);
  });
  it("refuses upload when gallery plus chat plus vault are full", async () => {
    const upload = vi.fn();
    await expect(uploadWithinClubMediaAllowance("club-a", 1, upload, fakeClient({ used: 3 * gib }).client)).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
  it("refuses upload when storage cannot be read", async () => {
    const upload = vi.fn();
    await expect(uploadWithinClubMediaAllowance("club-a", 1, upload, fakeClient({ error: new Error("denied") }).client)).rejects.toThrow("denied");
    expect(upload).not.toHaveBeenCalled();
  });
  it("checks Free combined storage as well as cycle rules", async () => {
    const fake = fakeClient({ pro: false });
    const upload = vi.fn().mockResolvedValue("uploaded");
    await expect(uploadWithinClubMediaAllowance("club-a", 1, upload, fake.client)).resolves.toBe("uploaded");
    expect(fake.list).toHaveBeenCalled();
  });
  it("walks nested folders and pages past 1000 objects", async () => {
    const list = vi.fn(async (folder: string, options: { offset: number }) => ({ data:
      folder.endsWith("club-a") ? [{ id: null, name: "teams", metadata: null }] : options.offset === 0
        ? Array.from({ length: 1000 }, (_, i) => ({ id: String(i), name: `${i}.jpg`, metadata: { size: 2 } }))
        : [{ id: "last", name: "last.jpg", metadata: { size: 3 } }], error: null }));
    const client = { storage: { from: () => ({ list }) } } as unknown as Client;
    expect((await listStoredClubMedia("club-a", client)).reduce((sum, object) => sum + object.size, 0)).toBe(6009);
    expect(list).toHaveBeenCalledWith("clubs/club-a/teams", expect.objectContaining({ offset: 1000 }));
  });
});
it("preserves legacy paid 5 GiB through its existing term", async () => {
  const upload = vi.fn().mockResolvedValue("stored");
  await expect(uploadWithinClubMediaAllowance("club-a", 1, upload, fakeClient({ used: 3 * gib, version: "legacy" }).client)).resolves.toBe("stored");
});
it("blocks Free uploads above 250 MiB without deleting existing objects", async () => {
  const upload = vi.fn();
  await expect(uploadWithinClubMediaAllowance("club-a", 1, upload, fakeClient({ used: 262144000, pro: false }).client)).rejects.toThrow("250 MB");
  expect(upload).not.toHaveBeenCalled();
});
it("checks only the paid team's 1 GiB, never another team's files", async () => {
  const queries: Record<string, unknown> = {
    club_subscriptions: { is_pro: false }, teams: { club_id: "club-a", deleted_at: null }, team_subscriptions: { is_pro: true },
  };
  const client = {
    from: (table: string) => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: queries[table], error: null }) }; return q; },
    storage: { from: () => ({ list: async (path: string) => ({ data: path === "clubs/club-a" ? [{ name: "teams", id: null, metadata: null }] : path.endsWith("/teams") ? [{ name: "team-a", id: null, metadata: null }, { name: "team-b", id: null, metadata: null }] : [{ name: "file.jpg", id: "file", metadata: { size: path.endsWith("team-a") ? gib / 3 : 4 * gib } }], error: null }) }) },
  } as unknown as Client;
  const upload = vi.fn().mockResolvedValue("stored");
  await expect(uploadWithinClubMediaAllowance("club-a", 0, upload, client, "team-a")).resolves.toBe("stored");
  await expect(uploadWithinClubMediaAllowance("club-a", 1, upload, client, "team-a")).rejects.toThrow("full");
  queries.teams = { club_id: "different-club", deleted_at: null };
  await expect(uploadWithinClubMediaAllowance("club-a", 0, upload, client, "team-a")).rejects.toThrow("does not belong");
});
