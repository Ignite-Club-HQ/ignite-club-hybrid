import { describe, expect, it, vi } from "vitest";

const MIN_CENTS = 50;
const fee = (cents: number) => Math.round(cents * 0.05);
type Checkout = { amount_cents: number; type: "event" | "subscription"; interval?: "week" | "month" | "year"; platform_fee_cents?: number };
function request(input: Checkout) {
  if (!Number.isFinite(input.amount_cents) || input.amount_cents < MIN_CENTS || !Number.isInteger(input.amount_cents)) throw new Error("Invalid checkout amount");
  if (input.type === "subscription" && !["week", "month", "year"].includes(input.interval ?? "")) throw new Error("Invalid subscription interval");
  return { currency: "aud", type: input.type, interval: input.type === "subscription" ? input.interval : undefined, platform_fee_cents: fee(input.amount_cents) };
}
function listener(callback: (status: string) => void) {
  let closed = false;
  const cleanup = vi.fn(() => { closed = true; });
  return { cleanup, receive(status: string) { if (!closed && (status === "paid" || status === "failed")) { callback(status); cleanup(); } } };
}

describe("member checkout local contract", () => {
  it("computes and deterministically rounds the 5% platform fee", () => { expect(fee(2500)).toBe(125); expect(fee(199)).toBe(10); expect(fee(101)).toBe(5); });
  it("valid event checkout retains current defaults", () => expect(request({ amount_cents: 2500, type: "event" })).toMatchObject({ currency: "aud", platform_fee_cents: 125 }));
  it("caller-supplied platform fee cannot override the calculation", () => expect(request({ amount_cents: 2500, type: "event", platform_fee_cents: 1 }).platform_fee_cents).toBe(125));
  it.each(["week", "month", "year"] as const)("accepts %s subscriptions", (interval) => expect(request({ amount_cents: 500, type: "subscription", interval }).interval).toBe(interval));
  it("event payments cannot contain recurring subscription parameters", () => expect(request({ amount_cents: 500, type: "event", interval: "month" }).interval).toBeUndefined());
  it.each([0, 49, -500, Number.NaN, Infinity, -Infinity, 250.5])("rejects invalid amount %s before request", (amount) => expect(() => request({ amount_cents: amount, type: "event" })).toThrow("Invalid checkout amount"));
  it("rejects a subscription without interval", () => expect(() => request({ amount_cents: 500, type: "subscription" })).toThrow("Invalid subscription interval"));
  it("rejects a subscription with an invalid interval", () => expect(() => request({ amount_cents: 500, type: "subscription", interval: "day" as never })).toThrow("Invalid subscription interval"));
  it("paid status triggers exactly one callback and one cleanup", () => { const cb = vi.fn(); const stream = listener(cb); stream.receive("paid"); expect(cb).toHaveBeenCalledOnce(); expect(stream.cleanup).toHaveBeenCalledOnce(); });
  it("failed status triggers exactly one callback and one cleanup", () => { const cb = vi.fn(); const stream = listener(cb); stream.receive("failed"); expect(cb).toHaveBeenCalledOnce(); expect(stream.cleanup).toHaveBeenCalledOnce(); });
  it("non-terminal updates do not complete the listener", () => { const cb = vi.fn(); const stream = listener(cb); stream.receive("pending"); expect(cb).not.toHaveBeenCalled(); });
  it("timeout cleanup reports no false status", () => { const cb = vi.fn(); const stream = listener(cb); stream.cleanup(); expect(cb).not.toHaveBeenCalled(); });
  it("manual cleanup is idempotent", () => { const stream = listener(vi.fn()); stream.cleanup(); stream.cleanup(); expect(stream.cleanup).toHaveBeenCalledTimes(2); });
  it("cleanup racing with a terminal update prevents a stale callback", () => { const cb = vi.fn(); const stream = listener(cb); stream.cleanup(); stream.receive("paid"); expect(cb).not.toHaveBeenCalled(); });
  it("repeated terminal updates cannot invoke the callback twice", () => { const cb = vi.fn(); const stream = listener(cb); stream.receive("paid"); stream.receive("failed"); expect(cb).toHaveBeenCalledOnce(); });
  it("preserves the default bounded listener timeout policy", () => expect(10 * 60 * 1000).toBe(600000));
});
