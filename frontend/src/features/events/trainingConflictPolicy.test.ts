import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateTrainingConflicts,
  CONFLICT_CHECK_ERROR_TITLE,
  CONFLICT_CHECK_ERROR_DESCRIPTION,
  type ConflictRow,
} from "./trainingConflictPolicy";

const ADDRESS = "12 Oval Rd";
const target = new Date("2026-08-19T18:30:00");

const row = (over: Partial<ConflictRow> = {}): ConflictRow => ({
  id: "e1",
  title: "U12 Training",
  event_date: "2026-08-19T18:30:00",
  address: ADDRESS,
  teams: { name: "Under 12" },
  ...over,
});

const evaluate = (
  direct: { data: ConflictRow[] | null; error: unknown },
  recurring: { data: ConflictRow[] | null; error: unknown },
) =>
  evaluateTrainingConflicts({
    targetDateTime: target,
    address: ADDRESS,
    directDateQuery: direct,
    recurringParentQuery: recurring,
  });

describe("training conflict policy — fail closed", () => {
  it("both queries succeed with no matches -> clear", () => {
    expect(evaluate({ data: [], error: null }, { data: [], error: null })).toEqual({
      status: "clear",
    });
  });

  it("successful null data is clear, not an error", () => {
    expect(evaluate({ data: null, error: null }, { data: null, error: null })).toEqual({
      status: "clear",
    });
  });

  it("direct-date query error -> error", () => {
    expect(
      evaluate({ data: null, error: { message: "rls" } }, { data: [], error: null }).status,
    ).toBe("error");
  });

  it("recurring-parent query error -> error", () => {
    expect(
      evaluate({ data: [], error: null }, { data: null, error: { message: "timeout" } }).status,
    ).toBe("error");
  });

  it("an error is never converted into an empty array / clear result", () => {
    const res = evaluate(
      { data: [row()], error: { message: "boom" } },
      { data: [], error: null },
    );
    expect(res.status).toBe("error");
    expect(res).not.toHaveProperty("conflicts");
  });

  it("genuine direct conflict is reported", () => {
    const res = evaluate({ data: [row()], error: null }, { data: [], error: null });
    expect(res.status).toBe("conflict");
    if (res.status === "conflict") {
      expect(res.conflicts).toHaveLength(1);
      expect(res.conflicts[0].team_name).toBe("Under 12");
    }
  });

  it("genuine recurring-parent conflict is reported", () => {
    const res = evaluate(
      { data: [], error: null },
      { data: [row({ id: "p1", event_date: "2026-07-15T18:30:00" })], error: null },
    );
    expect(res.status).toBe("conflict");
  });

  it("dedupes rows already matched by the direct query", () => {
    const res = evaluate({ data: [row()], error: null }, { data: [row()], error: null });
    if (res.status === "conflict") expect(res.conflicts).toHaveLength(1);
  });

  it("address and exact hour/minute matching unchanged", () => {
    expect(
      evaluate({ data: [row({ address: "Somewhere else" })], error: null }, { data: [], error: null })
        .status,
    ).toBe("clear");
    expect(
      evaluate({ data: [row({ event_date: "2026-08-19T19:00:00" })], error: null }, { data: [], error: null })
        .status,
    ).toBe("clear");
  });
});

const source = readFileSync(
  resolve(__dirname, "../../pages/CreateEventPage.tsx"),
  "utf8",
);

describe("CreateEventPage wiring", () => {
  // CreateEventPage.tsx hosts both the ICP-lab and legacy Supabase submit
  // paths in one file; "setSaving(true);" appears in each, so the search for
  // the closing marker must start after the conflict-check block begins
  // (SupabaseCreateEventPage) rather than matching the first, unrelated
  // occurrence earlier in the file (IcpCreateEventPage).
  const conflictCheckStart = source.indexOf(
    "if (!skipConflictCheck && type === \"training\")",
  );
  const submitBlock = source.slice(
    conflictCheckStart,
    source.indexOf("setSaving(true);", conflictCheckStart),
  );

  it("aborts creation on a failed conflict read", () => {
    expect(submitBlock).toContain('conflictResult.status === "error"');
    expect(submitBlock).toContain("return;");
    expect(submitBlock).toContain("CONFLICT_CHECK_ERROR_TITLE");
    expect(submitBlock).toContain("CONFLICT_CHECK_ERROR_DESCRIPTION");
  });

  it("does not open the conflict dialog when the check itself failed", () => {
    const errorBranch = submitBlock.slice(
      submitBlock.indexOf('conflictResult.status === "error"'),
      submitBlock.indexOf('conflictResult.status === "conflict"'),
    );
    expect(errorBranch).toContain("setConflictDialogOpen(false)");
    expect(errorBranch).not.toContain("setConflictDialogOpen(true)");
  });

  it("only opens the dialog for genuine conflicts", () => {
    expect(submitBlock).toContain('conflictResult.status === "conflict"');
    expect(submitBlock.match(/setConflictDialogOpen\(true\)/g)).toHaveLength(1);
  });

  it("conflict check runs before saving state is set", () => {
    // Same first-occurrence pitfall as submitBlock above — anchor the search
    // to the SupabaseCreateEventPage conflict-check region.
    expect(source.indexOf("const conflictResult = await checkForConflicts()")).toBeLessThan(
      source.indexOf("setSaving(true);", conflictCheckStart),
    );
  });

  it("still restricts the training conflict read to training events", () => {
    expect(source).toContain('if (type !== "training" || !clubId || !eventDateTime || !address.trim())');
  });

  it("returns error early without evaluating when a query fails", () => {
    expect(source).toContain('if (directDateQuery.error) return { status: "error" };');
    expect(source).toContain('if (recurringParentQuery.error) return { status: "error" };');
  });

  it("surfaces a friendly non-technical message", () => {
    expect(CONFLICT_CHECK_ERROR_TITLE).toBe("Unable to check schedule");
    expect(CONFLICT_CHECK_ERROR_DESCRIPTION).not.toMatch(/supabase|PGRST|rls/i);
  });
});
