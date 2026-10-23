import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { purgeClubScopedQueryCache } from "./clubScopeCachePurge";
import { selectVisibleHomeEvents } from "@/components/home/homeEventSelection";

describe("Next Up club-switch cache isolation", () => {
  it("immediately selects the new club's loaded events without restarting the account feed", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = Date.now();
    const date = new Date(now + 86400000).toISOString();
    const events = [
      { id: "goat-training", club_id: "giddy-goat", event_date: date },
      { id: "dogs-game", club_id: "riverdogs", event_date: date },
    ];
    const key = ["user-memberships-and-events", "paul"];
    client.setQueryData(key, { events });
    const fetchFeed = vi.fn(() => new Promise<{ events: typeof events }>(() => {}));
    function NextUp({ club }: { club: string }) {
      const { data } = useQuery({ queryKey: key, queryFn: fetchFeed, staleTime: 120000 });
      return <>{selectVisibleHomeEvents(data?.events, club, now).map(e => <div key={e.id}>{e.id}</div>)}</>;
    }
    const view = render(<QueryClientProvider client={client}><NextUp club="giddy-goat" /></QueryClientProvider>);
    expect(screen.getByText("goat-training")).toBeInTheDocument();
    act(() => purgeClubScopedQueryCache(client));
    view.rerender(<QueryClientProvider client={client}><NextUp club="riverdogs" /></QueryClientProvider>);
    expect(screen.getByText("dogs-game")).toBeInTheDocument();
    expect(screen.queryByText("goat-training")).not.toBeInTheDocument();
    expect(fetchFeed).not.toHaveBeenCalled();
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    view.unmount();
    client.clear();
  });
  it("preserves an already running account feed without invalidating or restarting it", async () => {
    const client = new QueryClient();
    const key = ["user-memberships-and-events", "paul"];
    let finish: ((value: string[]) => void) | undefined;
    const fetchFeed = vi.fn(() => new Promise<string[]>(resolve => { finish = resolve; }));
    const read = client.fetchQuery({ queryKey: key, queryFn: fetchFeed });
    purgeClubScopedQueryCache(client);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    finish?.(["riverdogs-event"]);
    await read;
    expect(client.getQueryData(key)).toEqual(["riverdogs-event"]);
    client.clear();
  });
  it("removes ambiguous club content but retains explicitly event-keyed card reads and identity", () => {
    const client = new QueryClient();
    client.setQueryData(["club-news"], ["old-club-post"]);
    client.setQueryData(["hero-rsvp", "dogs-game", "paul"], ["going"]);
    client.setQueryData(["hero-rsvp"], ["ambiguous"]);
    client.setQueryData(["user-roles", "paul"], ["member"]);
    purgeClubScopedQueryCache(client);
    expect(client.getQueryData(["club-news"])).toBeUndefined();
    expect(client.getQueryData(["hero-rsvp"])).toBeUndefined();
    expect(client.getQueryData(["hero-rsvp", "dogs-game", "paul"])).toEqual(["going"]);
    expect(client.getQueryState(["user-roles", "paul"])?.isInvalidated).toBe(false);
    client.clear();
  });
});