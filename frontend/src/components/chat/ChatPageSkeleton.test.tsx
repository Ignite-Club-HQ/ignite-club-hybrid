import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatPageSkeleton } from "./ChatPageSkeleton";

describe("chat page skeleton header", () => {
  it("paints the remembered thread name instead of a placeholder bar", () => {
    render(<ChatPageSkeleton title="Riverside Rovers" subtitle="Club group" />);
    expect(screen.getByText("Riverside Rovers")).toBeInTheDocument();
    expect(screen.getByText("Club group")).toBeInTheDocument();
  });

  it("falls back to placeholder bars when the thread is still unknown", () => {
    const { container } = render(<ChatPageSkeleton />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    // No title text may leak into the unknown-thread state.
    expect(container.querySelector(".font-semibold")).toBeNull();
  });

  it("shows the person's initials instead of a grey circle once the name is known", () => {
    render(<ChatPageSkeleton title="Jane Parent" avatarType="dm" />);
    expect(screen.getByText("JP")).toBeInTheDocument();
  });

  it("keeps the message list as placeholders while the header is settled", () => {
    const { container } = render(<ChatPageSkeleton title="Jane Parent" avatarType="dm" bubbleCount={3} />);
    expect(screen.getByText("Jane Parent")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(3);
  });
});
