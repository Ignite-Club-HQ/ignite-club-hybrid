import { describe, expect, it } from "vitest";
import { IDL } from "@icp-sdk/core/candid";
import {
  BLOB_CHUNK_SIZE,
  chunkBytes,
  chunkCountFor,
  sha256Hex,
  storagePathFromPublicUrl,
} from "./blobStoreProtocol";
import { MEDIA_BLOB_STORE_KEY } from "./mediaStorage";
import { idlFactory as blobStoreIdl } from "../lab/bindings/media_blob_store/declarations/media_blob_store.did.js";

describe("blob store protocol", () => {
  it("splits bytes into consecutive fixed-size chunks", () => {
    const bytes = new Uint8Array(2507).map((_, i) => i % 251);
    const chunks = chunkBytes(bytes, 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(1000);
    expect(chunks[1]).toHaveLength(1000);
    expect(chunks[2]).toHaveLength(507);
    expect(new Uint8Array(chunks.flatMap((c) => Array.from(c)))).toEqual(bytes);
  });

  it("computes chunk counts begin_upload must declare", () => {
    expect(chunkCountFor(0)).toBe(1);
    expect(chunkCountFor(1)).toBe(1);
    expect(chunkCountFor(BLOB_CHUNK_SIZE)).toBe(1);
    expect(chunkCountFor(BLOB_CHUNK_SIZE + 1)).toBe(2);
  });

  it("hashes with SHA-256 in the contract's lowercase hex format", async () => {
    // Well-known SHA-256 test vector for "abc".
    const hash = await sha256Hex(new TextEncoder().encode("abc"));
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("extracts storage paths from Supabase public object URLs", () => {
    expect(
      storagePathFromPublicUrl(
        "https://proj.supabase.co/storage/v1/object/public/photos/clubs/c1/teams/t1/u/1-x.jpg?ts=1",
        "photos",
      ),
    ).toBe("clubs/c1/teams/t1/u/1-x.jpg");
    expect(
      storagePathFromPublicUrl(
        "https://proj.supabase.co/storage/v1/object/public/photos/clubs/c1/my%20photo.jpg",
        "photos",
      ),
    ).toBe("clubs/c1/my photo.jpg");
    expect(storagePathFromPublicUrl("https://proj.supabase.co/other/photos/x.jpg", "photos")).toBeNull();
    expect(storagePathFromPublicUrl("https://proj.supabase.co/storage/v1/object/public/vault/x.jpg", "photos")).toBeNull();
  });

  it("pins the media_blob_store canister key", () => {
    expect(MEDIA_BLOB_STORE_KEY).toBe("media_blob_store");
  });
});

describe("media_blob_store contract", () => {
  const service = blobStoreIdl({ IDL }) as unknown as {
    _fields: Array<[string, { argTypes: unknown[]; annotations: string[] }]>;
  };
  const fields = new Map(service._fields.map(([name, func]) => [name, func]));

  it("exposes exactly the fixed contract methods", () => {
    expect([...fields.keys()].sort()).toEqual([
      "abort_upload",
      "begin_upload",
      "club_media_inventory_page",
      "cycles_balance",
      "delete_blob",
      "enable_retained_media_quota",
      "enable_shared_media_quota",
      "enable_stable_media_storage",
      "finalize_upload",
      "freeze_media_quota",
      "freeze_retained_media",
      "get_club_media_bytes",
      "get_club_media_usage",
      "get_content_hash",
      "get_upload_outcome",
      "get_usage",
      "health",
      "http_request",
      "http_request_streaming_callback",
      "memory_stats",
      "merge_principal",
      "migrate_legacy_blob",
      "prepare_account_removal",
      "put_chunk",
      "quota_snapshot_page",
      "read_account_get_upload_outcome",
      "read_account_removal_drain",
      "read_group_opening_configuration",
      "read_pending_test_uploads",
      "read_pending_uploads",
      "read_physical_growth_capacity",
      "reconcile_retained_deletions",
      "reconcile_upload_operations",
      "rekey_principal",
      "retained_snapshot_page",
      "retire_upload_outcomes",
      "seal_account_removal",
      "set_capacity_limit",
      "set_club_domain_canister",
      "set_club_media_transfer_fence",
      "stable_storage_status",
    ]);
  });

  it("keeps the upload protocol signatures stable", () => {
    expect(fields.get("begin_upload")?.argTypes).toHaveLength(4); // path, mime, total_size, chunk_count
    expect(fields.get("put_chunk")?.argTypes).toHaveLength(3); // upload_id, index, data
    expect(fields.get("finalize_upload")?.argTypes).toHaveLength(1);
    expect(fields.get("abort_upload")?.argTypes).toHaveLength(1);
  });
  it("uses consensus for operator inventory and fence changes", () => {
    expect(fields.get("club_media_inventory_page")?.argTypes).toHaveLength(3);
    expect(fields.get("club_media_inventory_page")?.annotations).toEqual([]);
    expect(fields.get("set_club_media_transfer_fence")?.argTypes).toHaveLength(3);
    expect(fields.get("set_club_media_transfer_fence")?.annotations).toEqual([]);
  });

  it("serves reads as queries so media delivery skips consensus", () => {
    expect(fields.get("http_request")?.annotations).toContain("query");
    expect(fields.get("get_content_hash")?.annotations).toContain("query");
    expect(fields.get("health")?.annotations).toContain("query");
  });
});
