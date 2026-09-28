import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMediaStorageUrl, mediaStorageOrigin } from "./mediaStorageUrl";

describe("Media storage URL boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the configured local origin and encodes each object-path segment", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321/");
    expect(buildMediaStorageUrl("clubs/club 1/photo #1.jpg")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/photos/clubs/club%201/photo%20%231.jpg",
    );
  });

  it("uses a configured hosted origin without embedding a project reference", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://synthetic-project.supabase.co///");
    expect(mediaStorageOrigin()).toBe("https://synthetic-project.supabase.co");
    expect(buildMediaStorageUrl("clubs/club-a/photo.jpg").startsWith(
      "https://synthetic-project.supabase.co/storage/v1/object/public/photos/",
    )).toBe(true);
  });

  it("fails before metadata insertion when storage is not configured", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(() => buildMediaStorageUrl("photo.jpg")).toThrow("Media storage is not configured");
  });
});
