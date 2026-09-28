import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PendingInviteWelcomeDialog } from "./PendingInviteWelcomeDialog";

// --- Mocks ---------------------------------------------------------------

const rpcMock = vi.fn();
const functionsInvokeMock = vi.fn().mockResolvedValue({ data: {}, error: null });

// Per-table mutable state
type UserRole = {
  id: string;
  user_id: string;
  role: string;
  team_id: string | null;
  club_id: string | null;
};
const state: {
  pending_invites: any[];
  user_roles: UserRole[];
  child_guardians: any[];
} = {
  pending_invites: [],
  user_roles: [],
  child_guardians: [],
};

const fromMock = vi.fn((table: string) => {
  const filters: Record<string, any> = {};
  const isNull: string[] = [];

  const rowsMatching = () => {
    let rows = (state as any)[table] ?? [];
    for (const [k, v] of Object.entries(filters)) {
      rows = rows.filter((r: any) => r[k] === v);
    }
    for (const k of isNull) {
      rows = rows.filter((r: any) => r[k] == null);
    }
    return rows;
  };

  const chain: any = {
    select: () => chain,
    eq: (k: string, v: any) => {
      filters[k] = v;
      return chain;
    },
    is: (k: string, _v: null) => {
      isNull.push(k);
      return chain;
    },
    limit: () => chain,
    // Thenable — awaiting the chain returns all matching rows.
    then: (resolve: any) => resolve({ data: rowsMatching(), error: null }),
    maybeSingle: async () => {
      const rows = rowsMatching();
      return { data: rows[0] ?? null, error: null };
    },
    single: async () => {
      const rows = rowsMatching();
      return { data: rows[0] ?? null, error: rows[0] ? null : { message: "no rows" } };
    },
    insert: (row: any) => {
      const doInsert = () => {
        (state as any)[table].push({ id: `${table}-${Date.now()}-${Math.random()}`, ...row });
        return { data: null, error: null };
      };
      // Support both `await supabase.from().insert()` and `.insert().then(...)`
      const p: any = Promise.resolve(doInsert());
      p.then = (fn: any, rej: any) => Promise.resolve(doInsert()).then(fn, rej);
      return p;
    },
    update: (patch: any) => ({
      eq: async (k: string, v: any) => {
        for (const r of (state as any)[table]) {
          if (r[k] === v) Object.assign(r, patch);
        }
        return { data: null, error: null };
      },
    }),
  };
  return chain;
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => fromMock(t),
    rpc: (...args: any[]) => rpcMock(...args),
    functions: { invoke: (...args: any[]) => functionsInvokeMock(...args) },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", user_metadata: { display_name: "Test User" } },
  }),
}));

vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ setActiveClubTheme: vi.fn() }),
}));

vi.mock("@/lib/seedClubFilterFromInvite", () => ({
  seedClubFilterFromInvite: () => false,
}));

// --- Helpers -------------------------------------------------------------

function renderComponent() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PendingInviteWelcomeDialog />
    </QueryClientProvider>
  );
}

