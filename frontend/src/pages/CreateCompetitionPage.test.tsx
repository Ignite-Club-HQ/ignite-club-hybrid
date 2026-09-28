/**
 * Regression tests for the personal-organiser competition creation flow.
 *
 * The historical bug: three sequential client-side inserts (clubs → user_roles
 * → competitions) could leave orphan shell clubs / roles behind if any step
 * after the first failed. The fix moves the personal path onto a transactional
 * `create_personal_competition` RPC. These tests pin that contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- Mocks --------------------------------------------------------------

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/ensureFreshSession", () => ({ ensureFreshSession: vi.fn().mockResolvedValue(undefined) }));

vi.mock("@/lib/profileCache", () => ({
  selectCachedProfileById: vi.fn().mockResolvedValue({ data: { display_name: "Paul" } }),
}));

vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => {} }));

vi.mock("@/hooks/useClubProAccess", () => ({
  useClubProAccess: () => ({ hasPro: true, isLoading: false }),
}));
vi.mock("@/hooks/useUserHasAnyClubPro", () => ({
  useUserHasAnyClubPro: () => ({ hasAnyClubPro: true, isLoading: false }),
}));
vi.mock("@/components/subscription/ProFeatureLock", () => ({
  ProFeatureLock: () => <div>ProLock</div>,
}));

const rpcMock = vi.fn();
const fromInsertMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpcMock(...args),
    from: (table: string) => ({
      insert: (payload: any) => fromInsertMock(table, payload),
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [] }) }),
      }),
    }),
  },
}));

// ---- Helpers ------------------------------------------------------------

async function renderPage() {
  const { default: Page } = await import("./CreateCompetitionPage");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function fillNameAndSubmit(nameValue = "Twilight Cup") {
  const nameInput = await screen.findByLabelText(/competition name/i);
  fireEvent.change(nameInput, { target: { value: nameValue } });
  const submit = screen.getByRole("button", { name: /create competition/i });
  fireEvent.click(submit);
}

beforeEach(() => {
  window.history.replaceState({}, "", "/?backend=supabase");
  navigateMock.mockReset();
  toastMock.mockReset();
  rpcMock.mockReset();
  fromInsertMock.mockReset();
});

afterEach(cleanup);

// ---- Tests --------------------------------------------------------------

describe("CreateCompetitionPage — personal organiser (atomic RPC)", () => {
  it("does not mount the Supabase workflow in ICP mode", async () => {
    window.history.replaceState({}, "", "/?backend=icp");
    await renderPage();

    expect(await screen.findByText(/new local ICP competition/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /create local ICP competition/i })).toBeTruthy();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(fromInsertMock).not.toHaveBeenCalled();
  });

  it("calls the transactional RPC once and never inserts shell/role/competition from the client", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ competition_id: "comp-1", club_id: "club-1" }],
      error: null,
    });
    await renderPage();
    await fillNameAndSubmit();

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith(
      "create_personal_competition",
      expect.objectContaining({
        p_name: "Twilight Cup",
        p_visibility: "private",
        p_shell_name: "Paul's competitions",
      })
    );
    // The old three-insert path must be gone.
    expect(fromInsertMock).not.toHaveBeenCalledWith("clubs", expect.anything());
    expect(fromInsertMock).not.toHaveBeenCalledWith("user_roles", expect.anything());
    expect(fromInsertMock).not.toHaveBeenCalledWith("competitions", expect.anything());
    // The client never sends a caller-supplied user id (creator is derived server-side).
    const rpcArgs = rpcMock.mock.calls[0][1];
    expect(rpcArgs).not.toHaveProperty("p_user_id");
    expect(rpcArgs).not.toHaveProperty("p_created_by");
    // Navigation only happens after the RPC returns a valid id.
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/competitions/comp-1"));
  });

  it("does not navigate or run follow-up mutations when the RPC fails (no orphan cleanup needed)", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "boom" },
    });
    await renderPage();
    await fillNameAndSubmit();

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/could not create competition/i) })
      )
    );
    expect(navigateMock).not.toHaveBeenCalled();
    expect(fromInsertMock).not.toHaveBeenCalledWith("clubs", expect.anything());
    expect(fromInsertMock).not.toHaveBeenCalledWith("user_roles", expect.anything());
    expect(fromInsertMock).not.toHaveBeenCalledWith("competitions", expect.anything());
  });

  it("does not navigate or claim success when the RPC returns a malformed response", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{}], error: null });
    await renderPage();
    await fillNameAndSubmit();

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/could not create competition/i) })
      )
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("navigates to the returned competition id on success", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ competition_id: "comp-xyz", club_id: "club-xyz" }],
      error: null,
    });
    await renderPage();
    await fillNameAndSubmit("My Cup");
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/competitions/comp-xyz"));
  });

  it("prevents duplicate submissions while a creation is in flight", async () => {
    let resolveRpc: (v: any) => void = () => {};
    rpcMock.mockImplementationOnce(
      () => new Promise((r) => { resolveRpc = r; })
    );
    await renderPage();
    await fillNameAndSubmit();

    // Wait for the first RPC to actually be in flight before firing more clicks.
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));

    const submit = screen.getByRole("button", { name: /create competition/i });
    fireEvent.click(submit);
    fireEvent.click(submit);
    // Give any spurious re-submissions a chance to happen.
    await new Promise((r) => setTimeout(r, 25));
    expect(rpcMock).toHaveBeenCalledTimes(1);

    resolveRpc({ data: [{ competition_id: "comp-1", club_id: "club-1" }], error: null });
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });
});
