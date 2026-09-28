import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { ClubAdminNavigationSection } from "./ClubAdminNavigationSection";

function renderSection(props: Partial<ComponentProps<typeof ClubAdminNavigationSection>> = {}) {
  render(
    <MemoryRouter>
      <Accordion type="multiple" defaultValue={["admin"]}>
        <ClubAdminNavigationSection clubId="club-1" isAppAdmin={false} {...props} />
      </Accordion>
    </MemoryRouter>,
  );
}

describe("ClubAdminNavigationSection", () => {
  it("renders all administrator destinations for the current club", () => {
    renderSection();
    expect(screen.getByText("Manage Roles").closest("a")).toHaveAttribute("href", "/clubs/club-1/roles");
    expect(screen.getByText("Payment Settings").closest("a")).toHaveAttribute("href", "/clubs/club-1/stripe");
    expect(screen.getByText("Club Pro Plans").closest("a")).toHaveAttribute("href", "/clubs/club-1/upgrade");
    expect(screen.getByText("Engagement Analytics").closest("a")).toHaveAttribute("href", "/clubs/club-1/engagement");
  });

  it("shows the Pro entitlement state and app-admin analytics access correctly", () => {
    renderSection({ subscription: { is_pro: true, is_pro_football: true, plan: "annual" } });
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/Pro Football • Annual/)).toBeInTheDocument();
    expect(screen.queryByText("Pro", { selector: "span" })).not.toBeInTheDocument();
  });

  it("marks analytics as Pro-only for a free non-app administrator", () => {
    renderSection();
    expect(screen.getByText("Pro")).toBeInTheDocument();
  });
});
