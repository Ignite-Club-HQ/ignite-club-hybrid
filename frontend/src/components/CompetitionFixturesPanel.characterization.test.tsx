import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  toast: vi.fn(),
  invalidateQueries: vi.fn(),
  matches: [] as any[],
  mutationError: null as any,
  selectedRows: [] as any[],
  operations: [] as Array<{ kind: string; table: string; payload?: any }>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/components/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value, onChange, placeholder }: any) => (
    <input aria-label={placeholder?.includes("address") ? "Venue" : "Venue"} value={value} onChange={e => onChange(e.target.value)} />
  ),
}));
vi.mock("@tanstack/react-query", async importOriginal => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: ({ queryKey }: any) => queryKey[0] === "competition-matches"
      ? { data: mocks.matches, isLoading: false }
      : { data: [], isLoading: false },
    useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  };
});

import { CompetitionFixturesPanel } from "./CompetitionFixturesPanel";

function queryFor(table: string) {
  const query: any = {};
  for (const method of ["eq", "gt", "is", "order", "limit"]) {
    query[method] = vi.fn(() => query);
  }
  query.select = vi.fn(() => {
    mocks.operations.push({ kind: "select", table });
    return query;
  });
  query.insert = vi.fn((payload: any) => {
    mocks.operations.push({ kind: "insert", table, payload });
    return query;
  });
  query.update = vi.fn((payload: any) => {
    mocks.operations.push({ kind: "update", table, payload });
    return query;
  });
  query.delete = vi.fn(() => {
    mocks.operations.push({ kind: "delete", table });
    return query;
  });
  Object.defineProperty(query, "then", {
    value: (resolve: any) => Promise.resolve({
      data: mocks.selectedRows,
      error: mocks.mutationError,
    }).then(resolve),
  });
  return query;
}

const acceptedEntries = ["Riverside", "Hilltown", "Lakeside"].map((name, index) => ({
  id: `entry-${index + 1}`,
  team_id: `team-${index + 1}`,
  division_id: null,
  status: "accepted",
  teams: { id: `team-${index + 1}`, name, logo_url: null },
}));

const fixture = {
  id: "match-1",
  competition_id: "competition-1",
  home_team_id: "team-1",
  away_team_id: "team-2",
  home: acceptedEntries[0].teams,
  away: acceptedEntries[1].teams,
  home_score: null,
  away_score: null,
  status: "scheduled",
  scheduled_at: "2026-08-01T09:00:00.000Z",
  round_number: 1,
  venue: "Riverside Park",
  pitch_number: "1",
  duration_minutes: 60,
  arrival_minutes_before: 20,
  notes: null,
  source: "manual",
  manually_overridden_at: null,
};

function renderPanel({
  isAdmin = true,
  source,
  entries = acceptedEntries,
  matches = [],
}: {
  isAdmin?: boolean;
  source?: string;
  entries?: any[];
  matches?: any[];
} = {}) {
  mocks.matches = matches;
  return render(
    <CompetitionFixturesPanel
      competitionId="competition-1"
      isAdmin={isAdmin}
      divisions={[]}
      entries={entries}
      source={source}
    />,
  );
}

async function openManage() {
  fireEvent.pointerDown(screen.getByRole("button", { name: /manage/i }), { button: 0, ctrlKey: false });
  await screen.findByText("Generate round-robin");
}

async function openGenerator() {
  await openManage();
  fireEvent.click(screen.getByText("Generate round-robin"));
  await screen.findByRole("button", { name: /preview fixtures/i });
}

async function previewWithVenue(venue = "Riverside Park") {
  await openGenerator();
  fireEvent.change(screen.getByLabelText("Venue"), { target: { value: venue } });
  fireEvent.click(screen.getByRole("button", { name: /preview fixtures/i }));
  await screen.findByText("Fixture preview");
}

