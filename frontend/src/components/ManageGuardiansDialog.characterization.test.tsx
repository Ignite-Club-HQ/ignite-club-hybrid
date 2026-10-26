import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  from: vi.fn(),
  toast: vi.fn(),
  guardians: [] as any[],
  potential: [] as any[],
  insertError: null as any,
  deleteError: null as any,
  operations: [] as Array<{ kind: string; table: string; payload?: any; filters?: any[] }>,
  guardiansLive: vi.fn(),
  rolesLive: vi.fn(),
  profilesLive: vi.fn(),
  linkLive: vi.fn(),
  unlinkLive: vi.fn(),
  grantName: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => mocks.mode }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mocks.mode === "icp" ? providers.icp(mocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/club", () => ({ listLiveChildGuardians: (...args: unknown[]) => mocks.guardiansLive(...args) }));
vi.mock("@/live/features/membership", () => ({ listLiveTeamRoleGrants: (...args: unknown[]) => mocks.rolesLive(...args) }));
vi.mock("@/live/features/identityAccessClient", () => ({ listLiveProfilesByIds: (...args: unknown[]) => mocks.profilesLive(...args) }));
vi.mock("@/live/relationshipProfileRead", () => ({ readRelationshipProfiles: (...args: unknown[]) => mocks.profilesLive(...args) }));
vi.mock("@/live/features/vault", () => ({ grantLiveGuardianChildNameRead: (...args: unknown[]) => mocks.grantName(...args) }));
vi.mock("@icp-sdk/core/principal", () => ({ Principal: { fromText: (text: string) => ({ toText: () => text, text }) } }));

import ManageGuardiansDialog from "./ManageGuardiansDialog";

function queryFor(table: string) {
  const filters: any[] = [];
  const query: any = {};
  for (const method of ["select", "order"]) query[method] = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => {
    filters.push(["eq", column, value]);
    return query;
  });
  query.in = vi.fn((column: string, value: unknown) => {
    filters.push(["in", column, value]);
    return query;
  });
  query.insert = vi.fn((payload: any) => {
    mocks.operations.push({ kind: "insert", table, payload, filters: [...filters] });
    return Promise.resolve({ data: null, error: mocks.insertError });
  });
  query.delete = vi.fn(() => {
    mocks.operations.push({ kind: "delete", table, filters });
    return query;
  });
  Object.defineProperty(query, "then", {
    value: (resolve: any, reject: any) => {
      const deletion = [...mocks.operations].reverse().find(op => op.kind === "delete" && op.table === table && op.filters === filters);
      if (deletion) deletion.filters = [...filters];
      const result = deletion
        ? { data: null, error: mocks.deleteError }
        : { data: table === "child_guardians" ? mocks.guardians : mocks.potential, error: null };
      return Promise.resolve(result).then(resolve, reject);
    },
  });
  return query;
}

const primary = {
  id: "guardian-link-primary",
  guardian_id: "guardian-primary",
  relationship_type: "parent",
  is_primary: true,
  created_at: "2026-01-01T00:00:00Z",
  profiles: { id: "guardian-primary", display_name: "Primary Parent", avatar_url: null },
};
const second = {
  id: "guardian-link-second",
  guardian_id: "guardian-second",
  relationship_type: "guardian",
  is_primary: false,
  created_at: "2026-01-02T00:00:00Z",
  profiles: { id: "guardian-second", display_name: "Second Guardian", avatar_url: null },
};
const candidate = {
  user_id: "candidate-1",
  profiles: { id: "candidate-1", display_name: "Available Parent", avatar_url: null },
};

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(
    <ManageGuardiansDialog
      open
      onOpenChange={onOpenChange}
      childId="child-1"
      childName="Synthetic Child"
      teamIds={["team-1"]}
    />,
    { wrapper },
  );
  return { invalidate, onOpenChange };
}

function guardianRow(name: string) {
  const text = screen.getByText(name);
  const row = text.closest(".justify-between");
  if (!row) throw new Error(`Guardian row missing for ${name}`);
  return within(row as HTMLElement);
}

