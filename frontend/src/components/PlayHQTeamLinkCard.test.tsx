import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  clubResult: Promise.resolve({ data: null, error: null }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mocks.from,
    functions: { invoke: vi.fn() },
  },
}));

import { PlayHQTeamLinkCard } from "./PlayHQTeamLinkCard";

function queryResult(table: string) {
  if (table === "clubs") return mocks.clubResult;
  if (table === "teams") {
    return Promise.resolve({
      data: {
        playhq_team_id: null,
        playhq_competition_id: null,
        playhq_auto_create_events: false,
      },
      error: null,
    });
  }
  return Promise.resolve({ data: [], error: null });
}

function queryFor(table: string) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "single", "maybeSingle", "update"]) {
    query[method] = vi.fn(() => query);
  }
  Object.defineProperty(query, "then", {
    value: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
      queryResult(table).then(resolve, reject),
  });
  return query;
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PlayHQTeamLinkCard teamId="team-1" clubId="club-1" />
    </QueryClientProvider>,
  );
}

describe("PlayHQTeamLinkCard hook-order safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockImplementation((table: string) => queryFor(table));
  });

  it("can move from the loading gate to a configured PlayHQ card without changing hook order", async () => {
    let resolveClub!: (value: { data: unknown; error: null }) => void;
    mocks.clubResult = new Promise((resolve) => {
      resolveClub = resolve;
    });

    renderCard();
    expect(screen.queryByText("PlayHQ Link")).not.toBeInTheDocument();

    resolveClub({
      data: { playhq_tenant: "tenant", playhq_org_id: "organisation" },
      error: null,
    });

    expect(await screen.findByText("PlayHQ Link")).toBeInTheDocument();
    expect(mocks.from).toHaveBeenCalledWith("teams");
    expect(mocks.from).toHaveBeenCalledWith("competitions");
  });

  it("keeps the card and all downstream reads disabled for an unconfigured club", async () => {
    mocks.clubResult = Promise.resolve({
      data: { playhq_tenant: null, playhq_org_id: null },
      error: null,
    });

    renderCard();

    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("clubs"));
    expect(screen.queryByText("PlayHQ Link")).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalledWith("teams");
    expect(mocks.from).not.toHaveBeenCalledWith("competitions");
    expect(mocks.from).not.toHaveBeenCalledWith("competition_matches");
  });
});
