import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  awardPoints: vi.fn(),
  auth: { user: { id: "parent-1" } as null | { id: string } },
  results: new Map<string, any[]>(),
  queries: [] as Array<{ table: string; chain: any }>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/lib/earlyRsvpPoints", () => ({ awardEarlyRsvpPoints: mocks.awardPoints }));
vi.mock("@/components/ui/responsive-dialog", () => ({
  ResponsiveDialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  ResponsiveDialogContent: ({ children }: any) => <div>{children}</div>,
  ResponsiveDialogHeader: ({ children }: any) => <div>{children}</div>,
  ResponsiveDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  ResponsiveDialogDescription: ({ children }: any) => <p>{children}</p>,
}));

import { QuickRSVPDialog } from "./QuickRSVPDialog";

function queueResult(table: string, ...results: any[]) {
  mocks.results.set(table, results.map(result => ({ error: null, ...result })));
}

function tableQuery(table: string) {
  const result = mocks.results.get(table)?.shift() ?? { data: [], error: null };
  const chain: any = {};
  for (const method of ["select", "eq", "in", "update", "insert"]) chain[method] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  Object.defineProperty(chain, "then", {
    value: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  });
  mocks.queries.push({ table, chain });
  return chain;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  eventId: "event-1",
  eventTitle: "Saturday Social",
  eventDate: "2030-07-20T10:00:00Z",
  eventType: "social",
  teamId: "team-1" as string | null,
  suburb: "Riverside",
  opponent: null as string | null,
  clubId: "club-1",
  clubName: "Test Club",
};

function defaultResults(audience = "players_and_parents") {
  queueResult("events", { data: {
    team_id: "team-1",
    club_id: "club-1",
    target_team_ids: null,
    rsvp_audience: audience,
    adults_only: false,
    restricted_to_roles: null,
  } });
  queueResult("teams", { data: { default_rsvp_audience: null } });
  queueResult("children", { data: [] });
  queueResult("child_guardians", { data: [] });
  queueResult("rsvps", { data: [] });
}

function renderDialog(overrides: Partial<typeof baseProps & { eventAmount: number | null }> = {}) {
  return render(<QuickRSVPDialog {...baseProps} {...overrides} />, { wrapper });
}

