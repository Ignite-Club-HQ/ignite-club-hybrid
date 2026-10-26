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
  setLiveChildRsvp: () => new Promise<void>((res, rej) => { write.resolve = res; write.reject = rej; }),
  adminUpsertLiveRsvp: () => new Promise<void>((res, rej) => { write.resolve = res; write.reject = rej; }),
  adminUpdateLiveRsvpStatus: () => new Promise<void>((res, rej) => { write.resolve = res; write.reject = rej; }), setLiveRsvpNote: vi.fn(),
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
  return { result, status, qc };
}

describe("RSVP responds instantly", () => {
  it("shows an admin status change before acknowledgement and restores it on refusal", async () => {
    const { result, qc, status } = setup();
    qc.setQueryData(eventKeys.rsvps("e1"), [{ id: "e1:me:self", user_id: "principal:me", child_id: null, status: "not_going" }]);
    act(() => result.current.adminUpdateRsvpMutation.mutate({ rsvpId: "e1:me:self", status: "maybe", playerName: "Me" }));
    await waitFor(() => expect(status()).toBe("maybe"));
    expect(result.current.adminUpdateRsvpMutation.isPending).toBe(true);
    await act(async () => { write.reject?.(new Error("denied")); });
    await waitFor(() => expect(status()).toBe("not_going"));
  });
  it("does not roll back another child's response when one save fails", async () => {
    const { result, qc } = setup();
    act(() => result.current.childRsvpMutation.mutate({ childId: "child1", childName: "Alex", status: "going" }));
    await waitFor(() => expect((qc.getQueryData(eventKeys.rsvps("e1")) as any[]).find(r => r.child_id === "child1")?.status).toBe("going"));
    qc.setQueryData(eventKeys.rsvps("e1"), (rows: any) => [...rows, { id: "r2", child_id: "child2", status: "maybe" }]);
    await act(async () => { write.reject?.(new Error("denied")); });
    await waitFor(() => expect((qc.getQueryData(eventKeys.rsvps("e1")) as any[]).some(r => r.child_id === "child1")).toBe(false));
    expect((qc.getQueryData(eventKeys.rsvps("e1")) as any[]).find(r => r.child_id === "child2")?.status).toBe("maybe");
  });
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
