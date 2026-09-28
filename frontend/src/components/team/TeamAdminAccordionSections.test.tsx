import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { TeamAdminAccordionSection, TeamAppAdminAccordionSection } from "./TeamAdminAccordionSections";

function renderAdminSection(overrides: Partial<React.ComponentProps<typeof TeamAdminAccordionSection>> = {}) {
  const queryClient = new QueryClient();
  const props: React.ComponentProps<typeof TeamAdminAccordionSection> = {
    teamId: "team-1",
    teamName: "U12 Blue",
    clubId: "club-1",
    teamType: "mixed",
    members: {},
    canManageCaptains: true,
    isTeamPro: false,
    hasProFootball: false,
    ...overrides,
  };
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Accordion type="multiple" defaultValue={["admin"]}>
          <TeamAdminAccordionSection {...props} />
        </Accordion>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return props;
}

describe("TeamAdminAccordionSection", () => {
  it("renders the admin quick actions and Pro-locked links", () => {
    renderAdminSection();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Attendance Stats")).toBeInTheDocument();
    expect(screen.getByText("Player Stats Reports")).toBeInTheDocument();
  });

  it("only shows the captain card for senior/mixed team types", () => {
    renderAdminSection({ teamType: "u10" });
    expect(screen.queryByText("Team Captain")).not.toBeInTheDocument();
  });
});

describe("TeamAppAdminAccordionSection", () => {
  it("renders the Pro override toggle and forwards changes", () => {
    const onProOverrideChange = vi.fn();
    const onProFootballOverrideChange = vi.fn();
    render(
      <Accordion type="multiple" defaultValue={["app-admin"]}>
        <TeamAppAdminAccordionSection
          isSoccerClub
          isProOverride={false}
          isProFootballOverride={false}
          onProOverrideChange={onProOverrideChange}
          onProFootballOverrideChange={onProFootballOverrideChange}
        />
      </Accordion>,
    );
    expect(screen.getByText("App Admin")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(onProOverrideChange).toHaveBeenCalledWith(true);
  });
});
