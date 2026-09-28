import { describe, expect, it } from "vitest";
import {
  fetchVaultTrashItems,
  partitionVaultTrashItems,
  type VaultTrashFile,
} from "./vaultTrashRepository";

const image = {
  id: "image-1",
  file_type: "image/webp",
  file_url: "https://example.test/image.webp",
  name: "image.webp",
  uploaded_by: "user-1",
} as VaultTrashFile;

const imageByExtension = {
  id: "image-2",
  file_type: "application/octet-stream",
  file_url: "https://example.test/image.heic",
  name: "image.heic",
  uploaded_by: "user-1",
} as VaultTrashFile;

const file = {
  id: "file-1",
  file_type: "application/pdf",
  file_url: "https://example.test/file.pdf",
  name: "file.pdf",
  uploaded_by: "user-1",
} as VaultTrashFile;

describe("vault trash repository", () => {
  it("partitions the already deletion-ordered rows without changing their order", () => {
    const result = partitionVaultTrashItems([image, file, imageByExtension]);

    expect(result.photos.map((item) => item.id)).toEqual(["image-1", "image-2"]);
    expect(result.files.map((item) => item.id)).toEqual(["file-1"]);
    expect(result.photos[0]).toMatchObject({
      image_url: image.file_url,
      uploader_id: image.uploaded_by,
      title: image.name,
    });
  });

  it("propagates a trash-read provider failure instead of returning an empty result", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            not: () => ({
              order: async () => ({ data: null, error: new Error("trash read denied") }),
            }),
          }),
        }),
      }),
    };

    await expect(fetchVaultTrashItems("club-1", client as never)).rejects.toThrow("trash read denied");
  });
});
