import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { ClubBrandingSection } from "./ClubBrandingSection";

vi.mock("@/components/ClubThemeEditor", () => ({
  ClubThemeEditor: ({ clubId, onSave }: { clubId: string; onSave?: () => void }) => (
    <div>
      Theme editor for {clubId}
      <button type="button" onClick={() => onSave?.()}>Save theme</button>
    </div>
  ),
}));

function renderSection(hasProAccess: boolean, onSaved = vi.fn()) {
  render(
    <Accordion type="multiple" defaultValue={[]}>
      <ClubBrandingSection clubId="club-1" hasProAccess={hasProAccess} onSaved={onSaved} />
    </Accordion>,
  );
  fireEvent.click(screen.getByText("Club Branding"));
  return { onSaved };
}

describe("ClubBrandingSection", () => {
  it("shows the Pro-activation notice and badge when the club lacks Pro access", () => {
    renderSection(false);
    expect(screen.getByText("Configure now, activates on Pro")).toBeInTheDocument();
    expect(screen.getByText(/will only be applied across the app once your club is on the/)).toBeInTheDocument();
  });

  it("hides the Pro-activation notice and badge when the club has Pro access", () => {
    renderSection(true);
    expect(screen.queryByText("Configure now, activates on Pro")).not.toBeInTheDocument();
    expect(screen.queryByText(/will only be applied across the app once your club is on the/)).not.toBeInTheDocument();
  });

  it("forwards clubId to the theme editor", () => {
    renderSection(true);
    expect(screen.getByText("Theme editor for club-1")).toBeInTheDocument();
  });

  it("calls onSaved when the theme editor saves", () => {
    const { onSaved } = renderSection(true);
    fireEvent.click(screen.getByText("Save theme"));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