describe("CompetitionFixturesPanel characterization — permissions and generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: { configurable: true, value: () => false },
      setPointerCapture: { configurable: true, value: () => undefined },
      releasePointerCapture: { configurable: true, value: () => undefined },
    });
    mocks.matches = [];
    mocks.mutationError = null;
    mocks.selectedRows = [];
    mocks.operations = [];
    mocks.from.mockImplementation((table: string) => queryFor(table));
  });

  it("hides every fixture-management entry point from a non-admin", () => {
    renderPanel({ isAdmin: false });
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Generate round-robin")).not.toBeInTheDocument();
    expect(screen.queryByText("Add match")).not.toBeInTheDocument();
  });

  it("hides local fixture management for a PlayHQ-managed competition", () => {
    renderPanel({ source: "playhq" });
    expect(screen.queryByRole("button", { name: /manage/i })).not.toBeInTheDocument();
  });

  it("disables generation until at least two entries are accepted", async () => {
    renderPanel({ entries: acceptedEntries.slice(0, 1) });
    expect(screen.getByText(/add at least 2 accepted teams/i)).toBeInTheDocument();
    await openManage();
    expect(screen.getByText("Generate round-robin")).toHaveAttribute("data-disabled");
  });

  it("rejects a preview without a venue and performs no database write", async () => {
    renderPanel();
    await openGenerator();
    fireEvent.click(screen.getByRole("button", { name: /preview fixtures/i }));
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Venue is required", variant: "destructive" });
    expect(mocks.operations).toEqual([]);
  });

  it("previews every unique pairing for three accepted teams", async () => {
    renderPanel();
    await previewWithVenue();
    expect(screen.getByText("3 matches")).toBeInTheDocument();
    expect(screen.getAllByText(/vs/i)).toHaveLength(3);
  });

  it("saves the exact generated fixture contract in one bulk insert", async () => {
    renderPanel();
    await previewWithVenue();
    fireEvent.click(screen.getByRole("button", { name: /save fixtures/i }));

    await waitFor(() => expect(mocks.operations.some(op => op.kind === "insert")).toBe(true));
    const insert = mocks.operations.find(op => op.kind === "insert")!;
    expect(insert.table).toBe("competition_matches");
    expect(insert.payload).toHaveLength(3);
    expect(insert.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({
        competition_id: "competition-1",
        status: "scheduled",
        created_by: "admin-1",
        venue: "Riverside Park",
      }),
    ]));
    const pairs = insert.payload.map((row: any) => [row.home_team_id, row.away_team_id].sort().join("-"));
    expect(new Set(pairs).size).toBe(3);
  });

  it("closes and refreshes fixtures exactly once after successful generation", async () => {
    renderPanel();
    await previewWithVenue();
    fireEvent.click(screen.getByRole("button", { name: /save fixtures/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: /manage/i })).toBeInTheDocument());
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["competition-matches", "competition-1"] });
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Saved 3 fixtures" });
  });

  it("prevents repeated save taps from inserting generated fixtures twice", async () => {
    renderPanel();
    await previewWithVenue();
    const save = screen.getByRole("button", { name: /save fixtures/i });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(mocks.operations.filter(op => op.kind === "insert")).toHaveLength(1));
  });

  it.each([
    ["duplicate key", /already exist/i],
    ["row-level security denied", /don't have permission/i],
    ["network fetch failed", /couldn't reach the server/i],
    ["unexpected database failure", /something went wrong/i],
  ])("maps a rejected generation safely: %s", async (message, expectedDescription) => {
    mocks.mutationError = { message };
    renderPanel();
    await previewWithVenue();
    fireEvent.click(screen.getByRole("button", { name: /save fixtures/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't save fixtures",
      description: expect.stringMatching(expectedDescription),
      variant: "destructive",
    })));
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
    expect(screen.getByText("Fixture preview")).toBeInTheDocument();
  });
});

