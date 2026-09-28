/**
 * Regression tests for the transactional duty contract.
 *
 * Defect history: event creation could commit the event row while the duty
 * insert failed, and event edits applied duty delete/update/insert as separate
 * statements, so a mid-way failure left duties half-written. Both paths now go
 * through transactional RPCs (`create_event_with_duties`, `sync_event_duties`).
 *
 * These tests pin the wiring at the source level so the non-atomic multi-write
 * pattern cannot come back unnoticed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const createPage = read("src/pages/CreateEventPage.tsx");
const editPage = read("src/pages/EditEventPage.tsx");

describe("CreateEventPage — atomic event + duties", () => {
  it("creates the event, its recurring children and its duties in one RPC", () => {
    expect(createPage).toContain('supabase.rpc("create_event_with_duties"');
    expect(createPage).toContain("p_child_dates");
    expect(createPage).toContain("p_duties");
  });

  it("never writes duties or events with a direct table insert", () => {
    expect(createPage).not.toMatch(/from\(["']duties["']\)\s*\.insert/);
    expect(createPage).not.toMatch(/from\(["']events["']\)\s*\.insert/);
  });

  it("does not retain partial-write retry state (atomicity makes it dead code)", () => {
    expect(createPage).not.toContain("createdEventIdRef");
  });

  it("aborts navigation when the RPC returns an error", () => {
    expect(createPage).toMatch(/if \(error\) throw error;/);
    expect(createPage).toContain('throw new Error("Event could not be created.")');
  });
});

describe("EditEventPage — atomic duty sync", () => {
  it("applies deletes, updates and inserts through a single RPC", () => {
    expect(editPage).toContain('supabase.rpc("sync_event_duties"');
    expect(editPage).toContain("p_delete_ids");
    expect(editPage).toContain("p_duties");
  });

  it("no longer issues per-duty table mutations", () => {
    expect(editPage).not.toMatch(/from\(["']duties["']\)\s*\.(delete|update|insert)/);
  });

  it("sends a stable index with each duty so new ids can be reconciled", () => {
    expect(editPage).toMatch(/duties\.map\(\(duty, idx\) => \(\{[\s\S]*?idx,/);
    expect(editPage).toMatch(/synced\.find\(\(s\) => s\.idx === idx\)/);
  });

  it("surfaces duty failures as an explicit non-success toast", () => {
    expect(editPage).toContain("__dutyStage");
    expect(editPage).toContain("Event saved, duties not saved");
    expect(editPage).toContain("No duty changes were applied.");
  });

  it("keeps the double-submit guard on save", () => {
    expect(editPage).toMatch(/if \(saving\) return;/);
  });
});
