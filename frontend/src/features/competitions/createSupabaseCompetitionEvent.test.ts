import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { createSupabaseCompetitionEvent } from "./createSupabaseCompetitionEvent";

const input = { operationId: "op-1", competitionId: "competition-1", title: "Awards", eventType: "social" as const,
  startsAt: "2026-11-12T18:00:00Z", endsAt: "2026-11-12T20:00:00Z", location: null, description: null };
describe("competition event signature compatibility", () => {
  beforeEach(() => rpc.mockReset());
  it("uses the receipt-aware signature when available", async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    await expect(createSupabaseCompetitionEvent(input)).resolves.toBe(3);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_operation_id: "op-1", p_starts_at: input.startsAt });
  });
  it("uses prod's existing signature only after an explicit non-executed signature miss", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function public.create_competition_event in the schema cache" } });
    rpc.mockResolvedValueOnce({ data: 4, error: null });
    await expect(createSupabaseCompetitionEvent(input)).resolves.toBe(4);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1]).toEqual(["create_competition_event", {
      p_competition_id: "competition-1", p_title: "Awards", p_type: "social",
      p_event_date: input.startsAt, p_end_time: input.endsAt, p_location: null, p_description: null,
    }]);
  });
  it.each(["42501", "P0001", "PGRST203", "57014", undefined])("never replays denied, ambiguous or timed-out writes (%s)", async (code) => {
    const error = { code, message: "create_competition_event failed" };
    rpc.mockResolvedValue({ data: null, error });
    await expect(createSupabaseCompetitionEvent(input)).rejects.toEqual(error);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not retry network failures", async () => {
    const transportFailure = { code: "", message: "TypeError: Failed to fetch" };
    rpc.mockResolvedValue({ data: null, error: transportFailure });
    await expect(createSupabaseCompetitionEvent(input)).rejects.toEqual(transportFailure);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});