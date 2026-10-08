import { describe, expect, it } from "vitest";
import { mergePendingRows } from "./pendingSendKeeper";

describe("mergePendingRows", () => {
  const pending = { id: "temp-1", author_id: "a", text: "", image_url: "blob:x" };
  it("restores a still-sending photo missing from a refetch", () => {
    expect(mergePendingRows([{ id: "m1", author_id: "b", text: "hi" }], [pending])?.map((m) => m.id)).toEqual(["m1", "temp-1"]);
  });
  it("does not restore once the real message has arrived", () => {
    expect(mergePendingRows([{ id: "m2", author_id: "a", text: "", image_url: "https://x" }], [pending])).toBeNull();
  });
});
