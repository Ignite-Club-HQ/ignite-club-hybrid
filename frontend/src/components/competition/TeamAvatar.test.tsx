import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamAvatar } from "./TeamAvatar";

describe("TeamAvatar", () => {
  it("renders a logo image when logoUrl is provided", () => {
    render(<TeamAvatar name="Riverside FC" logoUrl="https://example.com/logo.png" initials="RF" />);
    const img = screen.getByRole("img", { name: "Riverside FC" });
    expect(img).toHaveAttribute("src", "https://example.com/logo.png");
  });

  it("renders initials when no logoUrl is provided", () => {
    render(<TeamAvatar name="Riverside FC" initials="RF" />);
    expect(screen.getByText("RF")).toBeInTheDocument();
  });

  it("falls back to a question mark when initials are empty", () => {
    render(<TeamAvatar name="Unknown" initials="" />);
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("applies the requested size to the rendered element", () => {
    render(<TeamAvatar name="Riverside FC" initials="RF" size={48} />);
    const el = screen.getByText("RF");
    expect(el).toHaveStyle({ width: "48px", height: "48px" });
  });
});
