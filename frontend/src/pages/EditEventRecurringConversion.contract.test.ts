import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "EditEventPage.tsx"), "utf8");

// The conversion block spans from the "converting single event to recurring"
// comment to the start of the whole-series branch.
const conversionBlock = source.slice(
  source.indexOf("// If converting single event to recurring series"),
  source.indexOf("} else if (updateSeries) {"),
);

describe("single event -> recurring series conversion is atomic", () => {
  it("routes the conversion through one transactional RPC", () => {
    expect(conversionBlock).toContain('supabase.rpc(\n          "convert_event_to_recurring_series"');
    expect(conversionBlock.match(/supabase\.rpc\(/g)).toHaveLength(1);
  });

  it("performs no direct parent update or child insert on the events table", () => {
    expect(conversionBlock).not.toMatch(/\.from\("events"\)/);
    expect(conversionBlock).not.toMatch(/\.insert\(/);
    expect(conversionBlock).not.toMatch(/\.update\(/);
  });

  it("does not send client-supplied scope or creator identity for children", () => {
    expect(conversionBlock).not.toMatch(/club_id:/);
    expect(conversionBlock).not.toMatch(/team_id:/);
    expect(conversionBlock).not.toMatch(/mini_league_id:/);
    expect(conversionBlock).not.toMatch(/created_by:/);
    expect(conversionBlock).not.toMatch(/parent_event_id:/);
    expect(conversionBlock).not.toMatch(/is_recurring: true/);
  });

  it("preserves child date, start time and nullable end time payload shape", () => {
    expect(conversionBlock).toContain("event_date: childDateTime.toISOString()");
    expect(conversionBlock).toContain("start_time: childDateTime.toISOString()");
    expect(conversionBlock).toContain("end_time: childEnd");
    expect(conversionBlock).toContain("newEndIso\n            ?");
  });

  it("reports the occurrence count returned by the server", () => {
    expect(conversionBlock).toContain("occurrence_count");
  });

  it("aborts on RPC failure instead of continuing", () => {
    expect(conversionBlock).toContain("if (convertError) throw convertError;");
  });
});
