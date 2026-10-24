import { describe, it, expect, vi } from "vitest";

const { mode, removeLiveGalleryAsset, icpContext } = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  removeLiveGalleryAsset: vi.fn(),
  icpContext: { identity: {}, target: {} },
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mode === "icp" ? providers.icp(icpContext) : providers.supabase(),
}));
vi.mock("@/live/features/media", () => ({
  removeLiveGalleryAsset: (...args: unknown[]) => removeLiveGalleryAsset(...args),
}));

import { deleteMediaPhoto } from "./mediaPhotoDeletion";

const supabaseMode = mode === "supabase";

type Err = { message: string; code?: string } | null;

/** Minimal Supabase client double recording every call it receives. */
function makeClient(opts: {
  rpc?: { data?: unknown; error?: Err };
  photoUpdateError?: Err;
  photoLookup?: { data?: { file_url: string | null; image_url: string | null } | null; error?: Err };
  vaultUpdate?: { data?: Array<{ id: string }>; error?: Err };
}) {
  const calls: Array<{ op: string; table?: string; payload?: unknown }> = [];

  const rpc = vi.fn(async () => {
    calls.push({ op: "rpc" });
    return { data: opts.rpc?.data ?? null, error: opts.rpc?.error ?? null };
  });

  const from = vi.fn((table: string) => {
    const builder: any = {
      update(payload: unknown) {
        calls.push({ op: "update", table, payload });
        builder._payload = payload;
        return builder;
      },
      select() {
        calls.push({ op: "select", table });
        if (table === "photos") {
          return {
            eq: () => ({
              single: async () => ({
                data: opts.photoLookup?.data ?? null,
                error: opts.photoLookup?.error ?? null,
              }),
            }),
          };
        }
        return Promise.resolve({
          data: opts.vaultUpdate?.data ?? [],
          error: opts.vaultUpdate?.error ?? null,
        });
      },
      eq() {
        return builder;
      },
      then(resolve: (v: unknown) => unknown) {
        const error = table === "photos" ? opts.photoUpdateError ?? null : opts.vaultUpdate?.error ?? null;
        return Promise.resolve({ data: null, error }).then(resolve);
      },
    };
    return builder;
  });

  return { rpc, from, calls } as any;
}

