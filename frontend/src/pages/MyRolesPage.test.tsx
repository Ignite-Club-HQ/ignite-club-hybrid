import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Principal } from "@icp-sdk/core/principal";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const supabaseFromMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => supabaseFromMock(...args),
  },
}));

const connectLocalIdentityAccessClientMock = vi.fn();
const resetLocalIdentityAccessClientMock = vi.fn();
vi.mock("@/lab/localIdentityAccess", () => ({
  connectLocalIdentityAccessClient: (...args: unknown[]) => connectLocalIdentityAccessClientMock(...args),
  resetLocalIdentityAccessClient: () => resetLocalIdentityAccessClientMock(),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/hooks/useClubTheme", () => ({
  useClubTheme: () => ({ activeClubFilter: null }),
}));

async function renderPage(path = "/roles?backend=icp") {
  window.history.replaceState({}, "", path);
  const { default: Page } = await import("./MyRolesPage");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetModules();
  navigateMock.mockReset();
  supabaseFromMock.mockReset();
  connectLocalIdentityAccessClientMock.mockReset();
  resetLocalIdentityAccessClientMock.mockReset();
});

afterEach(cleanup);

describe("MyRolesPage — ICP identity access", () => {
  it("queries the signed local identity/access client without mounting Supabase", async () => {
    const accessScoped = vi.fn().mockResolvedValue({
      account_id: "account-1",
      app_admin: false,
      club_admin: true,
      guardian: false,
      team_member: true,
    });
    connectLocalIdentityAccessClientMock.mockResolvedValue({
      canisterId: Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai"),
      client: {
        whoami: vi.fn().mockResolvedValue({
          id: "account-1",
          version: 3n,
          principals: [Principal.fromText("2ibo7-dia")],
        }),
        accessScoped,
      },
    });

    await renderPage("/roles?backend=icp&persona=club_admin&siteId=site-a&clubId=club-a&teamId=team-a");

    expect(await screen.findByText(/My ICP Access/i)).toBeTruthy();
    await waitFor(() => expect(connectLocalIdentityAccessClientMock).toHaveBeenCalledWith("club_admin"));
    expect(accessScoped).toHaveBeenCalledWith("site-a", "club-a", "team-a", undefined);
    expect(screen.getByText("account-1")).toBeTruthy();
    expect(screen.getByText(/Club administrator: granted/i)).toBeTruthy();
    expect(supabaseFromMock).not.toHaveBeenCalled();
  });

  it("fails closed when the local identity canister is unavailable", async () => {
    connectLocalIdentityAccessClientMock.mockRejectedValue(new Error("Local identity access canister is not configured."));

    await renderPage("/roles?backend=icp");

    expect((await screen.findByRole("alert")).textContent).toContain("No Supabase fallback was used");
    expect(supabaseFromMock).not.toHaveBeenCalled();
  });
});
