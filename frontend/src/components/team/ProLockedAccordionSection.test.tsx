import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Accordion } from "@/components/ui/accordion";
import { CreditCard } from "lucide-react";
import { ProLockedAccordionSection } from "./ProLockedAccordionSection";

function renderSection(props: Partial<React.ComponentProps<typeof ProLockedAccordionSection>> = {}) {
  render(
    <Accordion type="multiple" defaultValue={["section"]}>
      <ProLockedAccordionSection
        value="section"
        icon={CreditCard}
        title="Fee Payments"
        isLoading={false}
        isUnlocked={false}
        {...props}
      >
        <div>Unlocked content</div>
      </ProLockedAccordionSection>
    </Accordion>,
  );
}

describe("ProLockedAccordionSection", () => {
  it("shows a loading spinner while entitlement is resolving", () => {
    renderSection({ isLoading: true });
    expect(screen.getByText("Fee Payments")).toBeInTheDocument();
    expect(screen.queryByText("Unlocked content")).not.toBeInTheDocument();
    expect(screen.queryByText(/upgrade to pro/i)).not.toBeInTheDocument();
  });

  it("shows the upgrade message and lock badge when locked", () => {
    renderSection();
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Upgrade to Pro to access this feature.")).toBeInTheDocument();
    expect(screen.queryByText("Unlocked content")).not.toBeInTheDocument();
  });

  it("renders children and no lock badge when unlocked", () => {
    renderSection({ isUnlocked: true });
    expect(screen.getByText("Unlocked content")).toBeInTheDocument();
    expect(screen.queryByText("Pro")).not.toBeInTheDocument();
  });

  it("supports a custom lock badge label and upgrade message", () => {
    renderSection({ lockBadgeLabel: "Pro Football", upgradeMessage: "Upgrade to Pro Football to access this feature." });
    expect(screen.getByText("Pro Football")).toBeInTheDocument();
    expect(screen.getByText("Upgrade to Pro Football to access this feature.")).toBeInTheDocument();
  });
});
