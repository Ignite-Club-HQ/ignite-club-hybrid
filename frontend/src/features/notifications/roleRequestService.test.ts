import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { friendlyRoleRequestError, processRoleRequest } from "./roleRequestService";

type IgniteSupabaseClient = SupabaseClient<Database>;

function fakeClient(options: { request?: unknown; fetchError?: unknown; actionError?: unknown; email?: string | null; invokeError?: Error } = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const query = {
    select: (...args: unknown[]) => { calls.push({ name: "select", args }); return query; },
    eq: (...args: unknown[]) => { calls.push({ name: "eq", args }); return query; },
    maybeSingle: async () => ({ data: options.request ?? null, error: options.fetchError ?? null }),
  };
  const client = {
    from: (table: string) => { calls.push({ name: "from", args: [table] }); return query; },
    rpc: async (name: string, args: unknown) => {
      calls.push({ name: "rpc", args: [name, args] });
      if (name === "get_user_emails_by_ids") return { data: options.email ? [{ email: options.email }] : [], error: null };
      return { data: null, error: options.actionError ?? null };
    },
    functions: { invoke: async (name: string, args: unknown) => {
      calls.push({ name: "invoke", args: [name, args] });
      if (options.invokeError) throw options.invokeError;
      return { data: null, error: null };
    } },
  } as unknown as IgniteSupabaseClient;
  return { client, calls };
}

const request = {
  user_id: "user-a", role: "team_admin", team_id: "team-a", club_id: "club-a",
  teams: { id: "team-a", name: "U8 Blue", club_id: "club-a", clubs: { id: "club-a", name: "Riverside FC", logo_url: "logo.png" } },
  clubs: null,
};
const profileLookup = async () => ({ data: { display_name: "Alex" } });

afterEach(() => vi.restoreAllMocks());

describe("role request service", () => {
  it.each([
    ["approve", "approve_role_request"],
    ["deny", "deny_role_request"],
  ] as const)("loads the request before invoking the secure %s RPC", async (action, rpcName) => {
    const fake = fakeClient({ request });
    await processRoleRequest("request-a", action, fake.client, profileLookup);
    const fromIndex = fake.calls.findIndex((call) => call.name === "from");
    const rpcIndex = fake.calls.findIndex((call) => call.name === "rpc" && call.args[0] === rpcName);
    expect(fromIndex).toBeLessThan(rpcIndex);
    expect(fake.calls[rpcIndex]).toEqual({ name: "rpc", args: [rpcName, { p_request_id: "request-a" }] });
  });

  it("sends the approved team welcome payload only after approval succeeds", async () => {
    const fake = fakeClient({ request, email: "alex@example.com" });
    await processRoleRequest("request-a", "approve", fake.client, profileLookup);
    expect(fake.calls.find((call) => call.name === "invoke")).toMatchObject({
      args: ["send-email", { body: { to: "alex@example.com", subject: "Welcome to U8 Blue! 🎉", template: "join-request-response",
        templateData: { recipientName: "Alex", teamName: "U8 Blue", clubName: "Riverside FC", roleName: "team admin", approved: true, teamLink: "/teams/team-a", clubLogoUrl: "logo.png" } } }],
    });
  });

  it("sends denial email without an approval destination link", async () => {
    const fake = fakeClient({ request, email: "alex@example.com" });
    await processRoleRequest("request-a", "deny", fake.client, profileLookup);
    const invocation = fake.calls.find((call) => call.name === "invoke");
    expect(invocation).toBeDefined();
    expect(invocation?.args[1]).toMatchObject({ body: { templateData: { approved: false } } });
    expect(JSON.stringify(invocation)).not.toContain("teamLink");
  });

  it("stops before mutation when the request is missing", async () => {
    const fake = fakeClient();
    await expect(processRoleRequest("missing", "approve", fake.client, profileLookup)).rejects.toThrow("Request not found");
    expect(fake.calls.some((call) => call.name === "rpc")).toBe(false);
  });

  it("propagates secure RPC failures and never sends email", async () => {
    const error = { code: "42501", message: "permission denied" };
    const fake = fakeClient({ request, actionError: error, email: "alex@example.com" });
    await expect(processRoleRequest("request-a", "approve", fake.client, profileLookup)).rejects.toBe(error);
    expect(fake.calls.some((call) => call.name === "invoke")).toBe(false);
  });

  it("does not report a completed mutation as failed when email throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeClient({ request, email: "alex@example.com", invokeError: new Error("email offline") });
    await expect(processRoleRequest("request-a", "approve", fake.client, profileLookup)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("friendly role request errors", () => {
  it.each([
    [{ message: "permission denied" }, "You don't have permission to approve"],
    [{ message: "already processed" }, "already been denied"],
    [{ message: "request not found" }, "no longer exists"],
    [{ message: "Failed to fetch" }, "Check your connection"],
    [{ message: "unexpected" }, "contact support"],
  ])("classifies actionable failures", (error, expected) => {
    expect(friendlyRoleRequestError(error, expected.includes("denied") ? "deny" : "approve")).toContain(expected);
  });
});
