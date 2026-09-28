import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MiniLeagueJoinLinkCard } from "./MiniLeagueJoinLinkCard";
import { MINI_LEAGUE_PARENT_JOIN_LINK_COPY } from "./miniLeagueJoinLinkCardContract";

const commonProps = {
  miniLeagueName: "Summer League",
  fullUrl: "https://reference.invalid/join/p/token-123",
  copy: MINI_LEAGUE_PARENT_JOIN_LINK_COPY,
  isLoading: false,
  isError: false,
  isGenerating: false,
  isRegenerating: false,
  isRevoking: false,
  copied: false,
  showQR: false,
  onGenerate: vi.fn(),
  onRetry: vi.fn(),
  onShare: vi.fn(),
  onCopy: vi.fn(),
  onToggleQR: vi.fn(),
  onSaveQR: vi.fn(),
  onRegenerate: vi.fn(),
  onRevoke: vi.fn(),
};

describe("MiniLeagueJoinLinkCard", () => {
  it("renders role-specific empty state and forwards generation and retry actions", () => {
    render(
      <MiniLeagueJoinLinkCard
        {...commonProps}
        link={null}
        isError
      />,
    );

    expect(screen.getByText("Share a parent join link")).toBeInTheDocument();
    expect(screen.getByText(/add their child/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /generate parent join link/i }));
    fireEvent.click(screen.getByRole("button", { name: /tap to retry/i }));

    expect(commonProps.onGenerate).toHaveBeenCalledOnce();
    expect(commonProps.onRetry).toHaveBeenCalledOnce();
  });

  it("forwards link actions without owning role or authorization behavior", () => {
    render(
      <MiniLeagueJoinLinkCard
        {...commonProps}
        link={{ id: "invite-1", invite_token: "token-123" }}
        showQR
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy join link" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide QR" }));
    fireEvent.click(screen.getByRole("button", { name: "Download QR" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Regenerate" }));

    expect(commonProps.onShare).toHaveBeenCalledOnce();
    expect(commonProps.onCopy).toHaveBeenCalledOnce();
    expect(commonProps.onToggleQR).toHaveBeenCalledOnce();
    expect(commonProps.onSaveQR).toHaveBeenCalledOnce();
    expect(commonProps.onRevoke).toHaveBeenCalledOnce();
    expect(commonProps.onRegenerate).toHaveBeenCalledOnce();
  });
});
