import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmation = "REQUIRE ALL USERS TO REACCEPT";
const mocks = vi.hoisted(() => ({
  setting: {
    required: false,
    version: null as string | null,
    effective_at: null as string | null,
    summary: null as string | null,
  },
  fetchSetting: vi.fn(),
  rpc: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/useLegalReacceptance", () => ({
  LEGAL_REACCEPTANCE_CONFIRM_PHRASE: "REQUIRE ALL USERS TO REACCEPT",
  LEGAL_REACCEPTANCE_KEY: "legal_reacceptance",
  fetchLegalReacceptanceSetting: mocks.fetchSetting,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: mocks.rpc },
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import { LegalReacceptanceAdminCard } from "./LegalReacceptanceAdminCard";

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LegalReacceptanceAdminCard />
    </QueryClientProvider>,
  );
}

describe("LegalReacceptanceAdminCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setting = {
      required: false,
      version: null,
      effective_at: null,
      summary: null,
    };
    mocks.fetchSetting.mockImplementation(async () => mocks.setting);
    mocks.rpc.mockResolvedValue({ error: null });
  });

  it("shows that the global setting is off by default", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByText("Off — no users are being prompted")).toBeVisible());
    expect(screen.getByRole("switch", {
      name: "Require all users to re-accept Terms and Privacy Policy",
    })).not.toBeChecked();
  });

  it("cannot be enabled without a version and the exact confirmation phrase", async () => {
    renderCard();
    const toggle = await screen.findByRole("switch");
    fireEvent.click(toggle);
    const enable = screen.getByRole("button", { name: "Turn on" });
    expect(enable).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Version label (required)"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.change(screen.getByLabelText(new RegExp(confirmation)), {
      target: { value: "almost correct" },
    });
    expect(enable).toBeDisabled();

    fireEvent.change(screen.getByLabelText(new RegExp(confirmation)), {
      target: { value: confirmation },
    });
    expect(enable).toBeEnabled();
  });

  it("sends the exact guarded RPC payload when an app admin confirms activation", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("switch"));
    fireEvent.change(screen.getByLabelText("Version label (required)"), {
      target: { value: " 2026-08-01 " },
    });
    fireEvent.change(screen.getByLabelText("What changed (optional)"), {
      target: { value: " Updated terms and privacy wording " },
    });
    fireEvent.change(screen.getByLabelText(new RegExp(confirmation)), {
      target: { value: confirmation },
    });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith(
      "set_legal_reacceptance",
      {
        _required: true,
        _confirmation: confirmation,
        _version: "2026-08-01",
        _summary: "Updated terms and privacy wording",
      },
    ));
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Re-acceptance required for all users",
    });
  });
});
