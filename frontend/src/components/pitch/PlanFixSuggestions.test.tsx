import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlanFixSuggestions } from "./PlanFixSuggestions";
import type { PlanFix } from "./planner/planFixes";

const recommended: PlanFix = {
  id: "recommended",
  title: "Balance playing time",
  tradeoff: "May create an extra substitution.",
  apply: (current) => current,
};

const alternative: PlanFix = {
  id: "alternative",
  title: "Reduce short turns",
  tradeoff: "May widen the minutes spread.",
  apply: (current) => current,
};

describe("PlanFixSuggestions", () => {
  it("stays hidden in read-only mode", () => {
    render(
      <PlanFixSuggestions
        fixes={[recommended]}
        promoted={recommended}
        activeFixId={null}
        onApply={vi.fn()}
        readOnly
      />,
    );

    expect(screen.queryByText("Recommended priority")).not.toBeInTheDocument();
  });

  it("applies the promoted recommendation", () => {
    const onApply = vi.fn();
    render(
      <PlanFixSuggestions
        fixes={[recommended, alternative]}
        promoted={recommended}
        activeFixId={null}
        onApply={onApply}
        readOnly={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Use this priority/ }));
    expect(onApply).toHaveBeenCalledWith(recommended);
  });

  it("toggles and applies other priorities", () => {
    const onApply = vi.fn();
    render(
      <PlanFixSuggestions
        fixes={[recommended, alternative]}
        promoted={recommended}
        activeFixId={recommended.id}
        onApply={onApply}
        readOnly={false}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Try a different priority (1)" });
    expect(screen.queryByText(alternative.title)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /Reduce short turns/ }));
    expect(onApply).toHaveBeenCalledWith(alternative);
    fireEvent.click(toggle);
    expect(screen.queryByText(alternative.title)).not.toBeInTheDocument();
  });
});
