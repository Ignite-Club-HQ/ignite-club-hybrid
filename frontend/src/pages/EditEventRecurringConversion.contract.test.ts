import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(__dirname, "EditEventPage.tsx"), "utf8");
const workflow = readFileSync(
  resolve(__dirname, "../features/events/editEventWorkflow.ts"),
  "utf8",
);

// The conversion block spans from the "converting single event to recurring"
// comment to the start of the whole-series branch.
const conversionBlock = page.slice(
  page.indexOf("// If converting single event to recurring series"),
  page.indexOf("} else if (updateSeries) {"),
);

// The workflow's conversion function owns the transactional RPC and the
// child-event payload construction.
const workflowConversion = workflow.slice(
  workflow.indexOf("export async function convertEventToRecurringSeries"),
);

describe("single event -> recurring series conversion is atomic", () => {
  it("routes the conversion through the hybrid workflow", () => {
    expect(conversionBlock).toContain("convertEventToRecurringSeries(supabase, {");
    expect(conversionBlock).not.toMatch(/supabase\.rpc\(/);
  });

  it("the workflow performs the conversion in one transactional RPC", () => {
    expect(workflowConversion).toContain('client.rpc("convert_event_to_recurring_series"');
    expect(workflowConversion.match(/\.rpc\(/g)).toHaveLength(1);
  });

  it("performs no direct parent update or child insert on the events table", () => {
    expect(conversionBlock).not.toMatch(/\.from\("events"\)/);
    expect(conversionBlock).not.toMatch(/\.insert\(/);
    expect(conversionBlock).not.toMatch(/\.update\(/);
    expect(workflowConversion).not.toMatch(/\.from\("events"\)/);
  });

  it("does not send client-supplied scope or creator identity for children", () => {
    expect(workflowConversion).not.toMatch(/club_id:/);
    expect(workflowConversion).not.toMatch(/team_id:/);
    expect(workflowConversion).not.toMatch(/mini_league_id:/);
    expect(workflowConversion).not.toMatch(/created_by:/);
    expect(workflowConversion).not.toMatch(/parent_event_id:/);
    expect(workflowConversion).not.toMatch(/is_recurring: true/);
  });

  it("preserves child date, start time and nullable end time payload shape", () => {
    expect(workflowConversion).toContain("event_date: childDateTime.toISOString()");
    expect(workflowConversion).toContain("start_time: childDateTime.toISOString()");
    expect(workflowConversion).toContain("end_time: durationMs === null");
  });

  it("reports the occurrence count returned by the server", () => {
    expect(workflowConversion).toContain("occurrence_count");
  });

  it("routes series expansion through the feature backend", () => {
    // The events_domain canister now owns series expansion (create_series);
    // the workflow picks the branch at runtime instead of falling back to
    // Supabase unconditionally.
    expect(workflowConversion).toContain("withFeatureBackend");
    expect(workflowConversion).toContain("createLiveRecurringEventSeries");
  });

  it("threads the user-selected recurrence pattern from EditEventPage into the workflow call", () => {
    expect(conversionBlock).toContain("frequency: recurrencePattern");
  });

  it("declares frequency on the RecurringConversionInput contract", () => {
    expect(workflow).toContain('frequency: "daily" | "weekly" | "biweekly" | "monthly"');
  });

  it("maps the biweekly pattern onto the canister's fortnightly frequency, passing other patterns through unchanged", () => {
    expect(workflowConversion).toContain('input.frequency === "biweekly" ? "fortnightly" : input.frequency');
    // The Supabase branch keeps using occurrenceDates (already pattern-expanded)
    // rather than sending a raw frequency string.
    const supabaseBranch = workflowConversion.slice(
      workflowConversion.indexOf("supabase: async"),
      workflowConversion.indexOf("icp: async"),
    );
    expect(supabaseBranch).not.toContain("input.frequency");
  });
});
