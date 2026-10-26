import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DutyTeamPicker } from "./DutyTeamPicker";

const listLiveMembershipTeams = vi.fn();

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: any) => providers.icp({ target: {}, identity: {} }),
}));

vi.mock("@/live/features/membership", () => ({
  listLiveMembershipTeams: (...args: unknown[]) => listLiveMembershipTeams(...args),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

function renderPicker() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DutyTeamPicker clubId="club-1" value={null} onChange={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("DutyTeamPicker ICP team list", () => {
  beforeEach(() => {
    listLiveMembershipTeams.mockReset();
  });

  it("keeps live teams whose Candid deleted_at_ms optional is an empty array", async () => {
    listLiveMembershipTeams.mockResolvedValue([
      { id: "team-live", name: "U9 Foxes", is_active: true, archived: false, is_shell: false, deleted_at_ms: [] },
      { id: "team-deleted", name: "Old Team", is_active: true, archived: false, is_shell: false, deleted_at_ms: [1n] },
      { id: "team-archived", name: "Archived Team", is_active: true, archived: true, is_shell: false, deleted_at_ms: [] },
    ]);
    renderPicker();
    await waitFor(() => expect(screen.getByText("U9 Foxes")).toBeTruthy());
    expect(screen.queryByText("Old Team")).toBeNull();
    expect(screen.queryByText("Archived Team")).toBeNull();
  });
});
