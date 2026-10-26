import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi } from "vitest";
import type { ReactNode } from "react";
const write = vi.hoisted(() => ({ reject: undefined as undefined | ((error: Error) => void) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: unknown, providers: any) => providers.icp({}) }));
vi.mock("@/live/clubScope", () => ({ writeOnce: (scope: unknown) => scope }));
vi.mock("@/live/features/events", () => ({ setLiveMiniLeagueRsvp: () => new Promise((_, reject) => { write.reject = reject; }) }));
import { useParentLeaguePlayerRsvpMutation } from "./useParentLeaguePlayerRsvpMutation";
import { eventKeys } from "@/lab/eventQueryKeys";

it("shows a player's response while saving and removes it on refusal", async () => {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(eventKeys.rsvps("e1"), []);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useParentLeaguePlayerRsvpMutation({ supabase: {}, id: "e1", user: { id: "me" }, rsvps: [] }), { wrapper });
  act(() => result.current.parentLeaguePlayerRsvpMutation.mutate({ playerId: "p1", status: "going" }));
  await waitFor(() => expect(qc.getQueryData(eventKeys.rsvps("e1"))).toEqual([expect.objectContaining({ mini_league_player_id: "p1", status: "going" })]));
  expect(result.current.parentLeaguePlayerRsvpMutation.isPending).toBe(true);
  await act(async () => write.reject?.(new Error("refused")));
  await waitFor(() => expect(qc.getQueryData(eventKeys.rsvps("e1"))).toEqual([]));
});