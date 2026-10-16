import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "../backend/events_domain/src/main.mo"),
  "utf8",
);

function selfRsvpMethod() {
  const start = source.indexOf("public shared ({ caller }) func set_rsvp(");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("public shared ({ caller }) func set_rsvp_note(", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("events_domain self RSVP authorization", () => {
  it("allows a caller to RSVP only for their own visible event account", () => {
    const method = selfRsvpMethod();
    expect(method).toContain("account_id != caller.toText()");
    expect(method).toContain("not canView(caller, event)");
    expect(method).not.toContain("requireManage(caller, event_id)");
  });

  it("keeps cross-account RSVP writes on the separate admin endpoint", () => {
    expect(source).toContain("func admin_upsert_rsvp(");
    expect(source).toContain("requireManage(caller, event_id)");
  });
});