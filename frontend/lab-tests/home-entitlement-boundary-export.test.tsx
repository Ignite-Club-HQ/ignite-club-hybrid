import { Principal } from "@icp-sdk/core/principal";
import { expect, test, vi } from "vitest";
import {
  createHybridHomeEntitlementRepository,
  type HomeEntitlementProvider,
} from "../src/lab/hybridHomeEntitlementRepository";
import { createFakeBackendProviders } from "../src/test/mockLocalActor";
import { createSyntheticPlacementRegistry } from "../src/lab/syntheticPlacementRegistry";

const CLUB_A = "club-home-a";
const CLUB_B = "club-home-b";

function provider(overrides: Partial<HomeEntitlementProvider> = {}): HomeEntitlementProvider {
  return {
    hasHomeProAccess: vi.fn(async () => false),
    getHomeRewardClub: vi.fn(async (clubId: string) => ({
      id: clubId,
      name: clubId === CLUB_A ? "Riverside" : "Harbour",
      logo_url: null,
      hasPro: clubId === CLUB_A,
    })),
    ...overrides,
  };
}

function registryFor(mode: "supabase" | "icp") {
  return createSyntheticPlacementRegistry([
    {
      clubId: CLUB_A,
      country: "AU",
      backend: mode === "supabase"
        ? { Supabase: { environment: "home-au" } }
        : { Icp: { canister: Principal.fromText("aaaaa-aa") } },
    },
    {
      clubId: CLUB_B,
      country: "AU",
      backend: mode === "supabase"
        ? { Supabase: { environment: "home-au-2" } }
        : { Icp: { canister: Principal.fromText("2vxsx-fae") } },
    },
  ]);
}

for (const mode of ["supabase", "icp"] as const) {
  test(`Home entitlement export: preserves scoped Pro reads in explicit ${mode} mode`, async () => {
    const calls: string[] = [];
    const clubA = provider({
      hasHomeProAccess: vi.fn(async (clubId, teamIds) => {
        expect(clubId).toBe(CLUB_A);
        expect(teamIds).toEqual(["team-a", "team-b"]);
        return true;
      }),
    });
    const clubB = provider();
    const providers = createFakeBackendProviders<HomeEntitlementProvider>({
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return environment === "home-au" ? clubA : clubB;
      },
      icp: async canister => {
        calls.push(`icp:${canister.toText()}`);
        return canister.toText() === "aaaaa-aa" ? clubA : clubB;
      },
    });
    const repository = createHybridHomeEntitlementRepository(registryFor(mode), providers);

    await expect(repository.fetchProAccessAcrossClubs([
      { clubId: CLUB_A, teamIds: ["team-a"] },
      { clubId: CLUB_A, teamIds: ["team-b", "team-a"] },
      { clubId: CLUB_B, teamIds: [] },
    ])).resolves.toMatchObject({
      hasPro: true,
      groups: {
        [CLUB_A]: { status: "ok", hasPro: true },
        [CLUB_B]: { status: "ok", hasPro: false },
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.startsWith(`${mode}:`))).toBe(true);
  });
}

test("Home entitlement export: reward-club reads preserve active-club scope", async () => {
  const clubA = provider();
  const clubB = provider();
  const providers = createFakeBackendProviders<HomeEntitlementProvider>({
    supabase: async environment => environment === "home-au" ? clubA : clubB,
    icp: async canister => canister.toText() === "aaaaa-aa" ? clubA : clubB,
  });
  const repository = createHybridHomeEntitlementRepository(registryFor("supabase"), providers);

  await expect(repository.fetchRewardClubs([CLUB_A, CLUB_B], CLUB_B)).resolves.toMatchObject({
    clubs: [{ id: CLUB_B, hasPro: false }],
  });
  expect(clubB.getHomeRewardClub).toHaveBeenCalledWith(CLUB_B);
  expect(clubA.getHomeRewardClub).not.toHaveBeenCalled();
});

test("Home entitlement export: selected ICP failures are surfaced without a Supabase fallback", async () => {
  let supabaseCalls = 0;
  const providers = createFakeBackendProviders<HomeEntitlementProvider>({
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error("Supabase must not be used in ICP mode");
    },
    icp: async () => {
      throw new Error("local ICP entitlement unavailable");
    },
  });
  const repository = createHybridHomeEntitlementRepository(registryFor("icp"), providers);

  const result = await repository.fetchProAccessAcrossClubs([{ clubId: CLUB_A, teamIds: [] }]);
  expect(result.hasPro).toBe(false);
  expect(result.groups[CLUB_A]).toMatchObject({
    status: "unavailable",
    error: new Error("local ICP entitlement unavailable"),
  });
  expect(supabaseCalls).toBe(0);
});