describe("QuickRSVPDialog business behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.results.clear();
    mocks.queries.length = 0;
    mocks.auth.user = { id: "parent-1" };
    mocks.from.mockImplementation(tableQuery);
    mocks.awardPoints.mockResolvedValue(false);
    baseProps.onOpenChange = vi.fn();
  });

  it("does not query while the dialog is closed", async () => {
    renderDialog({ open: false });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("uses an event audience override to show players but hide the parent response", async () => {
    defaultResults("players_only");
    queueResult("children", { data: [{ id: "child-1", name: "Ava" }] });
    queueResult("child_team_assignments", { data: [{ child_id: "child-1" }] });
    renderDialog();

    expect(await screen.findByText("Ava")).toBeInTheDocument();
    expect(screen.queryByText("Your Response")).not.toBeInTheDocument();
    expect(screen.getByText("Children's Response")).toBeInTheDocument();
  });

  it("uses a parents-only audience to hide child response controls", async () => {
    defaultResults("parents_only");
    queueResult("children", { data: [{ id: "child-1", name: "Ava" }] });
    renderDialog();

    expect(await screen.findByText("Your Response")).toBeInTheDocument();
    expect(screen.queryByText("Children's Response")).not.toBeInTheDocument();
    expect(screen.queryByText("Ava")).not.toBeInTheDocument();
  });

  it("falls back to the team audience when the event has no override", async () => {
    queueResult("events", { data: {
      team_id: "team-1",
      club_id: "club-1",
      target_team_ids: null,
      rsvp_audience: null,
      adults_only: false,
      restricted_to_roles: null,
    } });
    queueResult("teams", { data: { default_rsvp_audience: "players_only" } });
    queueResult("children", { data: [{ id: "child-1", name: "Ava" }] });
    queueResult("child_guardians", { data: [] });
    queueResult("child_team_assignments", { data: [{ child_id: "child-1" }] });
    queueResult("rsvps", { data: [] });
    renderDialog();

    expect(await screen.findByText("Ava")).toBeInTheDocument();
    expect(screen.queryByText("Your Response")).not.toBeInTheDocument();
  });

  it("inserts a new parent RSVP with exact ownership and invalidates all RSVP consumers", async () => {
    defaultResults();
    queueResult("rsvps", { data: [] }, { data: [] }, { data: { id: "rsvp-1" } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}><QuickRSVPDialog {...baseProps} /></QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Going/i }));

    await waitFor(() => {
      const insert = mocks.queries.filter(q => q.table === "rsvps").find(q => q.chain.insert.mock.calls.length)?.chain;
      expect(insert?.insert).toHaveBeenCalledWith({ event_id: "event-1", user_id: "parent-1", status: "going" });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event-rsvps", "event-1"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["rsvp-summary", "event-1"] });
  });

  it("updates an existing parent RSVP instead of inserting a duplicate", async () => {
    defaultResults();
    queueResult("rsvps",
      { data: [{ id: "rsvp-self", status: "maybe", child_id: null }] },
      { data: [{ id: "rsvp-self", status: "maybe", child_id: null }] },
      { data: null },
    );
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /Can't Go/i }));

    await waitFor(() => {
      const mutation = mocks.queries.filter(q => q.table === "rsvps").find(q => q.chain.update.mock.calls.length)?.chain;
      expect(mutation.update).toHaveBeenCalledWith({ status: "not_going" });
      expect(mutation.eq).toHaveBeenCalledWith("id", "rsvp-self");
    });
    expect(mocks.queries.some(q => q.chain.insert.mock.calls.length > 0)).toBe(false);
  });

  it("deduplicates a child linked both directly and through a guardian relationship", async () => {
    defaultResults("players_only");
    queueResult("children", { data: [{ id: "child-1", name: "Ava" }] });
    queueResult("child_guardians", { data: [{ child_id: "child-1", children: { id: "child-1", name: "Ava" } }] });
    queueResult("child_team_assignments", { data: [{ child_id: "child-1" }] });
    renderDialog();

    expect(await screen.findAllByText("Ava")).toHaveLength(1);
  });

  it("filters guardian-linked children to the selected team", async () => {
    defaultResults("players_only");
    queueResult("child_guardians", { data: [
      { child_id: "child-1", children: { id: "child-1", name: "Ava" } },
      { child_id: "child-2", children: { id: "child-2", name: "Blair" } },
    ] });
    queueResult("child_team_assignments", { data: [{ child_id: "child-2" }] });
    renderDialog();

    expect(await screen.findByText("Blair")).toBeInTheDocument();
    expect(screen.queryByText("Ava")).not.toBeInTheDocument();
    const assignment = mocks.queries.find(q => q.table === "child_team_assignments")!.chain;
    expect(assignment.in).toHaveBeenCalledWith("team_id", ["team-1"]);
    expect(assignment.in).toHaveBeenCalledWith("child_id", ["child-1", "child-2"]);
  });

  it("a guardian RSVP is written against the exact assigned canonical child", async () => {
    defaultResults("players_only");
    queueResult("child_guardians", { data: [
      { child_id: "canonical-child", children: { id: "canonical-child", name: "Ava" } },
      { child_id: "wrong-child", children: { id: "wrong-child", name: "Ava duplicate" } },
    ] });
    queueResult("child_team_assignments", { data: [{ child_id: "canonical-child" }] });
    queueResult("rsvps", { data: [] }, { data: [] }, { data: { id: "child-rsvp-1" } });
    renderDialog();

    const childBlock = (await screen.findByText("Ava")).parentElement!;
    fireEvent.click(within(childBlock).getByRole("button", { name: /Going/i }));

    await waitFor(() => {
      const insert = mocks.queries
        .filter(q => q.table === "rsvps")
        .find(q => q.chain.insert.mock.calls.length)?.chain;
      expect(insert?.insert).toHaveBeenCalledWith({
        event_id: "event-1",
        user_id: "parent-1",
        child_id: "canonical-child",
        status: "going",
      });
    });
    expect(screen.queryByText("Ava duplicate")).not.toBeInTheDocument();
  });

  it("updates an existing child RSVP regardless of which guardian created it", async () => {
    defaultResults("players_only");
    queueResult("children", { data: [{ id: "child-1", name: "Ava" }] });
    queueResult("child_team_assignments", { data: [{ child_id: "child-1" }] });
    queueResult("rsvps",
      { data: [] },
      { data: [] },
      { data: [{ id: "child-rsvp", status: "maybe", child_id: "child-1", user_id: "other-parent" }] },
      { data: null },
    );
    renderDialog();
    const childBlock = (await screen.findByText("Ava")).parentElement!;
    fireEvent.click(within(childBlock).getByRole("button", { name: /Going/i }));

    await waitFor(() => {
      const mutation = mocks.queries.filter(q => q.table === "rsvps").find(q => q.chain.update.mock.calls.length)?.chain;
      expect(mutation.update).toHaveBeenCalledWith({ status: "going" });
      expect(mutation.eq).toHaveBeenCalledWith("id", "child-rsvp");
    });
  });

  it("surfaces a mutation denial and does not award points", async () => {
    defaultResults();
    queueResult("rsvps", { data: [] }, { data: [] }, { data: null, error: { message: "RSVP denied" } });
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: /Going/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Error", description: "RSVP denied", variant: "destructive",
    }));
    expect(mocks.awardPoints).not.toHaveBeenCalled();
  });

  it("shows payment only after a successful going response to a paid social event", async () => {
    defaultResults();
    queueResult("rsvps", { data: [] }, { data: [] }, { data: { id: "rsvp-1" } });
    renderDialog({ eventAmount: 12.5 });
    expect(screen.queryByText("Payment Required")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /Going/i }));

    expect(await screen.findByText("Payment Required")).toBeInTheDocument();
    expect(screen.getByText("$12.50 per person")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Go to Event to Pay/i }));
    expect(baseProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.navigate).toHaveBeenCalledWith("/events/event-1");
  });

  it("does not show payment for a paid non-social event", async () => {
    defaultResults();
    queueResult("rsvps", { data: [] }, { data: [] }, { data: { id: "rsvp-1" } });
    renderDialog({ eventAmount: 12.5, eventType: "training" });
    fireEvent.click(await screen.findByRole("button", { name: /Going/i }));

    await waitFor(() => expect(mocks.awardPoints).toHaveBeenCalled());
    expect(screen.queryByText("Payment Required")).not.toBeInTheDocument();
  });
});
