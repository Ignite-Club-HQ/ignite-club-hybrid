import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brokeredPreviewStorage } from "./previewAuthStorage";

const PID = "11111111-2222-4333-8444-555555555555";
const EDITOR = "https://lovable.dev";

function setup(reply: (msg: any) => any, opts: { ancestor?: string } = {}) {
  vi.stubGlobal("location", {
    hostname: `id-preview--${PID}.lovable.app`,
    ancestorOrigins: [opts.ancestor ?? EDITOR],
  });
  const sent: any[] = [];
  const parent = {
    postMessage: (msg: any, origin: string) => {
      sent.push({ msg, origin });
      const r = reply(msg);
      if (r !== undefined) {
        setTimeout(() => window.dispatchEvent(new MessageEvent("message", {
          origin: r.origin ?? EDITOR,
          data: { type: "lovable-preview-auth:result", requestId: msg.requestId, ...r.data },
        })), 0);
      }
    },
  };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  return sent;
}

describe("brokeredPreviewStorage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(window, "parent", { value: window, configurable: true });
  });

  it("seeds a new tab from the brokered session", async () => {
    setup(() => ({ data: { ok: true, value: "session-a" } }));
    const s = brokeredPreviewStorage() as any;
    await expect(s.getItem("k")).resolves.toBe("session-a");
    expect(localStorage.getItem("k")).toBe("session-a");
  });

  it("sends the local value with get and remove requests", async () => {
    localStorage.setItem("k", "local-a");
    const sent = setup(() => ({ data: { ok: true, value: "local-a" } }));
    const s = brokeredPreviewStorage() as any;
    await s.getItem("k");
    await s.removeItem("k");
    expect(sent.map((x) => [x.msg.type, x.msg.value])).toEqual([
      ["lovable-preview-auth:get", "local-a"],
      ["lovable-preview-auth:remove", "local-a"],
    ]);
  });

  it("logout tombstone clears the local copy", async () => {
    localStorage.setItem("k", "stale");
    setup(() => ({ data: { ok: true, value: "" } }));
    const s = brokeredPreviewStorage() as any;
    await expect(s.getItem("k")).resolves.toBeNull();
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("ignores replies from untrusted origins and falls back to local", async () => {
    vi.useFakeTimers();
    localStorage.setItem("k", "local-a");
    setup(() => ({ origin: "https://evil.example", data: { ok: true, value: "evil" } }));
    const s = brokeredPreviewStorage() as any;
    const p = s.getItem("k");
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBe("local-a");
    vi.useRealTimers();
  });

  it("retries once when the editor is not listening yet", async () => {
    let calls = 0;
    setup(() => (++calls === 1 ? undefined : { data: { ok: true, value: "late" } }));
    vi.useFakeTimers();
    const s = brokeredPreviewStorage() as any;
    const p = s.getItem("k");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(p).resolves.toBe("late");
    expect(calls).toBe(2);
    vi.useRealTimers();
  });

  it("does not throw when localStorage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    setup(() => ({ data: { ok: true, value: "session-a" } }));
    const s = brokeredPreviewStorage() as any;
    await expect(s.getItem("k")).resolves.toBe("session-a");
    await expect(s.setItem("k", "v")).resolves.toBeUndefined();
  });

  it("uses plain storage outside a preview frame", () => {
    vi.stubGlobal("location", { hostname: "example.com" });
    const s = brokeredPreviewStorage() as any;
    s.setItem("k", "v");
    expect(s.getItem("k")).toBe("v");
  });
});
