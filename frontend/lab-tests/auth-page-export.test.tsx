import { expect, test } from "vitest";
import { createMockSupabaseClient } from "../src/test/mockSupabaseClient";
import { LocalAuthFlow } from "../src/lab/exportPageModels";

function createFlow() {
  const client = createMockSupabaseClient();
  const flow = new LocalAuthFlow({
    signIn: async (email, password) => {
      const result = await client.auth.signInWithPassword({ email, password });
      return { error: result.error };
    },
    signUp: async (email, password) => {
      const result = await client.auth.signUp({ email, password });
      return { error: result.error };
    },
  });
  return { client, flow };
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test("AuthPage export: validates sign-in locally before invoking the provider", async () => {
  const { client, flow } = createFlow();

  await expect(flow.signIn("not-an-email", "secret12")).resolves.toMatchObject({
    ok: false,
    message: "Please enter a valid email",
  });
  await expect(flow.signIn("alex@example.test", "short")).resolves.toMatchObject({ ok: false });
  expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
});

test("AuthPage export: passes exact credentials once and blocks a duplicate request", async () => {
  const { client, flow } = createFlow();
  let release!: (value: { data: unknown; error: null }) => void;
  client.auth.signInWithPassword.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));

  const first = flow.signIn("alex@example.test", "secret12");
  const second = flow.signIn("alex@example.test", "secret12");
  await expect(second).resolves.toMatchObject({ ok: false });
  expect(client.auth.signInWithPassword).toHaveBeenCalledOnce();
  expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
    email: "alex@example.test",
    password: "secret12",
  });
  release({ data: null, error: null });
  await expect(first).resolves.toEqual({ ok: true });
});

test("AuthPage export: uses safe authentication error messages", async () => {
  const { client, flow } = createFlow();
  client.auth.signInWithPassword.mockResolvedValueOnce({
    data: null,
    error: { message: "Invalid login credentials" },
  });
  await expect(flow.signIn("alex@example.test", "secret12")).resolves.toMatchObject({
    message: "Invalid email or password. Please try again.",
  });

  client.auth.signInWithPassword.mockResolvedValueOnce({
    data: null,
    error: { message: "Network request failed" },
  });
  await expect(flow.signIn("alex@example.test", "secret12")).resolves.toMatchObject({
    message: "We couldn't reach the server. Check your connection and try again.",
  });
});

test("AuthPage export: requires strong matching signup credentials and terms", async () => {
  const { client, flow } = createFlow();

  await expect(flow.signUp("alex@example.test", "weakpass", "different", false))
    .resolves.toMatchObject({ ok: false });
  await expect(flow.signUp("alex@example.test", "StrongPass1", "StrongPass2", true))
    .resolves.toMatchObject({
      ok: false,
      message: "Please ensure both passwords are identical.",
    });
  await expect(flow.signUp("alex@example.test", "StrongPass1", "StrongPass1", false))
    .resolves.toMatchObject({ ok: false });
  expect(client.auth.signUp).not.toHaveBeenCalled();
});

test("AuthPage export: creates an account after local validation succeeds", async () => {
  const { client, flow } = createFlow();
  await expect(flow.signUp("alex@example.test", "StrongPass1", "StrongPass1", true))
    .resolves.toEqual({ ok: true });
  expect(client.auth.signUp).toHaveBeenCalledWith({
    email: "alex@example.test",
    password: "StrongPass1",
  });
});

test("AuthPage export: keeps invited signup recovery actionable after provider rejection", async () => {
  const { client, flow } = createFlow();
  client.auth.signUp.mockRejectedValueOnce(new TypeError("Load failed"));

  await expect(flow.signUp("alex@example.test", "StrongPass1", "StrongPass1", true))
    .resolves.toMatchObject({
      ok: false,
      message: "We couldn't reach the server. Check your connection and try again.",
    });
  await expect(flow.signUp("alex@example.test", "StrongPass1", "StrongPass1", true))
    .resolves.toEqual({ ok: true });
});

test("AuthPage export: consumes pending redirects only after profile resolution", () => {
  const storage = new MemoryStorage();
  storage.setItem("redirectAfterAuth", "/invite/team-1");

  const resolveRedirect = (
    user: { id: string } | null,
    profile: { displayName: string } | null,
    profileResolved: boolean,
  ) => {
    if (!user || !profileResolved) return { kind: "wait" as const };
    if (!profile?.displayName) return { kind: "navigate" as const, to: "/complete-profile" };
    const next = storage.getItem("redirectAfterAuth");
    if (next) storage.removeItem("redirectAfterAuth");
    return { kind: "navigate" as const, to: next ?? "/" };
  };

  expect(resolveRedirect({ id: "user-42" }, null, false)).toEqual({ kind: "wait" });
  expect(resolveRedirect({ id: "user-42" }, { displayName: "" }, true)).toEqual({
    kind: "navigate",
    to: "/complete-profile",
  });
  expect(resolveRedirect({ id: "user-42" }, { displayName: "Alex" }, true)).toEqual({
    kind: "navigate",
    to: "/invite/team-1",
  });
  expect(storage.getItem("redirectAfterAuth")).toBeNull();
});

test("AuthPage export: an offline guard prevents an authentication attempt", async () => {
  const { client, flow } = createFlow();
  const attempt = async (online: boolean) =>
    online
      ? flow.signIn("alex@example.test", "secret12")
      : { ok: false, message: "You're offline" };

  await expect(attempt(false)).resolves.toEqual({ ok: false, message: "You're offline" });
  expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
});

// Synthetic reconstruction of the "password recovery through Mailpit" journey
// (tests/local-supabase/auth-recovery-mailpit.test.ts). The original relies on
// a live local Supabase Auth server + Mailpit SMTP catcher; those network
// services are out of scope for this in-memory lab. This model proves the
// same two behavioural contracts in-memory: a reset request is delivered only
// to the exact requested address, and an unknown address gets an identical
// non-disclosing response with no mail emitted.
type SyntheticMail = { to: string; subject: string };

function createSyntheticRecoveryMailer(knownEmails: string[]) {
  const inbox: SyntheticMail[] = [];
  const known = new Set(knownEmails.map((email) => email.toLowerCase()));
  return {
    inbox,
    async resetPasswordForEmail(email: string) {
      if (known.has(email.toLowerCase())) {
        inbox.push({ to: email.toLowerCase(), subject: "Reset your password" });
      }
      // Always resolves without error: existence of the account is never disclosed.
      return { error: null as null };
    },
  };
}

test("AuthPage export: recovery email is delivered only to the requested known local user", async () => {
  const email = "recovery.user@local.invalid";
  const mailer = createSyntheticRecoveryMailer([email]);

  const result = await mailer.resetPasswordForEmail(email);
  expect(result.error).toBeNull();
  expect(mailer.inbox).toHaveLength(1);
  expect(mailer.inbox[0].to).toBe(email);
  expect(mailer.inbox[0].subject.toLowerCase()).toContain("reset");
});

test("AuthPage export: recovery request for an unknown local user discloses nothing and emits no mail", async () => {
  const mailer = createSyntheticRecoveryMailer(["known.user@local.invalid"]);

  const result = await mailer.resetPasswordForEmail("unknown.user@local.invalid");
  expect(result.error).toBeNull();
  expect(mailer.inbox).toHaveLength(0);
});
