import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  from: vi.fn(),
  row: null as { id: string; enabled: boolean; subject: string; message: string } | null,
  inserted: [] as any[],
  updated: [] as any[],
  toast: vi.fn(),
  getLiveTeamWelcomeEmail: vi.fn(),
  setLiveTeamWelcomeEmail: vi.fn(),
  getLiveCompetitionWelcomeEmail: vi.fn(),
  setLiveCompetitionWelcomeEmail: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, handlers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mocks.mode === "icp" ? handlers.icp({}) : handlers.supabase(),
}));
vi.mock("@/live/features/club", () => ({
  getLiveTeamWelcomeEmail: mocks.getLiveTeamWelcomeEmail,
  setLiveTeamWelcomeEmail: mocks.setLiveTeamWelcomeEmail,
}));
vi.mock("@/live/features/competitions", () => ({
  getLiveCompetitionWelcomeEmail: mocks.getLiveCompetitionWelcomeEmail,
  setLiveCompetitionWelcomeEmail: mocks.setLiveCompetitionWelcomeEmail,
}));

import { WelcomeEmailSettingsCard } from "./WelcomeEmailSettingsCard";

function renderCard(scopeKind: "team" | "competition" = "team") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WelcomeEmailSettingsCard scopeKind={scopeKind} scopeId="scope-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.from.mockClear();
  mocks.row = null;
  mocks.inserted = [];
  mocks.updated = [];
  mocks.toast.mockReset();
  mocks.getLiveTeamWelcomeEmail.mockReset();
  mocks.setLiveTeamWelcomeEmail.mockReset();
  mocks.getLiveCompetitionWelcomeEmail.mockReset();
  mocks.setLiveCompetitionWelcomeEmail.mockReset();
  mocks.from.mockImplementation(() => {
    const query: any = {};
    query.select = () => query;
    query.eq = () => query;
    query.maybeSingle = async () => ({ data: mocks.row, error: null });
    query.insert = async (row: any) => {
      mocks.inserted.push(row);
      return { error: null };
    };
    query.update = (row: any) => {
      mocks.updated.push(row);
      return query;
    };
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
    return query;
  });
});

describe("WelcomeEmailSettingsCard", () => {
  it.runIf(mocks.mode === "icp")("shows rejected competition writes without saving or falling back to Supabase", async () => {
    mocks.getLiveCompetitionWelcomeEmail.mockResolvedValue(null);
    mocks.setLiveCompetitionWelcomeEmail.mockRejectedValue(new Error("Competition management forbidden"));
    renderCard("competition");
    await screen.findByDisplayValue("Welcome to {{competitionName}}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ title: "Could not save settings", description: "Competition management forbidden", variant: "destructive" }));
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.runIf(mocks.mode === "supabase")("creates disabled-by-default team settings without storing recipient data", async () => {
    renderCard();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
    const subject = await screen.findByDisplayValue("Welcome to {{teamName}}");
    fireEvent.change(subject, { target: { value: "Welcome to {{teamName}}" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Welcome, {{recipientName}}" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.inserted).toEqual([{
      team_id: "scope-1",
      competition_id: null,
      enabled: false,
      subject: "Welcome to {{teamName}}",
      message: "Welcome, {{recipientName}}",
      updated_by: "admin-1",
    }]));
  });

  it.runIf(mocks.mode === "supabase")("loads and updates competition settings", async () => {
    mocks.row = { id: "setting-1", enabled: true, subject: "Ready for {{competitionName}}", message: "Welcome!" };
    renderCard("competition");
    expect(await screen.findByDisplayValue("Ready for {{competitionName}}")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "See you soon." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updated).toEqual([{
      team_id: null,
      competition_id: "scope-1",
      enabled: true,
      subject: "Ready for {{competitionName}}",
      message: "See you soon.",
      updated_by: "admin-1",
    }]));
  });

  it.runIf(mocks.mode === "icp")("saves team settings through the club canister without Supabase", async () => {
    mocks.getLiveTeamWelcomeEmail.mockResolvedValue(null);
    renderCard();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mocks.setLiveTeamWelcomeEmail).toHaveBeenCalledWith({}, "scope-1", {
      enabled: false,
      subject: "Welcome to {{teamName}}",
      message: "We're glad you're here.",
    }));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.runIf(mocks.mode === "icp")("loads and saves competition settings through the competition canister", async () => {
    mocks.getLiveCompetitionWelcomeEmail.mockResolvedValue({
      enabled: true,
      subject: "Ready for {{competitionName}}",
      message: "Welcome to the competition.",
    });
    renderCard("competition");

    expect(await screen.findByDisplayValue("Ready for {{competitionName}}"))
      .toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "See you on the pitch." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.setLiveCompetitionWelcomeEmail).toHaveBeenCalledWith(
      {},
      "scope-1",
      {
        enabled: true,
        subject: "Ready for {{competitionName}}",
        message: "See you on the pitch.",
      },
    ));
    expect(mocks.from).not.toHaveBeenCalled();
  });
});