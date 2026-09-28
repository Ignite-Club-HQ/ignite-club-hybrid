import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { ClubEnrolmentsSection } from "./ClubEnrolmentsSection";

vi.mock("@/components/AdminEnrolmentManager", () => ({
  AdminEnrolmentManager: ({ clubId }: { clubId: string }) => <div>Enrolment manager for {clubId}</div>,
}));

function renderSection(onShareLink = vi.fn()) {
  render(
    <MemoryRouter>
      <Accordion type="multiple" defaultValue={[]}>
        <ClubEnrolmentsSection clubId="club-1" onShareLink={onShareLink} />
      </Accordion>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByText("Enrolments"));
  return { onShareLink };
}

describe("ClubEnrolmentsSection", () => {
  it("renders the AdminEnrolmentManager for the given club", () => {
    renderSection();
    expect(screen.getByText("Enrolment manager for club-1")).toBeInTheDocument();
  });

  it("links the View Page button to the club's enrolment page", () => {
    renderSection();
    expect(screen.getByText("View Page").closest("a")).toHaveAttribute("href", "/clubs/club-1/enrol");
  });

  it("calls onShareLink when the Share Link button is clicked", () => {
    const { onShareLink } = renderSection();
    fireEvent.click(screen.getByText("Share Link"));
    expect(onShareLink).toHaveBeenCalledTimes(1);
  });
});
