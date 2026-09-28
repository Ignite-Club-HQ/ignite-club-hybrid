import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { ClubSponsorsSection, type ClubSponsorToggleField } from "./ClubSponsorsSection";

vi.mock("@/components/SponsorsManager", () => ({
  SponsorsManager: ({ clubId }: { clubId: string }) => <div>Sponsors manager for {clubId}</div>,
}));

vi.mock("@/components/ClubTeamSponsorAllocator", () => ({
  ClubTeamSponsorAllocator: ({ clubId }: { clubId: string }) => <div>Team sponsor allocator for {clubId}</div>,
}));

const allToggles: Record<ClubSponsorToggleField, boolean> = {
  media_sponsors_enabled: false,
  media_header_sponsors_enabled: true,
  chat_thread_ads_enabled: false,
  events_sponsor_strip_enabled: true,
};

function renderSection(overrides: Partial<Parameters<typeof ClubSponsorsSection>[0]> = {}) {
  const onToggle = vi.fn();
  const onPrimaryChange = vi.fn();
  render(
    <Accordion type="multiple" defaultValue={[]}>
      <ClubSponsorsSection
        hasProAccess
        useIcpLab={false}
        toggleValues={allToggles}
        onToggle={onToggle}
        clubId="club-1"
        currentPrimarySponsorId={null}
        onPrimaryChange={onPrimaryChange}
        {...overrides}
      />
    </Accordion>,
  );
  fireEvent.click(screen.getByText("Sponsors"));
  return { onToggle, onPrimaryChange };
}

describe("ClubSponsorsSection", () => {
  it("shows the Pro-activation notice and badge when the club lacks Pro access", () => {
    renderSection({ hasProAccess: false });
    expect(screen.getByText("Configure now, activates on Pro")).toBeInTheDocument();
    expect(screen.getByText(/they'll appear across the app/)).toBeInTheDocument();
  });

  it("hides the Pro-activation notice when the club has Pro access", () => {
    renderSection();
    expect(screen.queryByText("Configure now, activates on Pro")).not.toBeInTheDocument();
  });

  it("renders all four sponsor toggles with their current values", () => {
    renderSection();
    expect(screen.getByText("Show sponsors in Media feed")).toBeInTheDocument();
    expect(screen.getByText("Show sponsor strip at top of Media")).toBeInTheDocument();
    expect(screen.getByText("Show sponsor strip in chat threads")).toBeInTheDocument();
    expect(screen.getByText("Show sponsor strip on Events")).toBeInTheDocument();
  });

  it("calls onToggle with the field name and new checked state", () => {
    const { onToggle } = renderSection();
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(onToggle).toHaveBeenCalledWith("media_sponsors_enabled", true);
  });

  it("disables the toggles fieldset when the club lacks Pro access", () => {
    renderSection({ hasProAccess: false });
    expect(screen.getAllByRole("switch")[0]).toBeDisabled();
  });

  it("disables the toggles fieldset in ICP lab mode", () => {
    renderSection({ useIcpLab: true });
    expect(screen.getAllByRole("switch")[0]).toBeDisabled();
  });

  it("shows the lab-unavailable message instead of the sponsor managers in ICP lab mode", () => {
    renderSection({ useIcpLab: true });
    expect(screen.getByText("Sponsor management is unavailable in ICP lab mode.")).toBeInTheDocument();
    expect(screen.queryByText("Sponsors manager for club-1")).not.toBeInTheDocument();
  });

  it("renders the sponsor managers when not in ICP lab mode", () => {
    renderSection();
    expect(screen.getByText("Sponsors manager for club-1")).toBeInTheDocument();
    expect(screen.getByText("Team sponsor allocator for club-1")).toBeInTheDocument();
  });
});
