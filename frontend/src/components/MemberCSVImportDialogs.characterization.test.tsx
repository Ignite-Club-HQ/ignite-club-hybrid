import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.fn();
const downloadedTemplates: string[] = [];

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

import { MemberCSVImportDialog } from "./MemberCSVImportDialog";
import { MiniLeagueMemberCSVImportDialog } from "./MiniLeagueMemberCSVImportDialog";

function dialogFileInput(name: RegExp) {
  const dialog = screen.getByRole("dialog", { name });
  const input = dialog.querySelector<HTMLInputElement>('input[type="file"]');

  if (!input) {
    throw new Error("Expected the portaled CSV file input inside the dialog");
  }

  return input;
}

function csvFile(name: string, content: string) {
  return new File([content], name, { type: "text/csv" });
}

beforeEach(() => {
  toast.mockReset();
  downloadedTemplates.length = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:csv-template"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click() {
    downloadedTemplates.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("member CSV import dialog characterization", () => {
  it("keeps team-member row mapping and its template download contract", async () => {
    const onImport = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <MemberCSVImportDialog
        open
        onOpenChange={onOpenChange}
        defaultRole="player"
        onImport={onImport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download CSV Template" }));
    expect(downloadedTemplates).toEqual(["team_members_template.csv"]);

    fireEvent.change(
      dialogFileInput(/import members/i),
      {
        target: {
          files: [csvFile(
            "team-members.csv",
            "name,email,role,child1_name,child1_yob,child1_shirt\nJamie Doe,jamie@example.invalid,parent,Sam Doe,2016,7",
          )],
        },
      },
    );

    await waitFor(() => expect(screen.getByText("team-members.csv")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Send Invites (1)" }));

    expect(onImport).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "Jamie Doe",
        email: "jamie@example.invalid",
        role: "parent",
        children: [{ name: "Sam Doe", yearOfBirth: 2016, shirtNumber: 7 }],
      }),
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps team-member role validation separate from the preview presentation", async () => {
    render(
      <MemberCSVImportDialog
        open
        onOpenChange={vi.fn()}
        defaultRole="player"
        onImport={vi.fn()}
      />,
    );

    fireEvent.change(
      dialogFileInput(/import members/i),
      {
        target: {
          files: [csvFile(
            "invalid-team-members.csv",
            "name,email,role\nJamie Doe,jamie@example.invalid,guardian",
          )],
        },
      },
    );

    await waitFor(() =>
      expect(screen.getByText(/invalid role "guardian"/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("No valid members found")).toBeInTheDocument();
  });
});

describe("mini-league CSV import dialog characterization", () => {
  it("keeps mini-league player mapping and its template download contract", async () => {
    const onImport = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <MiniLeagueMemberCSVImportDialog
        open
        onOpenChange={onOpenChange}
        onImport={onImport}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download CSV Template" }));
    expect(downloadedTemplates).toEqual(["mini_league_players_template.csv"]);

    fireEvent.change(
      dialogFileInput(/import players/i),
      {
        target: {
          files: [csvFile(
            "mini-league-players.csv",
            "player_name,ability_rating,parent_name,parent_email\nAlex Player,4,Pat Parent,pat@example.invalid",
          )],
        },
      },
    );

    await waitFor(() => expect(screen.getByText("mini-league-players.csv")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add 1 player & send invites/i }));

    expect(onImport).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "Alex Player",
        abilityRating: "4",
        parentName: "Pat Parent",
        parentEmail: "pat@example.invalid",
      }),
    ]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps mini-league ability validation separate from the preview presentation", async () => {
    render(
      <MiniLeagueMemberCSVImportDialog
        open
        onOpenChange={vi.fn()}
        onImport={vi.fn()}
      />,
    );

    fireEvent.change(
      dialogFileInput(/import players/i),
      {
        target: {
          files: [csvFile(
            "invalid-mini-league-players.csv",
            "player_name,ability_rating,parent_name,parent_email\nAlex Player,6,Pat Parent,pat@example.invalid",
          )],
        },
      },
    );

    await waitFor(() =>
      expect(screen.getByText(/invalid ability rating "6"/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /add .* player/i })).not.toBeInTheDocument();
  });
});
