import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the authorization boundary of
 * public.convert_event_to_recurring_series.
 *
 * The RPC is SECURITY DEFINER and authorizes the caller against the event's
 * ORIGINAL club/team scope. If the same call could also rewrite club_id or
 * team_id, a manager of the source event could move it (and every generated
 * occurrence) into a club or team they cannot manage. Scope, ownership and
 * series linkage must therefore never be client-controlled.
 */

const migrationsDir = resolve(__dirname, "../../supabase/migrations");

function latestConversionMigration(): string {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const matching = files.filter((f) =>
    readFileSync(resolve(migrationsDir, f), "utf8").includes(
      "FUNCTION public.convert_event_to_recurring_series",
    ),
  );
  expect(matching.length).toBeGreaterThan(0);
  return readFileSync(resolve(migrationsDir, matching[matching.length - 1]), "utf8");
}

const sql = latestConversionMigration();

const allowlist = (() => {
  const start = sql.indexOf("allowed_columns text[] := ARRAY[");
  const end = sql.indexOf("];", start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
})();

const updateStatement = (() => {
  const start = sql.indexOf("UPDATE public.events AS e");
  const end = sql.indexOf("WHERE e.id = p_event_id", start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
})();

const childInsert = (() => {
  const start = sql.indexOf("INSERT INTO public.events (");
  const end = sql.indexOf("inserted_children := inserted_children + 1", start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
})();

describe("convert_event_to_recurring_series destination-scope injection", () => {
  it("does not accept club_id or team_id from the client payload", () => {
    expect(allowlist).not.toContain("'club_id'");
    expect(allowlist).not.toContain("'team_id'");
  });

  it("continues to exclude mini_league_id, parent_event_id, created_by and is_recurring", () => {
    expect(allowlist).not.toContain("'mini_league_id'");
    expect(allowlist).not.toContain("'parent_event_id'");
    expect(allowlist).not.toContain("'created_by'");
    expect(allowlist).not.toContain("'is_recurring'");
  });

  it("still accepts the non-scope editable columns", () => {
    for (const col of [
      "title",
      "type",
      "address",
      "description",
      "reminder_hours_before",
      "amount",
      "opponent",
      "arrival_minutes_before",
      "rsvp_audience",
      "is_bye",
      "allow_guests",
      "max_guests_per_member",
      "restricted_to_roles",
      "adults_only",
      "rsvp_grouping",
      "target_team_ids",
    ]) {
      expect(allowlist).toContain(`'${col}'`);
    }
  });

  it("never writes club_id, team_id or mini_league_id on the parent event", () => {
    expect(updateStatement).not.toMatch(/club_id\s*=/);
    expect(updateStatement).not.toMatch(/team_id\s*=/);
    expect(updateStatement).not.toMatch(/mini_league_id\s*=/);
  });

  it("derives every child's scope from the locked parent row", () => {
    expect(childInsert).toContain("ev_row.club_id, ev_row.team_id, ev_row.mini_league_id");
  });

  it("derives child ownership and parent linkage server-side", () => {
    expect(childInsert).toContain("p_event_id, caller");
    expect(childInsert).not.toContain("child->>'club_id'");
    expect(childInsert).not.toContain("child->>'team_id'");
    expect(childInsert).not.toContain("child->>'created_by'");
    expect(childInsert).not.toContain("child->>'parent_event_id'");
  });

  it("silently strips unknown keys instead of failing (frontend still sends club_id/team_id)", () => {
    expect(sql).toContain("WHERE key = ANY(allowed_columns)");
    expect(sql).not.toMatch(/RAISE EXCEPTION[^;]*not allowed/i);
  });

  it("keeps authentication, authorization and FOR UPDATE locking", () => {
    expect(sql).toContain("caller uuid := auth.uid()");
    expect(sql).toContain("IF caller IS NULL THEN");
    expect(sql).toContain("FROM public.events WHERE id = p_event_id FOR UPDATE");
    expect(sql).toContain("You do not have permission to convert this event");
    expect(sql).toContain("club_id = ev_row.club_id");
    expect(sql).toContain("team_id = ev_row.team_id");
  });

  it("keeps duplicate/concurrent conversion protection and idempotent child inserts", () => {
    expect(sql).toContain("already part of a recurring series");
    expect(sql).toContain("WHERE parent_event_id = p_event_id AND event_date = child_date");
  });

  it("keeps the safe search_path and restricted execute permissions", () => {
    expect(sql).toContain("SET search_path TO 'public'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.convert_event_to_recurring_series");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.convert_event_to_recurring_series(uuid, jsonb, jsonb, timestamptz, timestamptz, timestamptz, date) TO authenticated");
    expect(sql).not.toMatch(/TO anon/);
  });

  it("raises on invalid child data so the parent conversion rolls back", () => {
    expect(sql).toContain("Child occurrence is missing a date");
  });
});
