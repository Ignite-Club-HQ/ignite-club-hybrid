import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const createEventPage = read("src/pages/CreateEventPage.tsx");
const homePage = read("src/pages/HomePage.tsx");
const eventCacheRefresh = read("src/lib/eventCacheRefresh.ts");

function successfulCreateWindow(): string {
  const start = createEventPage.indexOf('supabase.rpc("create_event_with_duties"');
  expect(start, "CreateEventPage must invoke its transactional creation RPC").toBeGreaterThanOrEqual(0);
  const end = createEventPage.indexOf("} catch (error: any)", start);
  expect(end, "Could not locate the successful event-creation block").toBeGreaterThan(start);
  return createEventPage.slice(start, end);
}

describe("Home Next Up freshness after event creation", () => {
  it("invalidates the exact consolidated Home query before leaving a successful create", () => {
    const success = successfulCreateWindow();
    expect(success).toContain("await queryClient.invalidateQueries(");
    expect(success).toContain("queryKey: eventKeys.home(user!.id)");
    expect(success).not.toContain("invalidateQueries()");
  });

  it("gives each club and team an independent candidate window before merging", () => {
    expect(homePage).toContain('const scopedEventsQuery = (column: "club_id" | "team_id", value: string, rowLimit: number)');
    expect(homePage).toContain(".eq(column, value)");
    expect(homePage).toContain('scopedEventsQuery("club_id", clubId, CLUB_EVENTS_LIMIT)');
    expect(homePage).toContain('scopedEventsQuery("team_id", teamId, TEAM_EVENTS_LIMIT)');
    expect(homePage).toContain("const mergedEventsById = new Map");
    expect(homePage).toContain("mergedEventsById.set(row.id, row)");
    expect(homePage).not.toMatch(/\.or\(eventScopeOr\.join/);
  });

  it("keeps Home as the query owner while the feature repository owns data access", () => {
    expect(homePage).toContain("queryKey: eventKeys.home(user?.id)");
    expect(homePage).toContain("useQuery(");
    expect(homePage).toMatch(/supabase\s*\.from\("user_roles"\)/);
    expect(homePage).toMatch(/\.from\("events"\)/);
  });

  it("keeps the Home query refresh-on-mount/focus/reconnect safety net", () => {
    expect(homePage).toContain('refetchOnMount: "always"');
    expect(homePage).toContain('refetchOnWindowFocus: "always"');
    expect(homePage).toContain('refetchOnReconnect: "always"');
    expect(eventCacheRefresh).toContain('queryKey: ["user-memberships-and-events", userId]');
  });
});
