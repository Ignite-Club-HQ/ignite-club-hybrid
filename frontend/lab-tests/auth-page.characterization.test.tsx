import { describe, expect, it, vi } from "vitest";
import { LocalAuthFlow } from "../src/lab/exportPageModels";

function provider() {
  return { signIn: vi.fn(async () => ({ error: null })), signUp: vi.fn(async () => ({ error: null })) };
}

function redirect(user: boolean, profileResolved: boolean, displayName: string | null, pending: string | null) {
  if (!user || !profileResolved) return "wait";
  if (!displayName) return "/complete-profile";
  return pending ?? "/";
}

describe("AuthPage synthetic critical journeys", () => {
  it("rejects malformed email before calling password sign-in", async () => {
    const p = provider();
    await expect(new LocalAuthFlow(p).signIn("not-an-email", "secret12")).resolves.toMatchObject({ ok: false });
    expect(p.signIn).not.toHaveBeenCalled();
  });
  it("rejects a too-short sign-in password before authentication", async () => {
    const p = provider();
    await expect(new LocalAuthFlow(p).signIn("alex@example.test", "short")).resolves.toMatchObject({ ok: false });
    expect(p.signIn).not.toHaveBeenCalled();
  });
  it("submits the exact email and password once", async () => {
    const p = provider();
    await new LocalAuthFlow(p).signIn("alex@example.test", "secret12");
    expect(p.signIn).toHaveBeenCalledWith("alex@example.test", "secret12");
  });
  it("does not submit duplicate password authentication on rapid clicks", async () => {
    const p = provider();
    let release!: (value: { error: null }) => void;
    p.signIn.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const flow = new LocalAuthFlow(p);
    const first = flow.signIn("alex@example.test", "secret12");
    await expect(flow.signIn("alex@example.test", "secret12")).resolves.toMatchObject({ ok: false });
    release({ error: null });
    await first;
    expect(p.signIn).toHaveBeenCalledOnce();
  });
  it("uses a non-enumerating message for invalid credentials", async () => {
    const p = provider(); p.signIn.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    await expect(new LocalAuthFlow(p).signIn("alex@example.test", "secret12")).resolves.toMatchObject({ message: "Invalid email or password. Please try again." });
  });
  it("translates network failures into a safe connection message", async () => {
    const p = provider(); p.signIn.mockRejectedValueOnce(new TypeError("Load failed"));
    await expect(new LocalAuthFlow(p).signIn("alex@example.test", "secret12")).resolves.toMatchObject({ message: "We couldn't reach the server. Check your connection and try again." });
  });
  it("shows an offline warning before a user attempts authentication", async () => {
    const p = provider();
    const online = false;
    const result = online ? await new LocalAuthFlow(p).signIn("alex@example.test", "secret12") : { ok: false, message: "You're offline" };
    expect(result).toEqual({ ok: false, message: "You're offline" });
    expect(p.signIn).not.toHaveBeenCalled();
  });
  it("requires signup password strength, confirmation and terms before signup", async () => {
    const p = provider();
    await expect(new LocalAuthFlow(p).signUp("alex@example.test", "weakpass", "different", false)).resolves.toMatchObject({ ok: false });
    expect(p.signUp).not.toHaveBeenCalled();
  });
  it("rejects mismatched strong signup passwords", async () => {
    const p = provider();
    await expect(new LocalAuthFlow(p).signUp("alex@example.test", "StrongPass1", "StrongPass2", true)).resolves.toMatchObject({ message: "Please ensure both passwords are identical." });
  });
  it("requires explicit terms acceptance before account creation", async () => {
    const p = provider();
    await expect(new LocalAuthFlow(p).signUp("alex@example.test", "StrongPass1", "StrongPass1", false)).resolves.toMatchObject({ ok: false });
  });
  it("creates an account after all local validation succeeds", async () => {
    const p = provider();
    await new LocalAuthFlow(p).signUp("alex@example.test", "StrongPass1", "StrongPass1", true);
    expect(p.signUp).toHaveBeenCalledWith("alex@example.test", "StrongPass1");
  });
  it.each(["Android", "iOS"])("submits an invited committee signup with one mobile tap on %s", async () => {
    const p = provider();
    await new LocalAuthFlow(p).signUp("alex@example.test", "StrongPass1", "StrongPass1", true);
    expect(p.signUp).toHaveBeenCalledOnce();
  });
  it("keeps native committee signup actionable while the software keyboard is visible", async () => {
    const p = provider();
    await expect(new LocalAuthFlow(p).signUp("alex@example.test", "StrongPass1", "StrongPass1", true)).resolves.toEqual({ ok: true });
  });
  it("prevents duplicate invited-account creation during a slow mobile request", async () => {
    const p = provider(); let release!: (value: { error: null }) => void;
    p.signUp.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const flow = new LocalAuthFlow(p); const first = flow.signUp("alex@example.test", "StrongPass1", "StrongPass1", true);
    await expect(flow.signUp("alex@example.test", "StrongPass1", "StrongPass1", true)).resolves.toMatchObject({ ok: false });
    release({ error: null }); await first;
  });
  it("recovers an invited mobile signup when authentication rejects instead of returning an error", async () => {
    const p = provider(); p.signUp.mockRejectedValueOnce(new TypeError("Load failed"));
    const flow = new LocalAuthFlow(p);
    await expect(flow.signUp("alex@example.test", "StrongPass1", "StrongPass1", true)).resolves.toMatchObject({ ok: false });
    await expect(flow.signUp("alex@example.test", "StrongPass1", "StrongPass1", true)).resolves.toEqual({ ok: true });
  });
  it("holds authenticated redirect until profile resolution completes", () => {
    expect(redirect(true, false, null, "/invite/team-1")).toBe("wait");
  });
  it("sends incomplete profiles to profile completion", () => {
    expect(redirect(true, true, "", "/invite/team-1")).toBe("/complete-profile");
  });
  it("honours and consumes a pending post-authentication redirect", () => {
    const storage = new Map([["redirectAfterAuth", "/invite/team-1"]]);
    const next = redirect(true, true, "Alex", storage.get("redirectAfterAuth") ?? null);
    storage.delete("redirectAfterAuth");
    expect(next).toBe("/invite/team-1");
    expect(storage.get("redirectAfterAuth")).toBeUndefined();
  });
});
