import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { rpcMock, invalidateQueriesMock, toastMock, createLiveEventMock, backendMode } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  toastMock: vi.fn(),
  createLiveEventMock: vi.fn(),
  backendMode: { value: "supabase" as "supabase" | "icp" },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: rpcMock },
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (context: unknown) => unknown }) =>
    backendMode.value === "icp" ? providers.icp({ identity: {}, target: {} }) : providers.supabase(),
}));

vi.mock("@/live/features/competitions", () => ({
  createLiveCompetitionEvent: createLiveEventMock,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { CreateCompetitionEventButton } from "./CreateCompetitionEventButton";

describe("CreateCompetitionEventButton", () => {
  beforeEach(() => {
    rpcMock.mockReset().mockResolvedValue({ data: 3, error: null });
    invalidateQueriesMock.mockReset().mockResolvedValue(undefined);
    toastMock.mockReset();
    createLiveEventMock.mockReset().mockResolvedValue(3n);
    backendMode.value = "supabase";
  });

  it("submits a validated event through the selected backend and refreshes the schedule", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("operation-1");
    render(<CreateCompetitionEventButton competitionId="competition-1" teamCount={3} />);

    fireEvent.click(screen.getByRole("button", { name: /create event for all teams/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Presentation night" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "18:00" } });
    fireEvent.click(screen.getByRole("button", { name: /create & invite/i }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const args = rpcMock.mock.calls[0][1];
    expect(args).toEqual(expect.objectContaining({
      p_competition_id: "competition-1",
      p_operation_id: "operation-1",
      p_title: "Presentation night",
      p_event_type: "social",
      p_location: null,
      p_description: null,
      p_starts_at: expect.any(String),
      p_ends_at: expect.any(String),
    }));
    expect(new Date(args.p_ends_at).getTime() - new Date(args.p_starts_at).getTime()).toBe(2 * 60 * 60 * 1000);
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["events"] });
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Event created" }));
  });

  it("routes the same event contract through the ICP competition adapter", async () => {
    backendMode.value = "icp";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("operation-icp");
    render(<CreateCompetitionEventButton competitionId="competition-icp" teamCount={2} />);

    fireEvent.click(screen.getByRole("button", { name: /create event for all teams/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Round presentation" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-12" } });
    fireEvent.click(screen.getByRole("button", { name: /create & invite/i }));

    await waitFor(() => expect(createLiveEventMock).toHaveBeenCalledTimes(1));
    expect(createLiveEventMock).toHaveBeenCalledWith(
      { identity: {}, target: {} },
      expect.objectContaining({
        operationId: "operation-icp",
        competitionId: "competition-icp",
        title: "Round presentation",
        eventType: "social",
        startsAtMs: expect.any(Date),
        endsAtMs: expect.any(Date),
      }),
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });
});