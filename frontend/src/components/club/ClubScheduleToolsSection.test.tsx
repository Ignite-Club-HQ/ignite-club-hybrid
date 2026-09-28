import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { ClubScheduleToolsSection } from "./ClubScheduleToolsSection";

function renderSection(hasImportProAccess: boolean, onUpgradeClick = vi.fn()) {
  render(
    <MemoryRouter>
      <Accordion type="multiple" defaultValue={[]}>
        <ClubScheduleToolsSection hasImportProAccess={hasImportProAccess} onUpgradeClick={onUpgradeClick} />
      </Accordion>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("Schedule tools"));
  return { onUpgradeClick };
}

describe("ClubScheduleToolsSection", () => {
  it("renders an Import Fixtures link when the club has Pro access", () => {
    renderSection(true);
    expect(screen.getByText("From CSV or Excel")).toBeInTheDocument();
    expect(screen.getByText("Import Fixtures").closest("a")).toHaveAttribute("href", "/events/import");
    expect(screen.queryByText("Pro")).not.toBeInTheDocument();
  });

  it("renders a locked upgrade button when the club lacks Pro access", () => {
    renderSection(false);
    expect(screen.getByText("Available on Pro")).toBeInTheDocument();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Import Fixtures").closest("a")).toBeNull();
  });

  it("calls onUpgradeClick when the locked button is clicked", () => {
    const { onUpgradeClick } = renderSection(false);
    fireEvent.click(screen.getByRole("button", { name: /Import Fixtures/ }));
    expect(onUpgradeClick).toHaveBeenCalledTimes(1);
  });
});
