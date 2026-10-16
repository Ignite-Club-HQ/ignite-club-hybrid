// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ get: vi.fn(), roles: vi.fn(), settings: vi.fn(), from: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, providers: any) => providers.icp({}) }));
vi.mock("@/live/features/messaging", () => ({ getLiveClubDmSettings: mocks.get, setLiveClubDmAllowedRoles: mocks.roles, setLiveClubDmSettings: mocks.settings }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ onValueChange, children }: { onValueChange: (value: string) => void; children: ReactNode }) => <div><button onClick={() => onValueChange("coach")}>Choose Coach</button>{children}</div>,
  SelectContent: () => null,
  SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectItem: () => null,
}));
import { ClubDMSettings } from "./ClubDMSettings";

const admins = ["app_admin", "club_admin", "team_admin"];
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ dm_disabled: false, attachments_disabled: true, allowed_roles: [...admins] });
  mocks.roles.mockImplementation(async (_ctx, _club, roles) => {
    mocks.get.mockResolvedValue({ dm_disabled: false, attachments_disabled: true, allowed_roles: roles });
  });
  mocks.settings.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });
function open() {
  render(<QueryClientProvider client={client}><ClubDMSettings clubId="giddy-goat" /></QueryClientProvider>);
}
async function addCoach() {
  fireEvent.click(await screen.findByRole("button", { name: "Choose Coach" }));
  const add = screen.getAllByRole("button").find(button => button.querySelector("svg.lucide-plus"));
  if (!add) throw new Error("Add-role control missing");
  fireEvent.click(add);
}
describe("ICP DM role preferences", () => {
  it("loads saved Coach permission from ICP, not Supabase", async () => {
    mocks.get.mockResolvedValue({ dm_disabled: false, attachments_disabled: true, allowed_roles: [...admins, "coach"] });
    open();
    await waitFor(() => expect(client.getQueryData(["club-dm-settings", "giddy-goat"])).toMatchObject({ allowed_roles: [...admins, "coach"] }));
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("saves Coach and retains it after refetch without changing attachment settings", async () => {
    open();
    await addCoach();
    await waitFor(() => expect(mocks.roles).toHaveBeenCalledWith({}, "giddy-goat", [...admins, "coach"]));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    expect(client.getQueryData(["club-dm-settings", "giddy-goat"])).toMatchObject({ allowed_roles: [...admins, "coach"] });
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("preserves disabled attachments when toggling DMs", async () => {
    open();
    fireEvent.click(await screen.findByRole("switch"));
    await waitFor(() => expect(mocks.settings).toHaveBeenCalledWith({}, "giddy-goat", true, true));
    expect(mocks.roles).not.toHaveBeenCalled();
  });
  it("does not report or cache Coach permission when saving fails", async () => {
    mocks.roles.mockRejectedValue(new Error("Permission denied"));
    open();
    await addCoach();
    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
    expect(client.getQueryData(["club-dm-settings", "giddy-goat"])).toMatchObject({ allowed_roles: admins });
  });
});