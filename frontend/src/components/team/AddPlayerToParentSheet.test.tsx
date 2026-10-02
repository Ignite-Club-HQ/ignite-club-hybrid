import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  toast: vi.fn(),
  releaseCreate: null as null | ((value: { data: string; error: null }) => void),
  withFeatureBackend: vi.fn(
    (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
      providers.supabase(),
  ),
  createLiveChildForParentOnTeam: vi.fn(),
  registerLiveChildNamePii: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: mocks.withFeatureBackend,
}));
vi.mock("@/live/features/club", () => ({
  createLiveChildForParentOnTeam: mocks.createLiveChildForParentOnTeam,
}));
vi.mock("@/live/features/vault", () => ({
  registerLiveChildNamePii: mocks.registerLiveChildNamePii,
}));
vi.mock("@icp-sdk/core/principal", () => ({
  Principal: { fromText: (text: string) => ({ _isPrincipal: true, text }) },
}));

import AddPlayerToParentSheet from "./AddPlayerToParentSheet";

function renderSheet(onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(
    <AddPlayerToParentSheet
      open
      onOpenChange={onOpenChange}
      teamId="team-1"
      teamName="Under 10 Blue"
      clubId="club-1"
      defaultParentUserId="parent-1"
      rawMembers={[{
        user_id: "parent-1",
        role: "parent",
        profiles: { id: "parent-1", display_name: "Synthetic Parent", avatar_url: null },
      }]}
    />,
    { wrapper },
  );
  return { invalidate, onOpenChange };
}

describe("AddPlayerToParentSheet — canonical child creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseCreate = null;
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "list_club_parents_for_team") return Promise.resolve({ data: [], error: null });
      if (name === "create_child_for_parent_on_team") {
        return new Promise((resolve) => { mocks.releaseCreate = resolve; });
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
  });

  it("sends normalized identity and exact parent/team scope through the idempotent RPC", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "  Ava Smith  " } });
    fireEvent.change(screen.getByLabelText("Year of birth (optional)"), { target: { value: "2016" } });
    fireEvent.click(screen.getByRole("button", { name: "Add player" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "create_child_for_parent_on_team",
      {
        p_parent_user_id: "parent-1",
        p_team_id: "team-1",
        p_name: "Ava Smith",
        p_year_of_birth: 2016,
      },
    ));
  });

  it("allows only one creation request while the first request is pending", async () => {
    renderSheet();
    fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "Ava Smith" } });
    const submit = screen.getByRole("button", { name: "Add player" });
    fireEvent.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "create_child_for_parent_on_team")).toHaveLength(1);

    await act(async () => mocks.releaseCreate?.({ data: "canonical-child-1", error: null }));
  });

  it("refreshes the roster only after the canonical child id is returned", async () => {
    const { invalidate, onOpenChange } = renderSheet();
    fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "Ava Smith" } });
    fireEvent.click(screen.getByRole("button", { name: "Add player" }));

    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["team-children", "team-1"] });
    await waitFor(() => expect(mocks.releaseCreate).not.toBeNull());
    await act(async () => {
      mocks.releaseCreate?.({ data: "canonical-child-1", error: null });
      await Promise.resolve();
    });
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["team-children", "team-1"] }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not report success or refresh membership when canonical creation fails", async () => {
    mocks.rpc.mockImplementation((name: string) => name === "list_club_parents_for_team"
      ? Promise.resolve({ data: [], error: null })
      : Promise.resolve({ data: null, error: { message: "duplicate identity conflict" } }));
    const { invalidate } = renderSheet();
    fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "Ava Smith" } });
    fireEvent.click(screen.getByRole("button", { name: "Add player" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't add player",
      variant: "destructive",
    })));
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["team-children", "team-1"] });
  });

  it("ICP: creates the child with club/team/parent args and registers the name on the PII canister", async () => {
    mocks.withFeatureBackend.mockImplementation(
      (_feature: string, providers: { icp: (ctx: unknown) => unknown }) =>
        providers.icp({ identity: {}, target: {} }),
    );
    mocks.createLiveChildForParentOnTeam.mockResolvedValue({ id: "child-1" });
    mocks.registerLiveChildNamePii.mockResolvedValue(undefined);

    renderSheet();
    fireEvent.change(screen.getByLabelText("Player name"), { target: { value: "Ava Smith" } });
    fireEvent.click(screen.getByRole("button", { name: "Add player" }));

    await waitFor(() =>
      expect(mocks.createLiveChildForParentOnTeam).toHaveBeenCalledWith(
        expect.anything(),
        "club-1",
        "team-1",
        expect.objectContaining({ _isPrincipal: true }),
      ),
    );
    await waitFor(() =>
      expect(mocks.registerLiveChildNamePii).toHaveBeenCalledWith(
        expect.anything(),
        "child-1",
        "Ava Smith",
        expect.objectContaining({ _isPrincipal: true }),
      ),
    );
  });
});
