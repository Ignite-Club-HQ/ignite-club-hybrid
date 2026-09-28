import { describe, expect, it } from "vitest";
import { resolveStableInboxReadModel } from "@/hooks/useStableInboxReadModel";

type Row = { key: string; lastActivity: string };
const row = (key: string, lastActivity = "2026-08-01T00:00:00Z"): Row => ({ key, lastActivity });

describe("stable authorised inbox read model", () => {
  it("retains the committed model while a source is unresolved", () => {
    const committed = [row("team-a")];
    const result = resolveStableInboxReadModel<Row>([], committed, false);
    expect(result.value).toBe(committed);
  });

  it("does not expose a partially settled mixture", () => {
    const committed = [row("team-a"), row("group-a")];
    const partial = [row("group-a")];
    const result = resolveStableInboxReadModel(partial, committed, false);
    expect(result.value).toBe(committed);
  });

  it("commits additions and ordering atomically once authoritative", () => {
    const committed = [row("team-a")];
    const fresh = [row("team-b", "2026-08-01T01:00:00Z"), row("team-a")];
    const result = resolveStableInboxReadModel(fresh, committed, true);
    expect(result.value).toBe(fresh);
    expect(result.retained).toBe(fresh);
  });

  it("honours an authoritative deletion", () => {
    const result = resolveStableInboxReadModel<Row>([], [row("team-a")], true);
    expect(result.value).toEqual([]);
    expect(result.retained).toEqual([]);
  });

  it("shows a genuine cold unresolved result when nothing was committed", () => {
    const next: Row[] = [];
    const result = resolveStableInboxReadModel(next, null, false);
    expect(result.value).toBe(next);
    expect(result.retained).toBeNull();
  });
});