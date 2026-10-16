import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IcpExportStateBackupPanel } from "./IcpExportStateBackupPanel";

vi.mock("@/live/targetRegistry", () => ({
  getActiveIcpTarget: () => ({ alias: "icp-public-mainnet", host: "https://icp-api.io", canisterIds: {} }),
}));
vi.mock("@/live/internetIdentityAuth", () => ({
  getCurrentInternetIdentity: vi.fn(),
}));

const exportState = vi.hoisted(() => vi.fn());
vi.mock("@/live/domains", async () => {
  const actual = await vi.importActual<typeof import("@/live/domains")>("@/live/domains");
  const connect = vi.fn(async () => ({ actor: { export_state: exportState } }));
  return {
    ...actual,
    connectLiveClubPointsDomain: connect,
    connectLiveCompetitionDomain: connect,
    connectLiveEventsDomain: connect,
    connectLiveMediaMetadata: connect,
    connectLiveMessagingDomain: connect,
  };
});

import { getCurrentInternetIdentity } from "@/live/internetIdentityAuth";

const mockIdentity = { getPrincipal: () => ({ toText: () => "aaaaa-aa", isAnonymous: () => false }) } as unknown;

afterEach(() => {
  vi.clearAllMocks();
});

function renderPanel() {
  return render(
    <MemoryRouter>
      <IcpExportStateBackupPanel />
    </MemoryRouter>,
  );
}

describe("IcpExportStateBackupPanel", () => {
  it("lists a download button for each of the five requested domains", () => {
    renderPanel();
    expect(screen.getByText("Club points domain")).toBeInTheDocument();
    expect(screen.getByText("Competition domain")).toBeInTheDocument();
    expect(screen.getByText("Events domain")).toBeInTheDocument();
    expect(screen.getByText("Media metadata")).toBeInTheDocument();
    expect(screen.getByText("Messaging domain")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /download export/i })).toHaveLength(5);
  });

  it("calls export_state on the connected actor and downloads BigInt-safe JSON on click", async () => {
    vi.mocked(getCurrentInternetIdentity).mockResolvedValue(mockIdentity as never);
    exportState.mockResolvedValue({ Ok: { count: 42n, label: "state" } });

    const createObjectURL = vi.fn(() => "blob:fake-url");
    const revokeObjectURL = vi.fn();
    (URL as unknown as { createObjectURL: typeof createObjectURL }).createObjectURL = createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof revokeObjectURL }).revokeObjectURL = revokeObjectURL;

    let capturedBlob: Blob | null = null;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === "a") {
        const origClick = el.click.bind(el);
        el.click = origClick;
      }
      return el;
    });
    createObjectURL.mockImplementation(((blob: Blob) => {
      capturedBlob = blob;
      return "blob:fake-url";
    }) as unknown as () => string);

    renderPanel();
    const buttons = screen.getAllByRole("button", { name: /download export/i });
    await userEvent.click(buttons[0]);

    await waitFor(() => expect(exportState).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));

    expect(capturedBlob).not.toBeNull();
    const text = await (capturedBlob as unknown as Blob).text();
    const parsed = JSON.parse(text);
    expect(parsed.Ok.count).toBe("42");
    expect(parsed.Ok.label).toBe("state");
  });

  it("surfaces an error toast path when no Internet Identity session is present", async () => {
    vi.mocked(getCurrentInternetIdentity).mockResolvedValue(null);
    renderPanel();
    const buttons = screen.getAllByRole("button", { name: /download export/i });
    await userEvent.click(buttons[0]);
    await waitFor(() => expect(exportState).not.toHaveBeenCalled());
  });
});
