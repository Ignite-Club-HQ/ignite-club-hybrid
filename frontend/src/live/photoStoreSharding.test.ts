import { describe, expect, it } from "vitest";
import { listBlobStoreCanisterIds, listBlobStoreKeys, orderBlobStoresForPath } from "./mediaStorage";
import { parseIcpBlobUrl } from "./mediaDecrypt";

const target = {
  host: "https://icp0.io",
  canisterIds: {
    media_blob_store: "aaaaa-aa",
    media_blob_store_3: "ccccc-cc",
    media_blob_store_2: "bbbbb-bb",
    media_blob_store_x: "zzzzz-zz",
    club_domain: "ddddd-dd",
  },
} as any;

describe("photo store sharding", () => {
  it("lists the original store first, then numbered shards", () => {
    expect(listBlobStoreKeys(target)).toEqual(["media_blob_store", "media_blob_store_2", "media_blob_store_3"]);
    expect(listBlobStoreCanisterIds(target)).toEqual(["aaaaa-aa", "bbbbb-bb", "ccccc-cc"]);
  });

  it("keeps a club's photos on the same store", () => {
    const a = orderBlobStoresForPath(target, "clubs/club-1/teams/t/chat/1.jpg")[0];
    const b = orderBlobStoresForPath(target, "clubs/club-1/gallery/2.jpg")[0];
    expect(a).toBe(b);
  });

  it("only moves a minority of clubs when a store is added", () => {
    const two = { canisterIds: { media_blob_store: "aaaaa-aa", media_blob_store_2: "bbbbb-bb" } };
    let moved = 0;
    for (let i = 0; i < 300; i++) {
      const path = `clubs/club-${i}/x.jpg`;
      if (orderBlobStoresForPath(two, path)[0] !== orderBlobStoresForPath(target, path)[0]) moved++;
    }
    expect(moved).toBeLessThan(160);
  });

  it("reads photos from any configured store and rejects unknown canisters", () => {
    expect(parseIcpBlobUrl("https://bbbbb-bb.raw.icp0.io/clubs/c/1.jpg", target)).toEqual({
      canisterId: "bbbbb-bb",
      path: "clubs/c/1.jpg",
    });
    expect(parseIcpBlobUrl("https://icp0.io/aaaaa-aa/clubs/c/1.jpg", target)?.canisterId).toBe("aaaaa-aa");
    expect(parseIcpBlobUrl("https://zzzzz-zz.raw.icp0.io/clubs/c/1.jpg", target)).toBeNull();
  });
});
