import { Principal } from "@icp-sdk/core/principal";
import { expect, test, vi } from "vitest";
import {
  createHybridHomeRsvpRepository,
  type HomeRsvpProvider,
} from "../src/lab/hybridHomeRsvpRepository";
import { createFakeBackendProviders } from "../src/test/mockLocalActor";
import { createSyntheticPlacementRegistry } from "../src/lab/syntheticPlacementRegistry";

const CLUB_A = "club-rsvp-a";
const CLUB_B = "club-rsvp-b";

function registryFor(mode: "supabase" | "icp") {
  return createSyntheticPlacementRegistry([
    {
      clubId: CLUB_A,
      country: "AU",
      backend: mode === "supabase"
        ? { Supabase: { environment: "rsvp-au" } }
        : { Icp: { canister: Principal.fromText("aaaaa-aa") } },
    },
    {
      clubId: CLUB_B,
      country: "AU",
      backend: mode === "supabase"
        ? { Supabase: { environment: "rsvp-au-2" } }
        : { Icp: { canister: Principal.fromText("2vxsx-fae") } },
    },
  ]);
}

function rsvpProvider(rows: Array<{ event_id: string; status: string }>): HomeRsvpProvider {
  return { listUserRsvps: vi.fn(async () => rows) };
}

for (const mode of ["supabase", "icp"] as const) {
  test(`Home RSVP export: reads current-user RSVP rows per explicit ${mode} backend`, async () => {
    const calls: string[] = [];
    const clubA = rsvpProvider([{ event_id: "event-a", status: "going" }]);
    const clubB = rsvpProvider([{ event_id: "event-b", status: "maybe" }]);
    const providers = createFakeBackendProviders<HomeRsvpProvider>({
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return environment === "rsvp-au" ? clubA : clubB;
      },
      icp: async canister => {
        calls.push(`icp:${canister.toText()}`);
        return canister.toText() === "aaaaa-aa" ? clubA : clubB;
      },
    });
    const repository = createHybridHomeRsvpRepository(registryFor(mode), providers);

    await expect(repository.fetchRsvpsAcrossClubs("user-1", [
      { clubId: CLUB_A, eventIds: ["event-a"] },
      { clubId: CLUB_B, eventIds: ["event-b"] },
    ])).resolves.toEqual({
      rows: [
        { event_id: "event-a", status: "going" },
        { event_id: "event-b", status: "maybe" },
      ],
      groups: {
        [CLUB_A]: { status: "ok", rows: [{ event_id: "event-a", status: "going" }] },
        [CLUB_B]: { status: "ok", rows: [{ event_id: "event-b", status: "maybe" }] },
      },
    });
    expect(clubA.listUserRsvps).toHaveBeenCalledWith("user-1", ["event-a"]);
    expect(clubB.listUserRsvps).toHaveBeenCalledWith("user-1", ["event-b"]);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.startsWith(`${mode}:`))).toBe(true);
  });
}

test("Home RSVP export: does not query an empty event group", async () => {
  const provider = rsvpProvider([]);
  const providers = createFakeBackendProviders<HomeRsvpProvider>({
    supabase: async () => provider,
    icp: async () => provider,
  });
  const repository = createHybridHomeRsvpRepository(registryFor("supabase"), providers);

  await expect(repository.fetchRsvpsAcrossClubs("user-1", [
    { clubId: CLUB_A, eventIds: [] },
  ])).resolves.toEqual({
    rows: [],
    groups: { [CLUB_A]: { status: "ok", rows: [] } },
  });
  expect(provider.listUserRsvps).not.toHaveBeenCalled();
});

test("Home RSVP export: reports a selected backend failure without same-club fallback", async () => {
  let supabaseCalls = 0;
  const failure = new Error("local ICP RSVP unavailable");
  const providers = createFakeBackendProviders<HomeRsvpProvider>({
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error("Supabase must not be used in ICP mode");
    },
    icp: async () => {
      throw failure;
    },
  });
  const repository = createHybridHomeRsvpRepository(registryFor("icp"), providers);

  const result = await repository.fetchRsvpsAcrossClubs("user-1", [
    { clubId: CLUB_A, eventIds: ["event-a"] },
  ]);
  expect(result.rows).toEqual([]);
  expect(result.groups[CLUB_A]).toEqual({ status: "unavailable", error: failure });
  expect(supabaseCalls).toBe(0);
});