describe.runIf(mocks.mode === "supabase")("ManageGuardiansDialog characterization — relationship integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guardians = [primary, second];
    mocks.potential = [candidate];
    mocks.insertError = null;
    mocks.deleteError = null;
    mocks.operations = [];
    mocks.from.mockImplementation(queryFor);
  });

  it("shows every current guardian and clearly identifies the primary relationship", async () => {
    renderDialog();
    expect(await screen.findByText("Primary Parent")).toBeInTheDocument();
    expect(screen.getByText("Second Guardian")).toBeInTheDocument();
    expect(guardianRow("Primary Parent").getByText("Primary")).toBeInTheDocument();
  });

  it("does not expose a removal control for the primary guardian", async () => {
    renderDialog();
    await screen.findByText("Primary Parent");
    expect(guardianRow("Primary Parent").queryByRole("button")).not.toBeInTheDocument();
    expect(guardianRow("Second Guardian").getByRole("button")).toBeInTheDocument();
  });

  it("deletes only the selected non-primary guardian-link row", async () => {
    renderDialog();
    await screen.findByText("Second Guardian");
    fireEvent.click(guardianRow("Second Guardian").getByRole("button"));

    await waitFor(() => expect(mocks.operations.some(op => op.kind === "delete")).toBe(true));
    expect(mocks.operations.find(op => op.kind === "delete")).toEqual(expect.objectContaining({
      table: "child_guardians",
      filters: [["eq", "id", "guardian-link-second"]],
    }));
    expect(mocks.operations.some(op => op.kind === "delete" && op.filters?.some(f => f[1] === "child_id"))).toBe(false);
  });

  it("does not report success or refresh caches when guardian removal fails", async () => {
    mocks.deleteError = { message: "delete denied" };
    const { invalidate } = renderDialog();
    await screen.findByText("Second Guardian");
    fireEvent.click(guardianRow("Second Guardian").getByRole("button"));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "Failed to remove guardian", variant: "destructive" }));
    expect(mocks.toast).not.toHaveBeenCalledWith({ title: "Guardian removed" });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("adds the selected parent using the exact child and non-primary relationship contract", async () => {
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /Available Parent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Guardian" }));

    await waitFor(() => expect(mocks.operations.some(op => op.kind === "insert")).toBe(true));
    expect(mocks.operations.find(op => op.kind === "insert")).toEqual(expect.objectContaining({
      table: "child_guardians",
      payload: {
        child_id: "child-1",
        guardian_id: "candidate-1",
        relationship_type: "guardian",
        is_primary: false,
      },
    }));
  });

  it("maps a duplicate relationship race to a specific safe error", async () => {
    mocks.insertError = { message: "duplicate key value violates unique constraint" };
    const { invalidate } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /Available Parent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Guardian" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "This person is already a guardian",
      variant: "destructive",
    }));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("refreshes guardian and candidate lists only after a successful mutation", async () => {
    const { invalidate } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /Available Parent/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add Guardian" }));

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["child_guardians", "child-1"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["potential_guardians"] });
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Guardian added successfully" });
  });

  it("filters existing guardians and duplicate team roles out of available candidates", async () => {
    mocks.potential = [
      candidate,
      candidate,
      { user_id: second.guardian_id, profiles: second.profiles },
    ];
    renderDialog();
    expect(await screen.findAllByRole("button", { name: /Available Parent/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Second Guardian" })).not.toBeInTheDocument();
  });

  it("closes without issuing a mutation when no candidate is selected", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.operations.filter(op => op.kind === "insert" || op.kind === "delete")).toEqual([]);
  });
});

describe.runIf(mocks.mode === "icp")("ManageGuardiansDialog ICP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guardiansLive.mockResolvedValue([{ toText: () => "guardian-principal" }]);
    mocks.rolesLive.mockResolvedValue([]);
    mocks.profilesLive.mockResolvedValue([{ account_id: "guardian-principal", display_name: "Guardian One", avatar_ref: [] }]);
  });

  it("shows canister-linked guardians without Supabase reads or unsafe removal", async () => {
    renderDialog();
    expect(await screen.findByText("Guardian One")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/not available in ICP yet/i);
    expect(guardianRow("Guardian One").queryByRole("button")).not.toBeInTheDocument();
    expect(mocks.guardiansLive).toHaveBeenCalledWith(mocks.context, "child-1");
    expect(mocks.profilesLive).toHaveBeenCalledWith(mocks.context, ["guardian-principal"], { kind: 'family', resource: 'child-1' });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rolesLive).not.toHaveBeenCalled();
  });
});
