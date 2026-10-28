import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamJoinLinkCard from "./TeamJoinLinkCard";

const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-principal" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/rolesCache", () => ({ getCachedRoles: () => [] }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, handlers: { icp: (ctx: object) => unknown }) => handlers.icp({}),
}));
vi.mock("@/live/features/club", () => ({
  listLiveTeamInviteLinks: mocks.list,
  createLiveTeamInviteLink: mocks.create,
  rotateLiveTeamInviteLink: vi.fn(), revokeLiveTeamInviteLink: vi.fn(),
  listLivePendingInvitesByClub: vi.fn().mockResolvedValue([]), getLiveTeam: vi.fn(),
}));

function mount(managerOverride: boolean, autoCreateLink = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><TeamJoinLinkCard
    teamId="u10" teamName="U10 Hawks" clubId="riverdogs"
    managerOverride={managerOverride} autoCreateLink={autoCreateLink}
  /></QueryClientProvider>);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  let rows: object[] = [];
  mocks.list.mockImplementation(async () => rows);
  mocks.create.mockImplementation(async (_ctx, club, team, role) => {
    const row = { id: "link-1", token: "test-token", role, revoked: false, created_at_ms: 0n };
    rows = [row];
    return row;
  });
});
afterEach(cleanup);

describe("ICP team invite manager access without email role cache", () => {
  it("creates a player link for the resolved manager and displays its QR", async () => {
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "Create player link" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({}, "riverdogs", "u10", "player"));
    await waitFor(() => expect(document.querySelector("#qr-link-1 svg")).not.toBeNull());
  });
  it("auto-creates the default link only for a resolved manager", async () => {
    mount(true, true);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    expect(mocks.create).toHaveBeenCalledWith({}, "riverdogs", "u10", "player");
  });
  it("does not create links for nonmanagers", async () => {
    mount(false, true);
    await screen.findByText(/No player link yet/);
    expect(screen.queryByRole("button", { name: "Create player link" })).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not automatically create coach links", async () => {
    mount(true);
    await screen.findByRole("button", { name: "Create player link" });
    fireEvent.click(screen.getByRole("radio", { name: "Coach" }));
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Create coach link" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});