import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: null as { id: string; enabled: boolean; subject: string; message: string } | null,
  inserted: [] as any[],
  updated: [] as any[],
  toast: vi.fn(),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
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
    },
  },
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
  mocks.row = null;
  mocks.inserted = [];
  mocks.updated = [];
  mocks.toast.mockReset();
});

describe("WelcomeEmailSettingsCard", () => {
  it("creates disabled-by-default team settings without storing recipient data", async () => {
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

  it("loads and updates competition settings", async () => {
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
});