async function flush() {
  // Allow the queryFn microtasks + the useEffect chain to drain.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

function makeGuardianInvite(overrides: Partial<any> = {}) {
  return {
    id: "invite-guardian-1",
    role: "parent",
    invite_token: "tok-1",
    team_id: "team-1",
    club_id: "club-1",
    invited_user_id: "user-1",
    invited_label: null,
    status: "pending",
    metadata: {
      guardian_child_id: "child-1",
      guardian_child_name: "Kiddo",
      guardian_all_team_ids: ["team-1"],
    },
    teams: { name: "U10 Blue", club_id: "club-1", clubs: { name: "Test FC" } },
    clubs: null,
    ...overrides,
  };
}

beforeEach(() => {
  rpcMock.mockReset();
  functionsInvokeMock.mockClear();
  state.pending_invites = [];
  state.user_roles = [];
  state.child_guardians = [];
});

// --- Tests ---------------------------------------------------------------

describe("PendingInviteWelcomeDialog — guardian invite transactional acceptance", () => {
  it("successful guardian RPC marks the invite accepted via the RPC (no client user_roles insert)", async () => {
    const invite = makeGuardianInvite();
    state.pending_invites = [invite];
    // Simulate the server-side RPC succeeding by mutating pending_invites like the DB would.
    rpcMock.mockImplementation(async () => {
      invite.status = "accepted";
      return { data: { success: true, invite_id: invite.id, team_ids: ["team-1"] }, error: null };
    });

    renderComponent();
    await flush();

    expect(rpcMock).toHaveBeenCalledWith("accept_guardian_parent_invite", { _invite_id: invite.id });
    expect(invite.status).toBe("accepted");
    // The client MUST NOT have inserted a user_roles row itself — the RPC owns that.
    expect(state.user_roles).toHaveLength(0);
  });

  it("does not accept a parent invite when its required guardian link fails", async () => {
    const invite = makeGuardianInvite();
    state.pending_invites = [invite];
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "child_guardians insert failed", code: "23503" },
    });

    renderComponent();
    await flush();

    expect(rpcMock).toHaveBeenCalledTimes(1);
    // Invite stays pending, no roles created, no email sent.
    expect(invite.status).toBe("pending");
    expect(state.user_roles).toHaveLength(0);
    expect(functionsInvokeMock).not.toHaveBeenCalled();
  });

  it("a failed guardian invite does not stop a later valid guardian invite from being processed", async () => {
    const failing = makeGuardianInvite({ id: "invite-fail" });
    const succeeding = makeGuardianInvite({
      id: "invite-ok",
      metadata: { ...makeGuardianInvite().metadata, guardian_child_id: "child-2" },
    });
    state.pending_invites = [failing, succeeding];

    rpcMock.mockImplementation(async (_fn: string, args: any) => {
      if (args._invite_id === failing.id) {
        return { data: null, error: { message: "boom" } };
      }
      succeeding.status = "accepted";
      return { data: { success: true, invite_id: succeeding.id, team_ids: [] }, error: null };
    });

    renderComponent();
    await flush();

    expect(rpcMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(failing.status).toBe("pending");
    expect(succeeding.status).toBe("accepted");
  });

  it("treats a duplicate guardian relationship as idempotent success (RPC returns success)", async () => {
    // The RPC absorbs unique_violation internally and still returns success.
    const invite = makeGuardianInvite();
    state.pending_invites = [invite];
    // Pre-seed an existing guardian row to mimic the real duplicate scenario.
    state.child_guardians.push({
      child_id: "child-1",
      guardian_id: "user-1",
      relationship_type: "parent",
      is_primary: false,
    });
    rpcMock.mockImplementation(async () => {
      invite.status = "accepted";
      return { data: { success: true, invite_id: invite.id, team_ids: ["team-1"] }, error: null };
    });

    renderComponent();
    await flush();

    expect(invite.status).toBe("accepted");
    // Only the pre-existing row — no duplicate created on the client.
    expect(state.child_guardians).toHaveLength(1);
  });

  it("routes guardian_child_id invites to the RPC and never falls back to the raw child_guardians insert on the client", async () => {
    const invite = makeGuardianInvite();
    state.pending_invites = [invite];
    rpcMock.mockResolvedValue({
      data: { success: true, invite_id: invite.id, team_ids: [] },
      error: null,
    });

    renderComponent();
    await flush();

    // No client-side write to child_guardians for the guardian path.
    expect(state.child_guardians).toHaveLength(0);
    expect(rpcMock).toHaveBeenCalledWith("accept_guardian_parent_invite", { _invite_id: invite.id });
  });

  it("ordinary non-parent invites are unaffected by the RPC branch", async () => {
    const coachInvite = {
      id: "invite-coach",
      role: "coach",
      invite_token: "tok-c",
      team_id: "team-1",
      club_id: "club-1",
      invited_user_id: "user-1",
      status: "pending",
      metadata: null,
      teams: { name: "U10 Blue", club_id: "club-1", clubs: { name: "Test FC" } },
      clubs: null,
    };
    state.pending_invites = [coachInvite];

    renderComponent();
    await flush();

    // Guardian RPC MUST NOT be invoked for non-guardian invites.
    expect(rpcMock).not.toHaveBeenCalled();
    // Coach role should have been inserted by the standard path.
    expect(state.user_roles.some((r) => r.role === "coach" && r.team_id === "team-1")).toBe(true);
  });
});
