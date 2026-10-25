import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const write = vi.hoisted(() => ({ resolve: null as null | (() => void), reject: null as null | ((e: Error) => void) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/rsvpQueue", () => ({ queueRsvp: vi.fn() }));
vi.mock("@/lib/earlyRsvpPoints", () => ({ awardEarlyRsvpPoints: vi.fn() }));
vi.mock("@/lab/localEventsService", () => ({ setLocalEventRsvp: vi.fn() }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/live/clubScope", () => ({ writeOnce: (s: unknown) => s }));
vi.mock("@/live/features/insights", () => ({ recordLiveRsvpCompleted: () => new Promise(() => {}) }));
vi.mock("@/live/features/events", () => ({
  setLiveEventRsvp: () => new Promise<void>((res, rej) => { write.resolve = res; write.reject = rej; }),
  setLiveChildRsvp: vi.fn(), adminUpsertLiveRsvp: vi.fn(), adminUpdateLiveRsvpStatus: vi.fn(), setLiveRsvpNote: vi.fn(),
}));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_f: string, b: any) => b.icp({}) }));

import { useEventRsvpMutations } from "./useEventRsvpMutations";
import { eventKeys } from "@/lab/eventQueryKeys";

function setup() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(eventKeys.rsvps("e1"), [{ id: "r1", user_id: "principal:me", child_id: null, status: "not_going" }]);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useEventRsvpMutations({
    supabase: {}, useIcpLab: false, id: "e1", localIcpPersona: "", event: { club_id: "c1" }, user: { id: "me" },
    profile: null, myRsvp: null, childRsvps: [], rsvpNotes: "", notificationNudge: { hasPushEnabled: true },
    setShowPostRsvpNudge: () => {}, showPaymentStatus: false, userHasPaid: false, isProcessingPayment: false, handlePayNow: () => {},
  }), { wrapper });
  const status = () => (qc.getQueryData(eventKeys.rsvps("e1")) as any[])[0].status;
  return { result, status };
}

describe("RSVP responds instantly", () => {
  it("shows Going before the save finishes", async () => {
    const { result, status } = setup();
    act(() => { result.current.rsvpMutation.mutate("going"); });
    await waitFor(() => expect(status()).toBe("going"));
    expect(write.resolve).not.toBeNull();
  });
  it("restores the previous answer if the save fails", async () => {
    const { result, status } = setup();
    act(() => { result.current.rsvpMutation.mutate("going"); });
    await waitFor(() => expect(status()).toBe("going"));
    await act(async () => { write.reject?.(new Error("refused")); });
    await waitFor(() => expect(status()).toBe("not_going"));
  });
});
