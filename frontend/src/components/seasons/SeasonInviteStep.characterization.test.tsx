import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  invoke: vi.fn(),
  lookup: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastMessage: vi.fn(),
  inserts: [] as any[],
  updates: [] as any[],
  insertError: null as any,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, functions: { invoke: mocks.invoke } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/lib/inviteEmailDedupe", () => ({ lookupInvitableUserByEmail: mocks.lookup }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError, message: mocks.toastMessage } }));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  return {
    Select: ({ value, onValueChange, children, disabled }: any) => React.createElement("select", {
      value,
      disabled,
      onChange: (event: any) => onValueChange(event.target.value),
    }, children),
    SelectTrigger: ({ children }: any) => React.createElement(React.Fragment, null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: any) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ value, children }: any) => React.createElement("option", { value }, children),
  };
});

import { SeasonInviteStep } from "./SeasonInviteStep";

function queryFor(table: string) {
  const query: any = {};
  let inserted = false;
  for (const method of ["select", "eq", "is", "order", "maybeSingle"]) query[method] = vi.fn(() => query);
  query.insert = vi.fn((payload: any) => { inserted = true; mocks.inserts.push({ table, payload }); return query; });
  query.update = vi.fn((payload: any) => { mocks.updates.push({ table, payload }); return query; });
  Object.defineProperty(query, "then", {
    value: (resolve: any, reject: any) => {
      let result: any = { data: [], error: null };
      if (table === "clubs") result = { data: { name: "Synthetic Club", logo_url: null, contact_email: "club@example.test" }, error: null };
      if (table === "teams") result = { data: [{ id: "team-new", name: "U12 New" }], error: null };
      if (table === "pending_invites" && inserted) result = { data: null, error: mocks.insertError };
      return Promise.resolve(result).then(resolve, reject);
    },
  });
  return query;
}

function renderStep() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SeasonInviteStep clubId="club-1" targetSeasonId="season-new" seasonName="2027 Season" />
    </QueryClientProvider>,
  );
}

async function selectTargetTeam() {
  await screen.findByText("0 invites sent");
  const combos = screen.getAllByRole("combobox");
  await waitFor(() => expect(screen.getByRole("option", { name: "U12 New" })).toBeInTheDocument());
  fireEvent.change(combos[1], { target: { value: "team-new" } });
}

describe("SeasonInviteStep characterization", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts = [];
    mocks.updates = [];
    mocks.insertError = null;
    mocks.from.mockImplementation(queryFor);
    mocks.lookup.mockResolvedValue(null);
    mocks.invoke.mockResolvedValue({ data: { verified: true, success: true, emailId: "email-1" }, error: null });
  });

  it("requires a name or email before creating an invite", () => {
    renderStep();
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(mocks.toastError).toHaveBeenCalledWith("Add a name or email first");
    expect(mocks.inserts).toEqual([]);
  });

  it("creates a club-only invite when no team is selected", async () => {
    renderStep();
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "  New Person  " } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    expect(mocks.inserts[0]).toEqual({ table: "pending_invites", payload: expect.objectContaining({
      club_id: "club-1",
      team_id: null,
      role: "player",
      invited_by_user_id: "admin-1",
      invited_label: "New Person",
      invited_email: null,
    }) });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Invite link ready");
  });

  it("creates an exactly scoped team invite with a normalized email", async () => {
    renderStep();
    await selectTargetTeam();
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "New Player" } });
    fireEvent.change(screen.getByPlaceholderText("Email (optional)"), { target: { value: "  PLAYER@EXAMPLE.TEST  " } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(mocks.inserts).toHaveLength(1));
    expect(mocks.lookup).toHaveBeenCalledWith({ email: "PLAYER@EXAMPLE.TEST", clubId: "club-1", teamId: "team-new" });
    expect(mocks.inserts[0].payload).toEqual(expect.objectContaining({
      club_id: "club-1",
      team_id: "team-new",
      role: "player",
      invited_email: "player@example.test",
    }));
    expect(mocks.invoke).toHaveBeenCalledWith("send-email", expect.objectContaining({ body: expect.objectContaining({
      to: "PLAYER@EXAMPLE.TEST",
      subject: "You're invited to Synthetic Club for 2027 Season",
    }) }));
  });

  it("does not invite an existing club or team member", async () => {
    mocks.lookup.mockResolvedValue({ display_name: "Existing Person", already_in_club: true, already_in_team: false });
    renderStep();
    fireEvent.change(screen.getByPlaceholderText("Email (optional)"), { target: { value: "existing@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(await screen.findByText(/Existing Person is already a member/)).toBeInTheDocument();
    expect(mocks.inserts).toEqual([]);
  });

  it("reports an invite insert failure without showing success", async () => {
    mocks.insertError = { message: "invite denied" };
    renderStep();
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Rejected Person" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("invite denied"));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps a usable manual link when email delivery fails", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "provider unavailable" } });
    renderStep();
    fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "Manual Share" } });
    fireEvent.change(screen.getByPlaceholderText("Email (optional)"), { target: { value: "manual@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(await screen.findByText(/\/join\/p\//)).toBeInTheDocument();
    expect(mocks.updates).toContainEqual({ table: "pending_invites", payload: { email_error: "Email failed" } });
    expect(mocks.toastMessage).toHaveBeenCalledWith("Invite created — email failed", expect.anything());
    expect(screen.getByText("1 invite sent")).toBeInTheDocument();
  });
});
