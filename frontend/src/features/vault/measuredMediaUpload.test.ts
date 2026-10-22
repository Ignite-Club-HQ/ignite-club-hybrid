import { describe, it, expect, vi } from "vitest";
import { handleMeasuredMediaUpload, readMeasuredBody, MAX_MEDIA_BYTES } from "../../../../supabase/functions/_shared/measuredMediaUpload";

const club = "11111111-1111-4111-8111-111111111111";
function setup(bytes = new Uint8Array([1, 2, 3])) {
  const services = { authenticate: vi.fn(async () => "verified-user"), reserve: vi.fn(async () => "reservation"), upload: vi.fn(async () => undefined), settle: vi.fn(async () => undefined) };
  const request = new Request("https://example.test/upload", { method: "POST", headers: { authorization: "Bearer test-token", "x-media-club": club, "x-media-bucket": "photos", "x-media-path": `clubs/${club}/photo.jpg` }, body: bytes });
  return { services, request };
}
describe("Trusted actual-byte media uploads", () => {
  it("measures actual body, ignoring a falsely small declaration", async () => {
    const { request, services } = setup();
    request.headers.set("content-length", "1");
    expect((await handleMeasuredMediaUpload(request, services, {})).status).toBe(200);
    expect(services.reserve).toHaveBeenCalledWith(expect.objectContaining({ bytes: 3, user: "verified-user" }));
    expect(services.settle).toHaveBeenCalledWith("reservation", true);
  });
  it("accepts exactly 10 MiB", async () => {
    const { request } = setup(new Uint8Array(MAX_MEDIA_BYTES));
    expect((await readMeasuredBody(request)).byteLength).toBe(10485760);
  });
  it("refuses one byte above 10 MiB even without content-length", async () => {
    const { request, services } = setup(new Uint8Array(MAX_MEDIA_BYTES + 1));
    expect((await handleMeasuredMediaUpload(request, services, {})).status).toBe(413);
    expect(services.reserve).not.toHaveBeenCalled();
  });
  it("refuses unverified callers", async () => {
    const { request, services } = setup(); services.authenticate.mockResolvedValueOnce(null as unknown as string);
    expect((await handleMeasuredMediaUpload(request, services, {})).status).toBe(401);
    expect(services.upload).not.toHaveBeenCalled();
  });
  it("refuses a quota denial before writing any bytes", async () => {
    const { request, services } = setup(); services.reserve.mockRejectedValueOnce(new Error("full"));
    expect((await handleMeasuredMediaUpload(request, services, {})).status).toBe(403);
    expect(services.upload).not.toHaveBeenCalled();
  });
  it("does not release or replay an upload with unknown outcome", async () => {
    const { request, services } = setup(); services.upload.mockRejectedValueOnce(new Error("lost response"));
    expect((await handleMeasuredMediaUpload(request, services, {})).status).toBe(503);
    expect(services.upload).toHaveBeenCalledTimes(1);
    expect(services.settle).not.toHaveBeenCalled();
  });
  it("refuses paths belonging to another club", async () => {
    const { request, services } = setup(); request.headers.set("x-media-path", "clubs/another/file.jpg");
    expect((await handleMeasuredMediaUpload(request, services, {})).status).toBe(400);
    expect(services.reserve).not.toHaveBeenCalled();
  });
});