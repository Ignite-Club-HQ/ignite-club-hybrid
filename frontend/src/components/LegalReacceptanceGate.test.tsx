import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mustAccept: false,
  setting: {
    required: false,
    version: null as string | null,
    effective_at: null as string | null,
    summary: null as string | null,
  },
  refresh: vi.fn(),
  rpc: vi.fn(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock("@/hooks/useLegalReacceptance", () => ({
  useLegalReacceptance: () => ({
    mustAccept: mocks.mustAccept,
    setting: mocks.setting,
    isLoading: false,
    refresh: mocks.refresh,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.successToast, error: mocks.errorToast },
}));

import { LegalReacceptanceGate } from "./LegalReacceptanceGate";

describe("LegalReacceptanceGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mustAccept = false;
    mocks.setting = {
      required: false,
      version: null,
      effective_at: null,
      summary: null,
    };
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it("renders nothing while reacceptance is off or already satisfied", () => {
    const { container } = render(<LegalReacceptanceGate />);
    expect(container).toBeEmptyDOMElement();
  });

  it("blocks the signed-in user and requires both documents plus explicit agreement", async () => {
    mocks.mustAccept = true;
    mocks.setting = {
      required: true,
      version: "2026-08-01",
      effective_at: "2026-08-01T00:00:00.000Z",
      summary: "Important legal changes",
    };
    render(<LegalReacceptanceGate />);

    expect(screen.getByRole("heading", { name: "Updated Terms & Privacy Policy" })).toBeVisible();
    expect(screen.getByText(/Important legal changes/)).toHaveTextContent("version 2026-08-01");
    const accept = screen.getByRole("button", { name: "Accept and continue" });
    expect(accept).toBeDisabled();

    fireEvent.click(screen.getByRole("link", { name: "Read Terms of Service" }));
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole("link", { name: "Read Privacy Policy" }));
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", {
      name: "I have read and accept the Terms of Service and Privacy Policy",
    }));
    expect(accept).toBeEnabled();

    fireEvent.click(accept);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("accept_current_legal_terms"));
    expect(mocks.successToast).toHaveBeenCalledWith("Thanks — your acceptance has been recorded.");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the gate active and shows friendly wording when acceptance cannot be saved", async () => {
    mocks.mustAccept = true;
    mocks.setting = {
      required: true,
      version: "2026-08-01",
      effective_at: "2026-08-01T00:00:00.000Z",
      summary: null,
    };
    mocks.rpc.mockResolvedValue({ error: { code: "42501", message: "technical permission detail" } });
    render(<LegalReacceptanceGate />);
    fireEvent.click(screen.getByRole("link", { name: "Read Terms of Service" }));
    fireEvent.click(screen.getByRole("link", { name: "Read Privacy Policy" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Accept and continue" }));

    await waitFor(() =>
      expect(mocks.errorToast).toHaveBeenCalledWith(
        "Couldn't record your acceptance. Please try again.",
      ),
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Updated Terms & Privacy Policy" })).toBeVisible();
  });
});