describe("CompetitionFixturesPanel characterization — existing fixture actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mutationError = null;
    mocks.selectedRows = [];
    mocks.operations = [];
    mocks.from.mockImplementation((table: string) => queryFor(table));
  });

  async function openFixtureSettings() {
    fireEvent.pointerDown(screen.getByRole("button", { name: /fixture settings/i }), { button: 0, ctrlKey: false });
    await screen.findByText("Edit details");
  }

  it("cancels fixture deletion without issuing a delete", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel({ matches: [fixture] });
    await openFixtureSettings();
    fireEvent.click(screen.getByText("Delete"));
    expect(mocks.operations.filter(op => op.kind === "delete")).toHaveLength(0);
  });

  it("deletes a confirmed fixture and refreshes fixtures and ladder", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel({ matches: [fixture] });
    await openFixtureSettings();
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(mocks.operations.filter(op => op.kind === "delete")).toHaveLength(1));
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["competition-matches", "competition-1"] });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["competition-ladder", "competition-1"] });
  });

  it("reports a rejected deletion and leaves successful caches untouched", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.mutationError = { message: "delete denied" };
    renderPanel({ matches: [fixture] });
    await openFixtureSettings();
    fireEvent.click(screen.getByText("Delete"));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not delete",
      description: "delete denied",
      variant: "destructive",
    }));
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("rejects an edit with an empty venue before updating", async () => {
    renderPanel({ matches: [fixture] });
    await openFixtureSettings();
    fireEvent.click(screen.getByText("Edit details"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Venue"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Venue is required", variant: "destructive" });
    expect(mocks.operations.filter(op => op.kind === "update")).toHaveLength(0);
  });

  it("keeps the edit dialog open and avoids invalidation when update is rejected", async () => {
    mocks.mutationError = { message: "update denied" };
    renderPanel({ matches: [fixture] });
    await openFixtureSettings();
    fireEvent.click(screen.getByText("Edit details"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Could not update match",
      description: "update denied",
      variant: "destructive",
    }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("trims later rounds and refreshes fixtures only after the delete succeeds", async () => {
    renderPanel({ matches: [fixture, { ...fixture, id: "match-3", round_number: 3 }] });
    fireEvent.click(screen.getByRole("button", { name: /set max/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /trim to 1 rounds/i }));

    await waitFor(() => expect(mocks.operations.filter(op => op.kind === "delete")).toHaveLength(1));
    expect(mocks.invalidateQueries).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["competition-matches", "competition-1"],
    });
  });

  it("keeps a rejected round trim retryable without invalidating fixtures", async () => {
    mocks.mutationError = { message: "trim denied" };
    renderPanel({ matches: [fixture, { ...fixture, id: "match-3", round_number: 3 }] });
    fireEvent.click(screen.getByRole("button", { name: /set max/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("spinbutton"), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /trim to 1 rounds/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Couldn't update",
      description: "trim denied",
      variant: "destructive",
    }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });
});

describe("CompetitionFixturesPanel characterization — manual and finals creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: { configurable: true, value: () => false },
      setPointerCapture: { configurable: true, value: () => undefined },
      releasePointerCapture: { configurable: true, value: () => undefined },
    });
    mocks.matches = [];
    mocks.mutationError = null;
    mocks.selectedRows = [];
    mocks.operations = [];
    mocks.from.mockImplementation((table: string) => queryFor(table));
  });

  async function chooseManagementAction(name: string) {
    await openManage();
    fireEvent.click(screen.getByText(name));
  }

  it("rejects a manual match until two different teams are selected", async () => {
    renderPanel();
    await chooseManagementAction("Add match");
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /^save match$/i }));

    expect(mocks.toast).toHaveBeenCalledWith({ title: "Pick two different teams", variant: "destructive" });
    expect(mocks.operations.filter(op => op.kind === "insert")).toHaveLength(0);
  });

  it("prevents repeated manual-match save taps from inserting twice", async () => {
    renderPanel();
    await chooseManagementAction("Add match");
    const sheet = await screen.findByRole("dialog");
    const selectPlaceholders = within(sheet).getAllByText("Select team");

    fireEvent.click(selectPlaceholders[0].closest("button")!);
    fireEvent.click(await screen.findByRole("option", { name: "Riverside" }));
    fireEvent.click(within(sheet).getAllByText("Select team")[0].closest("button")!);
    fireEvent.click(await screen.findByRole("option", { name: "Hilltown" }));
    const updatedSheet = await screen.findByRole("dialog");
    fireEvent.change(updatedSheet.querySelector<HTMLInputElement>('input[type="date"]')!, {
      target: { value: "2026-09-12" },
    });
    fireEvent.change(within(updatedSheet).getByLabelText("Venue"), { target: { value: "Riverside Park" } });

    const save = within(updatedSheet).getByRole("button", { name: /^save match$/i });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(mocks.operations.filter(op => op.kind === "insert")).toHaveLength(1));
  });

  it("rejects a finals round without a date before querying or inserting", async () => {
    renderPanel();
    await chooseManagementAction("Add finals round");
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^add finals$/i }));

    expect(mocks.toast).toHaveBeenCalledWith({ title: "Pick a finals date", variant: "destructive" });
    expect(mocks.operations).toEqual([]);
  });

  it("rejects a finals round without a venue before querying or inserting", async () => {
    renderPanel();
    await chooseManagementAction("Add finals round");
    const dialog = await screen.findByRole("dialog");
    const date = dialog.querySelector<HTMLInputElement>('input[type="date"]');
    expect(date).not.toBeNull();
    fireEvent.change(date!, { target: { value: "2026-09-12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^add finals$/i }));

    expect(mocks.toast).toHaveBeenCalledWith({ title: "Venue is required", variant: "destructive" });
    expect(mocks.operations).toEqual([]);
  });

  it("creates a grand-final placeholder with the next round and refreshes fixtures", async () => {
    mocks.selectedRows = [{ round_number: 4 }];
    renderPanel();
    await chooseManagementAction("Add finals round");
    const dialog = await screen.findByRole("dialog");
    const date = dialog.querySelector<HTMLInputElement>('input[type="date"]');
    fireEvent.change(date!, { target: { value: "2026-09-12" } });
    fireEvent.change(within(dialog).getByLabelText("Venue"), { target: { value: "Riverside Park" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^add finals$/i }));

    await waitFor(() => expect(mocks.operations.some(op => op.kind === "insert")).toBe(true));
    const insert = mocks.operations.find(op => op.kind === "insert")!;
    expect(insert.table).toBe("competition_matches");
    expect(insert.payload).toEqual([
      expect.objectContaining({
        competition_id: "competition-1",
        division_id: null,
        round_number: 5,
        home_team_id: null,
        away_team_id: null,
        status: "scheduled",
        created_by: "admin-1",
        venue: "Riverside Park",
        scheduled_at: "2026-09-12T09:00:00.000Z",
        pitch_number: "1",
        duration_minutes: 60,
        notes: "Grand Final · 1 v 2",
      }),
    ]);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["competition-matches", "competition-1"] });
  });

  it("does not create a round-one final when next-round discovery fails", async () => {
    mocks.mutationError = { message: "round lookup denied" };
    renderPanel();
    await chooseManagementAction("Add finals round");
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector<HTMLInputElement>('input[type="date"]')!, {
      target: { value: "2026-09-12" },
    });
    fireEvent.change(within(dialog).getByLabelText("Venue"), { target: { value: "Riverside Park" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^add finals$/i }));

    await waitFor(() => expect(mocks.operations.some(op => op.kind === "select")).toBe(true));
    expect(mocks.operations.filter(op => op.kind === "insert")).toHaveLength(0);
    expect(mocks.invalidateQueries).not.toHaveBeenCalled();
  });

  it("prevents repeated finals save taps from inserting the round twice", async () => {
    mocks.selectedRows = [{ round_number: 4 }];
    renderPanel();
    await chooseManagementAction("Add finals round");
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector<HTMLInputElement>('input[type="date"]')!, {
      target: { value: "2026-09-12" },
    });
    fireEvent.change(within(dialog).getByLabelText("Venue"), { target: { value: "Riverside Park" } });
    const save = within(dialog).getByRole("button", { name: /^add finals$/i });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(mocks.operations.filter(op => op.kind === "insert")).toHaveLength(1));
  });
});
