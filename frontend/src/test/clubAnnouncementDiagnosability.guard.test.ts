/**
 * A club announcement that fails must always name its reason.
 *
 * The regression: the edge function returned 400 with no log line, and the
 * dialog swallowed the JSON body (it threw inside a try whose catch discarded
 * the message), so the user saw only "Failed to send announcement" and the
 * function logs were empty.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const fn = read("supabase/functions/send-club-announcement/index.ts");
const dialog = read("src/components/ClubAnnouncementDialog.tsx");

describe("club announcement edge function diagnosability", () => {
  it("logs and codes the missing-fields rejection", () => {
    expect(fn).toMatch(/console\.warn\("Announcement rejected: missing_fields"/);
    expect(fn).toMatch(/code: "missing_fields"/);
  });

  it("splits the required-fields check into distinct messages", () => {
    expect(fn).toMatch(/club_id is required/);
    expect(fn).toMatch(/At least one team \(or the club chat\) is required/);
    expect(fn).toMatch(/message is required/);
  });

  it("logs the offending ids and returns them with an invalid_teams code", () => {
    expect(fn).toMatch(/console\.warn\("Announcement rejected: invalid_teams"/);
    expect(fn).toMatch(/offendingTeamIds/);
    expect(fn).toMatch(/code: "invalid_teams"/);
    expect(fn).toMatch(/invalid_team_ids: offendingTeamIds/);
  });

  it("excludes soft-deleted teams from team validation", () => {
    expect(fn).toMatch(/\.is\("deleted_at", null\)/);
  });

  it("keeps auth/authorization and bot provisioning intact", () => {
    expect(fn).toMatch(/Not authenticated \(no bearer token\)/);
    expect(fn).toMatch(/\.in\("role", \["club_admin", "app_admin"\]\)/);
    expect(fn).toMatch(/auth\.admin\.createUser/);
  });
});

describe("club announcement dialog surfaces the server reason", () => {
  it("never discards the server error body inside a catch", () => {
    // The body is captured into a variable and thrown OUTSIDE the try.
    expect(dialog).toMatch(/serverMessage = String\(body\.error\)/);
    expect(dialog).toMatch(/throw new Error\(serverMessage \|\|/);
    expect(dialog).not.toMatch(/if \(body\?\.error\) throw new Error\(String\(body\.error\)\)/);
  });

  it("names the reason in the error toast", () => {
    expect(dialog).toMatch(/Couldn't send announcement: \$\{msg\}/);
  });

  it("validates the payload with zod before invoking", () => {
    expect(dialog).toMatch(/club_id: z\.string\(\)\.uuid\(\)/);
    expect(dialog).toMatch(/team_ids: z\.array\(z\.string\(\)\.uuid\(\)\)/);
    expect(dialog).toMatch(/message: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(4000\)/);
  });

  it("sends only live active team ids and keeps canSend in sync with them", () => {
    expect(dialog).toMatch(/resolvedTeamIds/);
    expect(dialog).toMatch(/activeTeamIds\.has\(id\)/);
    expect(dialog).toMatch(/team_ids: parsed\.data\.team_ids/);
    expect(dialog).toMatch(/resolvedTeamIds\.length > 0 \|\| sendToClubChat/);
  });

  it("prunes a stale selection when the team list changes", () => {
    expect(dialog).toMatch(/setSelectedTeamIds\(\(prev\) => \{\s*\n\s*const next = new Set\(\[\.\.\.prev\]\.filter/);
  });
});
