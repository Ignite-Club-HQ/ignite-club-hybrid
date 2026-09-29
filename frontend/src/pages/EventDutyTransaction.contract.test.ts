/**
 * Regression tests for the transactional duty contract.
 *
 * Defect history: event creation could commit the event row while the duty
 * insert failed, and event edits applied duty delete/update/insert as separate
 * statements, so a mid-way failure left duties half-written. Both paths now go
 * through transactional RPCs (`create_event_with_duties`, `sync_event_duties`),
 * invoked from the hybrid workflow modules (`createEventWorkflow`,
 * `editEventWorkflow`) so the ICP backend branch is reachable.
 *
 * These tests pin the wiring at the source level so the non-atomic multi-write
 * pattern cannot come back unnoticed, and so the pages cannot silently bypass
 * the canister-routed workflow layer again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const createPage = read("src/pages/CreateEventPage.tsx");
const editPage = read("src/pages/EditEventPage.tsx");
const createWorkflow = read("src/features/events/createEventWorkflow.ts");
const editWorkflow = read("src/features/events/editEventWorkflow.ts");

describe("CreateEventPage — atomic event + duties", () => {
  it("creates the event through the hybrid createEventTransaction workflow", () => {
    expect(createPage).toContain('from "@/features/events/createEventWorkflow"');
    expect(createPage).toMatch(/createEventTransaction\(supabase, \{/);
    expect(createPage).toContain("childDates");
    expect(createPage).toContain("duties: dutyPayload");
  });

  it("the workflow routes Supabase through one transactional RPC", () => {
    expect(createWorkflow).toContain('client.rpc("create_event_with_duties"');
    expect(createWorkflow).toContain("p_child_dates");
    expect(createWorkflow).toContain("p_duties");
  });

  it("the workflow routes ICP through the events canister", () => {
    expect(createWorkflow).toContain("withFeatureBackend(\"events\"");
    expect(createWorkflow).toContain("createLiveEvent");
    expect(createWorkflow).toContain("setLiveEventDuty");
  });

  it("never writes duties or events with a direct table insert", () => {
    expect(createPage).not.toMatch(/from\(["']duties["']\)\s*\.insert/);
    expect(createPage).not.toMatch(/from\(["']events["']\)\s*\.insert/);
  });

  it("does not retain partial-write retry state (atomicity makes it dead code)", () => {
    expect(createPage).not.toContain("createdEventIdRef");
  });

  it("aborts navigation when creation fails", () => {
    expect(createPage).toContain('throw new Error("Event could not be created.")');
  });
});

describe("EditEventPage — atomic duty sync", () => {
  it("applies duty changes through the hybrid syncEventDuties workflow", () => {
    expect(editPage).toContain('from "@/features/events/editEventWorkflow"');
    expect(editPage).toMatch(/syncEventDuties\(supabase, id!, dutiesToDelete, duties\)/);
  });

  it("the workflow routes Supabase through a single RPC", () => {
    expect(editWorkflow).toContain('client.rpc("sync_event_duties"');
    expect(editWorkflow).toContain("p_delete_ids");
    expect(editWorkflow).toContain("p_duties");
  });

  it("the workflow routes ICP through the events canister", () => {
    expect(editWorkflow).toContain("withFeatureBackend(\"events\"");
    expect(editWorkflow).toContain("setLiveEventDuty");
  });

  it("no longer issues per-duty table mutations", () => {
    expect(editPage).not.toMatch(/from\(["']duties["']\)\s*\.(delete|update|insert)/);
  });

  it("reconciles new duty ids by stable index", () => {
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
