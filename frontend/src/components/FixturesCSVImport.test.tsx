/**
 * Regression tests for multi-team fixture import authorization.
 *
 * Confirmed defect: a non-club-admin who manages several teams could upload a
 * CSV covering multiple teams — the UI showed "Multi-team import requires club
 * admin permissions" but the Import button stayed enabled and handleImport
 * inserted the events. Supabase RLS permits each row individually because the
 * user manages each team, so the restriction must be enforced in the frontend
 * workflow (blocking validation AND inside handleImport).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const insertMock = vi.fn();
const toastMock = vi.fn();

// Existing games lookup (duplicate detection) + insert path.
vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      lte: vi.fn(() => chain),
      insert: (rows: unknown) => insertMock(rows),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    return chain;
  };
  return { supabase: { from: vi.fn(() => builder()) } };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { FixturesCSVImport } from "./FixturesCSVImport";
import {
  validateFixtureImportAuthorization,
  MULTI_TEAM_AUTH_MESSAGE,
  NO_TEAM_SELECTED_MESSAGE,
  TEAM_MISMATCH_MESSAGE,
} from "@/lib/fixtureImportAuthorization";

const TEAMS = [
  { id: "team-a", name: "U10 Blue" },
  { id: "team-b", name: "U12 Red" },
];

const HEADER = "title,date,time,team,opponent";
const MULTI_TEAM_CSV = [
  HEADER,
  "Round 1,2099-03-15,10:00,U10 Blue,Eagles",
  "Round 2,2099-03-22,11:00,U12 Red,Tigers",
].join("\n");
const SINGLE_TEAM_CSV = [
  HEADER,
  "Round 1,2099-03-15,10:00,U10 Blue,Eagles",
  "Round 2,2099-03-22,11:00,U10 Blue,Tigers",
].join("\n");
const ESCAPE_CSV = [
  HEADER,
  "Round 1,2099-03-15,10:00,U12 Red,Eagles",
].join("\n");

function csvFile(content: string) {
  return new File([content], "fixtures.csv", { type: "text/csv" });
}

async function upload(container: HTMLElement, content: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [csvFile(content)] } });
  await waitFor(() => expect(screen.getByText("fixtures.csv")).toBeInTheDocument());
}

function importButton() {
  return screen
    .getAllByRole("button")
    .find((b) => /^Import \d+$/.test(b.textContent || "")) as HTMLButtonElement;
}

beforeEach(() => {
  insertMock.mockReset();
  insertMock.mockResolvedValue({ error: null });
  toastMock.mockReset();
});

describe("validateFixtureImportAuthorization", () => {
  it("club admin may import multiple teams", () => {
    expect(
      validateFixtureImportAuthorization({
        isClubAdmin: true,
        teamId: undefined,
        fixtures: [{ teamId: "team-a" }, { teamId: "team-b" }],
      }),
    ).toEqual({ ok: true });
  });

  it("non-admin multi-team is rejected", () => {
    expect(
      validateFixtureImportAuthorization({
        isClubAdmin: false,
        teamId: "team-a",
        fixtures: [{ teamId: "team-a" }, { teamId: "team-b" }],
      }),
    ).toEqual({ ok: false, message: MULTI_TEAM_AUTH_MESSAGE });
  });

  it("non-admin without a selected team is rejected", () => {
    expect(
      validateFixtureImportAuthorization({
        isClubAdmin: false,
        teamId: undefined,
        fixtures: [{ teamId: "team-a" }],
      }),
    ).toEqual({ ok: false, message: NO_TEAM_SELECTED_MESSAGE });
  });

  it("non-admin cannot escape the selected team", () => {
    expect(
      validateFixtureImportAuthorization({
        isClubAdmin: false,
        teamId: "team-a",
        fixtures: [{ teamId: "team-b" }],
      }),
    ).toEqual({ ok: false, message: TEAM_MISMATCH_MESSAGE });
  });

  it("non-admin single selected team is allowed", () => {
    expect(
      validateFixtureImportAuthorization({
        isClubAdmin: false,
        teamId: "team-a",
        fixtures: [{ teamId: "team-a" }, { teamId: "team-a" }],
      }),
    ).toEqual({ ok: true });
  });
});

describe("FixturesCSVImport authorization", () => {
  it("(1)(2)(3) non-admin multi-team CSV: error shown, button disabled, no insert", async () => {
    const { container } = render(
      <FixturesCSVImport
        clubId="club-1"
        teamId="team-a"
        teams={TEAMS}
        onImportComplete={vi.fn()}
        isClubAdmin={false}
        isProFootball={false}
      />,
    );
    await upload(container, MULTI_TEAM_CSV);

    // Row-level rejection of the escaping team keeps the import single-team,
    // and the blocking message is surfaced.
    await waitFor(() =>
      expect(
        screen.getByText(/club admin permissions required|club admin permissions/i),
      ).toBeInTheDocument(),
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("(4) calling the submission path cannot bypass authorization", async () => {
    const { container } = render(
      <FixturesCSVImport
        clubId="club-1"
        teams={TEAMS}
        onImportComplete={vi.fn()}
        isClubAdmin={false}
        isProFootball={false}
      />,
    );
    await upload(container, MULTI_TEAM_CSV);

    const btn = importButton();
    expect(btn).toBeDisabled();
    // Force the click anyway — handleImport must refuse.
    fireEvent.click(btn);
    await waitFor(() => expect(insertMock).not.toHaveBeenCalled());
  });

  it("(5) a non-admin cannot use the CSV team column to escape the selected team", async () => {
    const { container } = render(
      <FixturesCSVImport
        clubId="club-1"
        teamId="team-a"
        teams={TEAMS}
        onImportComplete={vi.fn()}
        isClubAdmin={false}
        isProFootball={false}
      />,
    );
    await upload(container, ESCAPE_CSV);

    await waitFor(() =>
      expect(screen.getByText(/does not match the selected team/i)).toBeInTheDocument(),
    );
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("(6) a valid non-admin single-team import still succeeds", async () => {
    const { container } = render(
      <FixturesCSVImport
        clubId="club-1"
        teamId="team-a"
        teams={TEAMS}
        onImportComplete={vi.fn()}
        isClubAdmin={false}
        isProFootball={false}
      />,
    );
    await upload(container, SINGLE_TEAM_CSV);

    const btn = importButton();
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    expect((insertMock.mock.calls[0][0] as any[]).every((e) => e.team_id === "team-a")).toBe(true);
  });

  it("(7) a valid club-admin multi-team import still succeeds", async () => {
    const { container } = render(
      <FixturesCSVImport
        clubId="club-1"
        teams={TEAMS}
        onImportComplete={vi.fn()}
        isClubAdmin
        isProFootball={false}
      />,
    );
    await upload(container, MULTI_TEAM_CSV);

    const btn = importButton();
    await waitFor(() => expect(btn).not.toBeDisabled());
    fireEvent.click(btn);
    await waitFor(() => expect(insertMock).toHaveBeenCalledTimes(1));
    const rows = insertMock.mock.calls[0][0] as any[];
    expect(new Set(rows.map((r) => r.team_id))).toEqual(new Set(["team-a", "team-b"]));
  });

  it("(9) failed inserts do not claim success or clear the preview", async () => {
    insertMock.mockResolvedValue({ error: { message: "boom" } });
    const onComplete = vi.fn();
    const { container } = render(
      <FixturesCSVImport
        clubId="club-1"
        teamId="team-a"
        teams={TEAMS}
        onImportComplete={onComplete}
        isClubAdmin={false}
        isProFootball={false}
      />,
    );
    await upload(container, SINGLE_TEAM_CSV);
    fireEvent.click(importButton());

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Import failed" }),
      ),
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByText("fixtures.csv")).toBeInTheDocument();
  });
});
