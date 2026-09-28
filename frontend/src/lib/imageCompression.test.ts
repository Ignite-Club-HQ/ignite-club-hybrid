import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { compressImage, formatFileSize } from "./imageCompression";

const originalImage = globalThis.Image;

function file(name: string, type: string, size = 1000) {
  return new File([new Uint8Array(size)], name, { type, lastModified: 1 });
}

function installImage({ width = 2000, height = 1000, outcome = "load" }: {
  width?: number;
  height?: number;
  outcome?: "load" | "error" | "hang";
} = {}) {
  class MockImage {
    width = width;
    height = height;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(_value: string) {
      if (outcome === "load") queueMicrotask(() => this.onload?.());
      if (outcome === "error") queueMicrotask(() => this.onerror?.());
    }
  }
  vi.stubGlobal("Image", MockImage);
}

function installCanvas(blob: Blob | null, drawError?: Error) {
  const context = {
    fillStyle: "",
    fillRect: vi.fn(),
    drawImage: drawError ? vi.fn(() => { throw drawError; }) : vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: (value: Blob | null) => void) => callback(blob)),
  };
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
    tag === "canvas" ? canvas : originalCreateElement(tag)) as any);
  return { canvas, context };
}

describe("image compression safety boundaries", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:source"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.stubGlobal("Image", originalImage);
  });

  it.each([
    ["document.pdf", "application/pdf"],
    ["animation.gif", "image/gif"],
    ["iphone.heic", "image/heic"],
    ["iphone.heif", "image/heif"],
  ])("passes through %s without canvas conversion", async (name, type) => {
    const source = file(name, type);
    await expect(compressImage(source)).resolves.toEqual({
      file: source,
      originalSize: source.size,
      compressedSize: source.size,
      compressionRatio: 1,
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("resizes within 1280px, converts to JPEG, and reports real compression", async () => {
    installImage({ width: 2560, height: 1280 });
    const compressedBlob = new Blob([new Uint8Array(250)], { type: "image/jpeg" });
    const { canvas, context } = installCanvas(compressedBlob);
    const source = file("large.png", "image/png", 1000);

    const result = await compressImage(source);

    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(640);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1280, 640);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 640);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.75);
    expect(result.file.name).toBe("large.png");
    expect(result.file.type).toBe("image/jpeg");
    expect(result).toMatchObject({ originalSize: 1000, compressedSize: 250, compressionRatio: 4 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
  });

  it("keeps the original when compression would make the image larger", async () => {
    installImage();
    installCanvas(new Blob([new Uint8Array(1200)], { type: "image/jpeg" }));
    const source = file("photo.jpg", "image/jpeg", 1000);
    expect((await compressImage(source)).file).toBe(source);
  });

  it("keeps the original and revokes resources when image decoding fails", async () => {
    installImage({ outcome: "error" });
    const source = file("broken.jpg", "image/jpeg", 1000);
    expect((await compressImage(source)).file).toBe(source);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
  });

  it("keeps the original when canvas drawing fails", async () => {
    installImage();
    installCanvas(new Blob([new Uint8Array(100)]), new Error("canvas unavailable"));
    const source = file("photo.jpg", "image/jpeg", 1000);
    expect((await compressImage(source)).file).toBe(source);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:source");
  });

  it("times out a hanging iOS-style decoder after eight seconds", async () => {
    vi.useFakeTimers();
    installImage({ outcome: "hang" });
    const source = file("photo.jpg", "image/jpeg", 1000);
    const pending = compressImage(source);
    await vi.advanceTimersByTimeAsync(7999);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).file).toBe(source);
  });
});

describe("formatFileSize", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1536, "1.5 KB"],
    [2 * 1024 * 1024, "2 MB"],
    [3.25 * 1024 * 1024 * 1024, "3.3 GB"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});
