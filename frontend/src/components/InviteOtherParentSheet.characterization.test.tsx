/**
 * CHARACTERIZATION / REGRESSION SUITE — guardian invite workflow.
 *
 * Locks in:
 *  1. Team -> club scope resolution is authoritative and fails closed.
 *  2. Email transport/function errors are never recorded as delivery.
 *  3. Only positively verified provider responses count as sent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InviteOtherParentSheet from "./InviteOtherParentSheet";

// ---------------------------------------------------------------- mocks ----

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "me" } }) }));
vi.mock("@/hooks/useDebounce", () => ({ useDebounce: (v: unknown) => v }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));

interface Scenario {
  teamRow: { id: string; club_id: string | null } | null;
  teamError: { message: string } | null;
  insertError: { message: string } | null;
  invoke: { data: unknown; error: { message: string } | null } | (() => never);
}

const scenario: Scenario = {
  teamRow: { id: "team-1", club_id: "club-1" },
  teamError: null,
  insertError: null,
  invoke: { data: { success: true, verified: true, emailId: "prov-1" }, error: null },
};

const calls = {
  inserts: [] as any[],
  updates: [] as any[],
  invokes: [] as any[],
};

const invokeMock = vi.fn(async (_name: string, opts: any) => {
  calls.invokes.push(opts);
  if (typeof scenario.invoke === "function") return scenario.invoke();
  return scenario.invoke;
});

function builder(table: string) {
  const state: any = { table, op: "select", payload: null };
  const chain: any = {
    select: () => chain,
    ilike: () => chain,
    limit: async () => ({ data: [], error: null }),
    eq: (_c: string, v: string) => {
      state.eqValue = v;
      if (state.op === "update") {
        calls.updates.push({ table, values: state.payload, id: v });
        return Promise.resolve({ data: null, error: null });
      }
      return chain;
    },
    insert: (values: any) => {
      state.op = "insert";
      state.payload = values;
      calls.inserts.push({ table, values });
      return chain;
    },
    update: (values: any) => {
      state.op = "update";
      state.payload = values;
      return chain;
    },
    maybeSingle: async () => {
      if (table === "teams") return { data: scenario.teamRow, error: scenario.teamError };
      return { data: null, error: null };
    },
    single: async () => {
      if (state.op === "insert") {
        return scenario.insertError
          ? { data: null, error: scenario.insertError }
          : { data: { id: "invite-1" }, error: null };
      }
      if (table === "clubs") return { data: { name: "Club One", logo_url: null, contact_email: null }, error: null };
      if (table === "teams") return { data: { name: "Team One" }, error: null };
      return { data: null, error: null };
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(t),
    functions: { invoke: (...a: any[]) => (invokeMock as any)(...a) },
  },
}));

// ---------------------------------------------------------------- setup ----

function renderSheet(teamIds: string[] = ["team-1"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InviteOtherParentSheet
        open
        onOpenChange={() => {}}
        childId="child-1"
        childName="Sam"
        teamIds={teamIds}
      />
    </QueryClientProvider>,
  );
}

async function fillAndSubmit(opts: { email?: string } = {}) {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText(/search or type parent's name/i), "Jo Parent");
  if (opts.email !== undefined) {
    await user.click(screen.getByRole("button", { name: /^Email$/i }));
    await user.type(screen.getByPlaceholderText(/redacted@example.invalid/i), opts.email);
  }
  // The submit button label is mode-dependent: share mode reads
  // "Create & Share Link"; email mode (once an address is present) reads "Create Invite".
  const submit = await screen.findByRole("button", {
    name: opts.email !== undefined ? /create invite/i : /create & share link/i,
  });
  await user.click(submit);
  return user;
}

beforeEach(() => {
  toastMock.mockClear();
  invokeMock.mockClear();
  calls.inserts = [];
  calls.updates = [];
  calls.invokes = [];
  scenario.teamRow = { id: "team-1", club_id: "club-1" };
  scenario.teamError = null;
  scenario.insertError = null;
  scenario.invoke = { data: { success: true, verified: true, emailId: "prov-1" }, error: null };
});

const inviteInserts = () => calls.inserts.filter((i) => i.table === "pending_invites");
const sentAtUpdates = () => calls.updates.filter((u) => u.values?.email_sent_at);

// ----------------------------------------------------------------- tests ---

describe("scope resolution", () => {
  it("1. successful resolution creates exactly one correctly scoped invitation", async () => {
    renderSheet();
    await fillAndSubmit();
    await waitFor(() => expect(inviteInserts()).toHaveLength(1));
    expect(inviteInserts()[0].values).toMatchObject({ team_id: "team-1", club_id: "club-1", role: "parent" });
  });

  it("2. the email is normalized", async () => {
    renderSheet();
    await fillAndSubmit({ email: "  redacted@example.invalid  " });
    await waitFor(() => expect(inviteInserts()).toHaveLength(1));
    expect(inviteInserts()[0].values.invited_email).toBe("redacted@example.invalid");
  });

  it("3. guardian metadata contains the child and all team ids", async () => {
    renderSheet(["team-1", "team-2"]);
    await fillAndSubmit();
    await waitFor(() => expect(inviteInserts()).toHaveLength(1));
    expect(inviteInserts()[0].values.metadata).toMatchObject({
      guardian_child_id: "child-1",
      guardian_child_name: "Sam",
      guardian_all_team_ids: ["team-1", "team-2"],
      invited_by_parent: true,
    });
  });

  it("4. a team lookup error creates no invitation", async () => {
    scenario.teamError = { message: "boom" };
    scenario.teamRow = null;
    renderSheet();
    await fillAndSubmit({ email: "redacted@example.invalid" });
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(inviteInserts()).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: "destructive" });
    expect(String(toastMock.mock.calls[0][0].title)).toMatch(/couldn't verify the team and club/i);
    expect(screen.queryByText(/invite created/i)).not.toBeInTheDocument();
  });

  it("5. a missing team row creates no invitation", async () => {
    scenario.teamRow = null;
    renderSheet();
    await fillAndSubmit();
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(inviteInserts()).toHaveLength(0);
  });

  it("6. a team row with null club_id creates no invitation", async () => {
    scenario.teamRow = { id: "team-1", club_id: null };
    renderSheet();
    await fillAndSubmit();
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(inviteInserts()).toHaveLength(0);
  });

  it("6b. a mismatched team id creates no invitation", async () => {
    scenario.teamRow = { id: "other-team", club_id: "club-1" };
    renderSheet();
    await fillAndSubmit();
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(inviteInserts()).toHaveLength(0);
  });

  it("6c. empty teamIds preserves the existing club-null behaviour without a lookup", async () => {
    renderSheet([]);
    await fillAndSubmit();
    await waitFor(() => expect(inviteInserts()).toHaveLength(1));
    expect(inviteInserts()[0].values).toMatchObject({ team_id: null, club_id: null });
  });

  it("7. invite insertion failure prevents email invocation", async () => {
    scenario.insertError = { message: "rls" };
    renderSheet();
    await fillAndSubmit({ email: "redacted@example.invalid" });
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/invite created/i)).not.toBeInTheDocument();
  });
});

describe("email delivery verification", () => {
  it("8. invocation transport error preserves the invite/manual link but writes no email_sent_at", async () => {
    scenario.invoke = { data: null, error: { message: "network" } };
    renderSheet();
    await fillAndSubmit({ email: "redacted@example.invalid" });
    expect(await screen.findByText(/invite created/i)).toBeInTheDocument();
    expect(sentAtUpdates()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
  });

  it("9. success: false is not recorded as delivered", async () => {
    scenario.invoke = { data: { success: false, verified: true }, error: null };
    renderSheet();
    await fillAndSubmit({ email: "redacted@example.invalid" });
    expect(await screen.findByText(/invite created/i)).toBeInTheDocument();
    expect(sentAtUpdates()).toHaveLength(0);
  });

  it("10. verified: false is not recorded as delivered", async () => {
    scenario.invoke = { data: { success: true, verified: false }, error: null };
    renderSheet();
    await fillAndSubmit({ email: "redacted@example.invalid" });
    expect(await screen.findByText(/invite created/i)).toBeInTheDocument();
    expect(sentAtUpdates()).toHaveLength(0);
  });

  it("11. missing success/verification fields are not recorded as delivered", async () => {
    scenario.invoke = { data: {}, error: null };
    renderSheet();
    await fillAndSubmit({ email: "redacted@example.invalid" });
    expect(await screen.findByText(/invite created/i)).toBeInTheDocument();
    expect(sentAtUpdates()).toHaveLength(0);
    expect(calls.updates.some((u) => u.values?.email_error)).toBe(true);
  });

  it("12. verified success records email_sent_at (and provider id)", async () => {
    renderSheet();
    await fillAndSubmit({ email: "redacted@example.invalid" });
    await waitFor(() => expect(sentAtUpdates()).toHaveLength(1));
    expect(sentAtUpdates()[0].values.email_id).toBe("prov-1");
    expect(sentAtUpdates()[0].id).toBe("invite-1");
  });

  it("13. delivery failure messaging never says the invite was sent", async () => {
    scenario.invoke = { data: { success: false }, error: null };
    renderSheet();
    await fillAndSubmit({ email: "redacted@example.invalid" });
    expect(await screen.findByText(/email could not be sent/i)).toBeInTheDocument();
    expect(screen.queryByText(/invite sent to/i)).not.toBeInTheDocument();
  });

  it("14. verified success messaging does say the email was sent", async () => {
    renderSheet();
    await fillAndSubmit({ email: "a@b.com" });
    expect(await screen.findByText(/invite sent to a@b\.com/i)).toBeInTheDocument();
  });

  it("14b. share delivery never claims an email was sent", async () => {
    renderSheet();
    await fillAndSubmit();
    expect(await screen.findByText(/share it with them/i)).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("15. duplicate clicks create one invitation", async () => {
    renderSheet();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/search or type parent's name/i), "Jo Parent");
    const submit = screen.getByRole("button", { name: /create & share link/i });
    await user.click(submit);
    await user.click(submit);
    await waitFor(() => expect(inviteInserts().length).toBeGreaterThan(0));
    expect(inviteInserts()).toHaveLength(1);
  });

  it("16. retry after a scope failure succeeds once without duplicate invitations", async () => {
    scenario.teamRow = null;
    renderSheet();
    await fillAndSubmit();
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(inviteInserts()).toHaveLength(0);

    scenario.teamRow = { id: "team-1", club_id: "club-1" };
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /create & share link/i }));
    await waitFor(() => expect(inviteInserts()).toHaveLength(1));
  });

  it("16b. email failure does not automatically insert a second invite", async () => {
    scenario.invoke = { data: { success: true }, error: null };
    renderSheet();
    await fillAndSubmit({ email: "redacted@example.invalid" });
    expect(await screen.findByText(/invite created/i)).toBeInTheDocument();
    expect(inviteInserts()).toHaveLength(1);
  });
});