describe.runIf(supabaseMode)("deleteMediaPhoto — RPC path (transactional, server-authorized)", () => {
  it("feed-only delegates to the RPC and never mutates Vault client-side", async () => {
    const client = makeClient({ rpc: { data: [{ vault_file_id: null, vault_updated: false }] } });
    const result = await deleteMediaPhoto(client, { photoId: "p1", mode: "feed_only" });

    expect(client.rpc).toHaveBeenCalledWith("delete_media_photo", {
      _photo_id: "p1",
      _mode: "feed_only",
    });
    expect(client.from).not.toHaveBeenCalled();
    expect(result.vaultUpdated).toBe(false);
  });

  it("feed-and-vault reports the Vault row updated by the transaction", async () => {
    const client = makeClient({ rpc: { data: [{ vault_file_id: "v1", vault_updated: true }] } });
    const result = await deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" });
    expect(result).toEqual({ photoId: "p1", mode: "feed_and_vault", vaultFileId: "v1", vaultUpdated: true });
  });

  it("surfaces a cross-club / cross-team rejection instead of reporting success", async () => {
    const client = makeClient({ rpc: { error: { message: "forbidden", code: "42501" } } });
    await expect(deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" })).rejects.toThrow(
      "forbidden",
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("surfaces a transactional failure without falling back to partial updates", async () => {
    const client = makeClient({ rpc: { error: { message: "deadlock detected", code: "40P01" } } });
    await expect(deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" })).rejects.toThrow(
      "deadlock detected",
    );
    expect(client.from).not.toHaveBeenCalled();
  });

  it("is idempotent — a repeated delete resolves with the same shape", async () => {
    const client = makeClient({ rpc: { data: [{ vault_file_id: "v1", vault_updated: true, already_deleted: true }] } });
    const first = await deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" });
    const second = await deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" });
    expect(second).toEqual(first);
  });

  it("rejects an unsupported mode before touching the network", async () => {
    const client = makeClient({});
    await expect(
      deleteMediaPhoto(client, { photoId: "p1", mode: "nuke" as never }),
    ).rejects.toThrow("Unsupported deletion mode");
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe.runIf(supabaseMode)("deleteMediaPhoto — fallback path (RPC not yet deployed)", () => {
  const missing = { message: "Could not find the function", code: "PGRST202" };

  it("feed-only updates only photos.show_in_feed and never reads vault_files", async () => {
    const client = makeClient({ rpc: { error: missing } });
    await deleteMediaPhoto(client, { photoId: "p1", mode: "feed_only" });

    const tables = client.calls.filter((c: any) => c.table).map((c: any) => c.table);
    expect(tables).toEqual(["photos"]);
    expect(client.calls.find((c: any) => c.op === "update").payload).toEqual({ show_in_feed: false });
  });

  it("feed-and-vault updates both records", async () => {
    const client = makeClient({
      rpc: { error: missing },
      photoLookup: { data: { file_url: "https://reference.invalid", image_url: null } },
      vaultUpdate: { data: [{ id: "v1" }] },
    });
    const result = await deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault", callerId: "u1" });
    expect(result.vaultUpdated).toBe(true);
    expect(result.vaultFileId).toBe("v1");

    const photoUpdate = client.calls.find((c: any) => c.op === "update" && c.table === "photos");
    expect(photoUpdate.payload.show_in_feed).toBe(false);
    expect(photoUpdate.payload.deleted_at).toBeTruthy();
    const vaultUpdate = client.calls.find((c: any) => c.op === "update" && c.table === "vault_files");
    expect(vaultUpdate.payload.deleted_by).toBe("u1");
  });

  it("falls back to image_url when file_url is absent", async () => {
    const client = makeClient({
      rpc: { error: missing },
      photoLookup: { data: { file_url: null, image_url: "https://reference.invalid" } },
      vaultUpdate: { data: [{ id: "v2" }] },
    });
    const result = await deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" });
    expect(result.vaultFileId).toBe("v2");
  });

  it("completes when a legacy photo has neither URL", async () => {
    const client = makeClient({
      rpc: { error: missing },
      photoLookup: { data: { file_url: null, image_url: null } },
    });
    const result = await deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" });
    expect(result.vaultUpdated).toBe(false);
    expect(client.calls.some((c: any) => c.table === "vault_files")).toBe(false);
  });

  it("handles a legitimate missing Vault copy", async () => {
    const client = makeClient({
      rpc: { error: missing },
      photoLookup: { data: { file_url: "https://reference.invalid", image_url: null } },
      vaultUpdate: { data: [] },
    });
    const result = await deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" });
    expect(result.vaultUpdated).toBe(false);
    expect(result.vaultFileId).toBeNull();
  });

  it("surfaces a photo-update permission failure", async () => {
    const client = makeClient({
      rpc: { error: missing },
      photoUpdateError: { message: "permission denied for table photos", code: "42501" },
    });
    await expect(
      deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" }),
    ).rejects.toThrow("permission denied for table photos");
  });

  it("surfaces a photo lookup failure instead of ignoring it", async () => {
    const client = makeClient({
      rpc: { error: missing },
      photoLookup: { error: { message: "lookup failed" } },
    });
    await expect(
      deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" }),
    ).rejects.toThrow("lookup failed");
  });

  it("surfaces a vault_files update failure instead of ignoring it", async () => {
    const client = makeClient({
      rpc: { error: missing },
      photoLookup: { data: { file_url: "https://reference.invalid", image_url: null } },
      vaultUpdate: { error: { message: "vault update denied" } },
    });
    await expect(
      deleteMediaPhoto(client, { photoId: "p1", mode: "feed_and_vault" }),
    ).rejects.toThrow("vault update denied");
  });
});

describe.runIf(!supabaseMode)("deleteMediaPhoto — ICP adapter", () => {
  it("deletes the canister asset without issuing Supabase RPCs or table writes", async () => {
    const client = makeClient({});
    removeLiveGalleryAsset.mockResolvedValue({ vault_updated: false });

    await expect(deleteMediaPhoto(client, { photoId: "asset-1", mode: "feed_and_vault" })).resolves.toEqual({
      photoId: "asset-1",
      mode: "feed_and_vault",
      vaultFileId: null,
      vaultUpdated: false,
    });

    expect(removeLiveGalleryAsset).toHaveBeenCalledWith(icpContext, "asset-1", "feed_and_vault");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("applies feed-only deletion through the same canister asset boundary", async () => {
    const client = makeClient({});
    removeLiveGalleryAsset.mockResolvedValue({ vault_updated: false });

    await expect(deleteMediaPhoto(client, { photoId: "asset-1", mode: "feed_only" })).resolves.toEqual({
      photoId: "asset-1",
      mode: "feed_only",
      vaultFileId: null,
      vaultUpdated: false,
    });

    expect(removeLiveGalleryAsset).toHaveBeenCalledWith(icpContext, "asset-1", "feed_only");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects missing asset identifiers before calling the canister", async () => {
    const client = makeClient({});

    await expect(deleteMediaPhoto(client, { photoId: "", mode: "feed_only" })).rejects.toThrow("photoId is required");

    expect(removeLiveGalleryAsset).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("propagates canister deletion failures without falling back to Supabase", async () => {
    const denied = new Error("asset deletion denied");
    const client = makeClient({});
    removeLiveGalleryAsset.mockRejectedValueOnce(denied);

    await expect(deleteMediaPhoto(client, { photoId: "asset-2", mode: "feed_only" })).rejects.toBe(denied);

    expect(removeLiveGalleryAsset).toHaveBeenCalledWith(icpContext, "asset-2", "feed_only");
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });
});
