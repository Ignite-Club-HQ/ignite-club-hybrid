import { describe, it, expect, vi, beforeEach } from "vitest";

// Supabase client mock — createSignedUrl + functions.invoke are the two
// paths resolveSignedUrl uses. Every test rewires these per-scenario.
const createSignedUrlMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: (path: string, expiresIn: number) =>
          createSignedUrlMock(path, expiresIn),
      }),
    },
    functions: {
      invoke: (name: string, opts: unknown) => invokeMock(name, opts),
    },
  },
}));

import {
  getSignedPhotoUrls,
  resolveSignedUrl,
  clearSignedUrlCache,
} from "./useSignedPhotoUrl";

const PRIVATE_URL_A =
  "https://reference.invalid/storage/v1/object/public/photos/img-1.jpg";
const PRIVATE_URL_B =
  "https://reference.invalid/storage/v1/object/public/photos/img-2.jpg";
const PRIVATE_URL_DENIED =
  "https://reference.invalid/storage/v1/object/public/photos/img-3.jpg";
const PUBLIC_URL = "https://reference.invalid/static/logo.png";
const SIGNED_A = "https://reference.invalid/storage/v1/object/sign/photos/img-1.jpg?token=a";
const SIGNED_B = "https://reference.invalid/storage/v1/object/sign/photos/img-2.jpg?token=b";

function resetAll() {
  createSignedUrlMock.mockReset();
  invokeMock.mockReset();
  clearSignedUrlCache();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
}

describe("getSignedPhotoUrls — batch fail-closed behaviour", () => {
  beforeEach(resetAll);

  it("returns {} for an empty input array without touching Supabase", async () => {
    const result = await getSignedPhotoUrls([]);
    expect(result).toEqual({});
    expect(createSignedUrlMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("passes public / non-private URLs through unchanged", async () => {
    const result = await getSignedPhotoUrls([PUBLIC_URL]);
    expect(result[PUBLIC_URL]).toBe(PUBLIC_URL);
    // Non-private URLs never call storage/functions.
    expect(createSignedUrlMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("returns signed URLs for successfully signed private entries", async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: SIGNED_A },
      error: null,
    });
    const result = await getSignedPhotoUrls([PRIVATE_URL_A]);
    expect(result[PRIVATE_URL_A]).toBe(SIGNED_A);
  });

  it("omits (does NOT return the raw URL for) a private URL when both direct signing and edge fallback fail", async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: null,
      error: { message: "denied" },
    });
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: "denied" } });

    const result = await getSignedPhotoUrls([PRIVATE_URL_DENIED]);
    // Critical: must not substitute the raw private URL.
    expect(result[PRIVATE_URL_DENIED]).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("does not cache failed private URLs as successful resolutions (permits retry)", async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: null,
      error: { message: "denied" },
    });
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: "denied" } });

    const first = await getSignedPhotoUrls([PRIVATE_URL_DENIED]);
    expect(first[PRIVATE_URL_DENIED]).toBeUndefined();

    // Retry now succeeds — must reach Supabase again (not served from cache).
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: SIGNED_A },
      error: null,
    });
    const second = await getSignedPhotoUrls([PRIVATE_URL_DENIED]);
    expect(second[PRIVATE_URL_DENIED]).toBe(SIGNED_A);
    // Two direct-sign attempts total across the two calls.
    expect(createSignedUrlMock).toHaveBeenCalledTimes(2);
  });

  it("must not return the raw private URL from batch resolution when authorization fails", async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: null,
      error: { message: "unauthorized" },
    });
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: "unauthorized" },
    });

    const result = await getSignedPhotoUrls([PRIVATE_URL_DENIED]);
    expect(result[PRIVATE_URL_DENIED]).not.toBe(PRIVATE_URL_DENIED);
    expect(result[PRIVATE_URL_DENIED]).toBeUndefined();
  });

  it("resolves a mixed batch (public + signed private + denied private) independently", async () => {
    // Two direct-signing attempts happen concurrently for PRIVATE_URL_A and
    // PRIVATE_URL_DENIED. Use mockImplementation to route by path.
    createSignedUrlMock.mockImplementation((path: string) => {
      if (path.endsWith("img-1.jpg")) {
        return Promise.resolve({ data: { signedUrl: SIGNED_A }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "denied" } });
    });
    invokeMock.mockResolvedValue({ data: null, error: { message: "denied" } });

    const result = await getSignedPhotoUrls([
      PUBLIC_URL,
      PRIVATE_URL_A,
      PRIVATE_URL_DENIED,
    ]);

    // Public passes through, signed private is signed, denied private is omitted.
    expect(result[PUBLIC_URL]).toBe(PUBLIC_URL);
    expect(result[PRIVATE_URL_A]).toBe(SIGNED_A);
    expect(result[PRIVATE_URL_DENIED]).toBeUndefined();
    // Batch is not aborted: two of three inputs are present in the result.
    expect(Object.keys(result).sort()).toEqual(
      [PUBLIC_URL, PRIVATE_URL_A].sort()
    );
  });

  it("caches successfully signed private URLs and reuses them without re-signing", async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: SIGNED_A },
      error: null,
    });
    const first = await getSignedPhotoUrls([PRIVATE_URL_A]);
    expect(first[PRIVATE_URL_A]).toBe(SIGNED_A);
    expect(createSignedUrlMock).toHaveBeenCalledTimes(1);

    // Second call — should hit the in-memory cache; no new sign attempts.
    const second = await getSignedPhotoUrls([PRIVATE_URL_A]);
    expect(second[PRIVATE_URL_A]).toBe(SIGNED_A);
    expect(createSignedUrlMock).toHaveBeenCalledTimes(1);
  });

  it("resolves successful entries independently when a sibling private URL is denied", async () => {
    createSignedUrlMock.mockImplementation((path: string) => {
      if (path.endsWith("img-1.jpg")) {
        return Promise.resolve({ data: { signedUrl: SIGNED_A }, error: null });
      }
      if (path.endsWith("img-2.jpg")) {
        return Promise.resolve({ data: { signedUrl: SIGNED_B }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "denied" } });
    });
    invokeMock.mockResolvedValue({ data: null, error: { message: "denied" } });

    const result = await getSignedPhotoUrls([
      PRIVATE_URL_A,
      PRIVATE_URL_B,
      PRIVATE_URL_DENIED,
    ]);
    expect(result[PRIVATE_URL_A]).toBe(SIGNED_A);
    expect(result[PRIVATE_URL_B]).toBe(SIGNED_B);
    expect(result[PRIVATE_URL_DENIED]).toBeUndefined();
  });
});

describe("resolveSignedUrl — single-URL behaviour is preserved", () => {
  beforeEach(resetAll);

  it("returns the URL unchanged for non-private URLs", async () => {
    const out = await resolveSignedUrl(PUBLIC_URL);
    expect(out).toBe(PUBLIC_URL);
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("throws when both direct signing and edge fallback fail for a private URL", async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: null,
      error: { message: "denied" },
    });
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: "denied" } });

    await expect(resolveSignedUrl(PRIVATE_URL_DENIED)).rejects.toThrow(
      /Unable to create signed URL/i
    );
  });
});
