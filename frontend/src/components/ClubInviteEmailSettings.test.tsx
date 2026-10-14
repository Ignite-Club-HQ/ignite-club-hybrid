import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upserts: [] as Array<{ club_id: string; message: string }>,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown }) => providers.supabase(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const query: Record<string, any> = {};
      query.select = () => query;
      query.eq = () => query;
      query.maybeSingle = async () => ({
        data: table === "clubs"
          ? { id: "club-1", invite_email_style: "detailed" }
          : { message: "Saved for Supabase" },
        error: null,
      });
      query.upsert = (row: { club_id: string; message: string }) => {
        mocks.upserts.push(row);
        return Promise.resolve({ error: null });
      };
      query.update = () => query;
      return query;
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { ClubInviteEmailSettings } from "./ClubInviteEmailSettings";

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ClubInviteEmailSettings clubId="club-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.upserts = [];
  mocks.toastSuccess.mockReset();
  mocks.toastError.mockReset();
});

describe("ClubInviteEmailSettings default message", () => {
  it("loads and saves a Supabase default", async () => {
    renderSettings();
    const input = await screen.findByLabelText("Default invite message");
    expect(input).toHaveValue("Saved for Supabase");
    fireEvent.change(input, { target: { value: "New Supabase message" } });
    fireEvent.click(screen.getByRole("button", { name: "Save default" }));
    await waitFor(() => expect(mocks.upserts).toEqual([
      { club_id: "club-1", message: "New Supabase message" },
    ]));
  });

});