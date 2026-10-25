import { beforeEach, describe, expect, it, vi } from "vitest";
const mode = vi.hoisted(() => ({ icp: true, email: false, stored: true }));
vi.mock("./authBackendMode", () => ({
  hasInternetIdentitySessionStored: () => mode.stored,
  isSignedInWithEmail: () => mode.email,
  readAuthChoice: () => null,
  resolveAuthBackend: () => mode.icp ? "icp" : "supabase",
}));
vi.mock("./targetRegistry", () => ({ getActiveSupabaseTarget: () => ({ url: "https://custom.example.org" }) }));
import { assertStrictIcpRequest, ICP_FALLBACK_BLOCKED_EVENT, installStrictIcpTransport } from "./strictIcpTransport";
const host = "https://project.supabase.co";
const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
beforeEach(() => { mode.icp = true; mode.email = false; mode.stored = true; });
describe("strict ICP fallback boundary", () => {
  it("blocks table reads and writes before network, without filters or identifiers in errors", async () => {
    await expect(assertStrictIcpRequest(`${host}/rest/v1/clubs?id=eq.private-value`)).rejects.toThrow("data clubs");
    await expect(assertStrictIcpRequest(`${host}/rest/v1/clubs`, post({ name: "private" }))).rejects.not.toThrow("private");
  });
  it("blocks configured custom Supabase targets", async () => {
    await expect(assertStrictIcpRequest("https://custom.example.org/rest/v1/teams")).rejects.toThrow("data teams");
  });
  it("blocks generic email, arbitrary functions and email auth", async () => {
    for (const path of ["/functions/v1/send-email", "/functions/v1/unknown", "/auth/v1/token"]) {
      await expect(assertStrictIcpRequest(host + path, post({}))).rejects.toThrow("ICP testing blocked");
    }
  });
  it("preserves exact external IAP verification", async () => {
    await expect(assertStrictIcpRequest(host + "/functions/v1/verify-iap-receipt-icp", post({ principal: "p", product_id: "product", transaction_id: "tx", receipt_data: "receipt" }))).resolves.toBeUndefined();
  });
  it("rejects widened IAP payloads and other jobs", async () => {
    await expect(assertStrictIcpRequest(host + "/functions/v1/verify-iap-receipt-icp", post({ principal: "p", product_id: "product", transaction_id: "tx", receipt_data: "receipt", arbitrary: true }))).rejects.toThrow("blocked");
    await expect(assertStrictIcpRequest(host + "/functions/v1/verify-iap-receipt-icp?job=other", post({}))).rejects.toThrow("blocked");
  });
  it("preserves push-kick only with an empty payload", async () => {
    await expect(assertStrictIcpRequest(host + "/functions/v1/verify-iap-receipt-icp?job=push-kick", post({}))).resolves.toBeUndefined();
    await expect(assertStrictIcpRequest(host + "/functions/v1/verify-iap-receipt-icp?job=push-kick", post({ recipient: "p" }))).rejects.toThrow("blocked");
  });
  it("preserves verified email transport without enabling arbitrary recipients", async () => {
    await expect(assertStrictIcpRequest(host + "/functions/v1/send-welcome-email-icp", post({ token: "job-token" }))).resolves.toBeUndefined();
    await expect(assertStrictIcpRequest(host + "/functions/v1/send-welcome-email-icp", post({ token: "job-token", to: "private" }))).rejects.toThrow("blocked");
  });
  it("allows the existing support feedback transport but never arbitrary recipient fields or queries", async () => {
    const body = { type: "bug", title: "Cannot open page", description: "Please check", userEmail: null, userName: "Ignite member" };
    await expect(assertStrictIcpRequest(host + "/functions/v1/send-feedback-email", post(body))).resolves.toBeUndefined();
    await expect(assertStrictIcpRequest(host + "/functions/v1/send-feedback-email", post({ ...body, to: "other@example.com" }))).rejects.toThrow("blocked");
    await expect(assertStrictIcpRequest(host + "/functions/v1/send-feedback-email?to=other", post(body))).rejects.toThrow("blocked");
    await expect(assertStrictIcpRequest(host + "/functions/v1/send-feedback-email", post({ ...body, description: "x".repeat(16001) }))).rejects.toThrow("blocked");
  });
  it("preserves external file byte reads, uploads, deletion and signing, not inventory", async () => {
    await expect(assertStrictIcpRequest(host + "/storage/v1/object/public/photos/file.jpg")).resolves.toBeUndefined();
    await expect(assertStrictIcpRequest(host + "/storage/v1/object/sign/photos/file.jpg", post({ expiresIn: 60 }))).resolves.toBeUndefined();
    for (const method of ["PUT", "DELETE", "POST"]) await expect(assertStrictIcpRequest(host + "/storage/v1/object/photos/file.jpg", { method })).resolves.toBeUndefined();
    await expect(assertStrictIcpRequest(host + "/storage/v1/object/list/photos", post({}))).rejects.toThrow("blocked");
  });
  it("leaves external maps, GIPHY, PlayHQ and payment websites untouched", async () => {
    for (const url of ["https://maps.googleapis.com/maps/api", "https://api.giphy.com/v1/gifs", "https://www.playhq.com/grade/a", "https://checkout.stripe.com/pay"]) await expect(assertStrictIcpRequest(url)).resolves.toBeUndefined();
  });
  it("keeps Supabase sign-in authoritative even with an old II record", async () => {
    mode.email = true;
    await expect(assertStrictIcpRequest(host + "/rest/v1/clubs")).resolves.toBeUndefined();
  });
  it("preserves signed-out Supabase startup", async () => {
    mode.icp = false; mode.stored = false;
    await expect(assertStrictIcpRequest(host + "/rest/v1/app_settings")).resolves.toBeUndefined();
  });
  it("prevents network and emits a sanitized UI signal even when callers swallow errors", async () => {
    const network = vi.fn().mockResolvedValue(new Response("ok"));
    const listener = vi.fn();
    window.fetch = network;
    window.addEventListener(ICP_FALLBACK_BLOCKED_EVENT, listener);
    installStrictIcpTransport();
    await expect(window.fetch(host + "/rest/v1/teams?id=eq.secret")).rejects.toThrow("blocked");
    expect(network).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).not.toContain("secret");
    await window.fetch("https://api.giphy.com/v1/gifs");
    expect(network).toHaveBeenCalledTimes(1);
    window.removeEventListener(ICP_FALLBACK_BLOCKED_EVENT, listener);
  });
});