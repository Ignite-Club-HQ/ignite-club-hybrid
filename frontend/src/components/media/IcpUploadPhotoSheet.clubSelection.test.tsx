import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const client = new QueryClient();
const Wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const state = vi.hoisted(() => ({ club: null as string | null }));
vi.mock("@/hooks/useClubTheme", () => ({ useClubTheme: () => ({ activeClubFilter: state.club }) }));
vi.mock("@/live/internetIdentityAuth", () => ({ getCurrentInternetIdentity: async () => null }));
vi.mock("@/live/features/media", () => ({ registerLiveAsset: vi.fn(), setLiveAssetScope: vi.fn() }));
vi.mock("@/live/mediaUpload", () => ({ tryUploadMediaToBlobStore: vi.fn() }));
import { IcpUploadPhotoSheet } from "./IcpUploadPhotoSheet";

describe("Gallery creation follows the theme club", () => {
  const props = {
    open: true, onOpenChange: vi.fn(), onUploaded: vi.fn(),
    clubs: [{ id: "goat", name: "Giddy Goat" }, { id: "cats", name: "Winter Cats" }],
    teams: [{ id: "goat-u9", name: "Goat U9", club_id: "goat" }, { id: "cats-u10", name: "Cats U10", club_id: "cats" }],
    miniLeagues: [], competitions: [], defaultClubId: "cats",
  };
  beforeEach(() => { state.club = null; });
  it("preselects only the theme club despite another default and restricts its teams", async () => {
    state.club = "goat";
    render(<IcpUploadPhotoSheet {...props} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByRole("button", { name: "Goat U9" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: /Winter Cats/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cats U10" })).not.toBeInTheDocument();
  });
  it("clears old team choices when switching the theme club and restores club choices when cleared", async () => {
    const { rerender } = render(<IcpUploadPhotoSheet {...props} />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByRole("button", { name: "Cats U10" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cats U10" }));
    state.club = "goat";
    rerender(<IcpUploadPhotoSheet {...props} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Goat U9" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Cats U10" })).not.toBeInTheDocument();
    state.club = null;
    rerender(<IcpUploadPhotoSheet {...props} />);
    expect(screen.getByRole("button", { name: /Winter Cats/ })).toBeEnabled();
  });
});