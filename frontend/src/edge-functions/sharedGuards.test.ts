/**
 * Regression tests for shared Edge Function Pro guards.
 *
 * Verifies fail-closed behavior of `requireClubPro`, `requireTeamPro`, and
 * `requireAnyClubPro`. In particular:
 *   - Missing scope identifiers → 400 with the specific error code.
 *   - RPC returns `data === true`, no error → null (access granted).
 *   - RPC returns any other data (false, null, undefined, numeric, string,
 *     object, or `true` accompanied by an error) → 403 pro_required.
 *   - RPC returns an error object → 500 pro_check_failed.
 *   - RPC promise rejects (network / runtime / transport failure) → 500
 *     pro_check_failed (fail-closed).
 *   - CORS headers preserved on every response.
 *   - JSON content type on every response.
 *   - Client responses never leak exception messages, DB internals, URLs,
 *     tokens, or stack info.
 *   - Exact RPC arguments are passed through unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import {
  requireClubPro,
  requireTeamPro,
  requireAnyClubPro,
} from "../../supabase/functions/_shared/proGuard.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function makeSupabase(rpc: (name: string, args: unknown) => unknown) {
  return { rpc: vi.fn(rpc) };
}

async function readBody(r: Response): Promise<unknown> {
  return JSON.parse(await r.text());
}

function assertCommonHeaders(r: Response) {
  expect(r.headers.get("Content-Type")).toBe("application/json");
  expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(r.headers.get("Access-Control-Allow-Headers")).toBe("authorization, content-type");
}

// A grab-bag of "not exactly true" values the RPC could return.
const NON_TRUE_DATA: Array<[string, unknown]> = [
  ["boolean false", false],
  ["null", null],
  ["undefined", undefined],
  ["number 1", 1],
  ["number 0", 0],
  ["string 'true'", "true"],
  ["object", { granted: true }],
  ["array", [true]],
];

// ---- requireClubPro -----------------------------------------------------

describe("requireClubPro", () => {
  it("returns 400 missing_club_id when clubId is empty", async () => {
    const supabase = makeSupabase(() => ({ data: true, error: null }));
    const res = await requireClubPro(supabase, "", CORS);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    assertCommonHeaders(res!);
    expect(await readBody(res!)).toEqual({ error: "missing_club_id" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns null on successful exact boolean true", async () => {
    const supabase = makeSupabase(() => ({ data: true, error: null }));
    const res = await requireClubPro(supabase, "club-1", CORS);
    expect(res).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith("has_active_pro_for_club", { _club_id: "club-1" });
  });

  it.each(NON_TRUE_DATA)("returns 403 pro_required when data is %s", async (_label, data) => {
    const supabase = makeSupabase(() => ({ data, error: null }));
    const res = await requireClubPro(supabase, "club-2", CORS);
    expect(res!.status).toBe(403);
    assertCommonHeaders(res!);
    expect(await readBody(res!)).toEqual({ error: "pro_required", club_id: "club-2" });
  });

  it("returns 403 pro_required when data is true but the response omits club_id? no — the guard forwards the club_id", async () => {
    const supabase = makeSupabase(() => ({ data: false, error: null }));
    const res = await requireClubPro(supabase, "club-abc", CORS);
    expect(await readBody(res!)).toEqual({ error: "pro_required", club_id: "club-abc" });
  });

  it("returns 500 pro_check_failed when the RPC returns an error even alongside data:true", async () => {
    const supabase = makeSupabase(() => ({ data: true, error: { message: "db down" } }));
    const res = await requireClubPro(supabase, "club-3", CORS);
    expect(res!.status).toBe(500);
    assertCommonHeaders(res!);
    expect(await readBody(res!)).toEqual({ error: "pro_check_failed" });
  });

  it("returns 500 pro_check_failed when the RPC returns an error object", async () => {
    const supabase = makeSupabase(() => ({ data: null, error: { code: "PGRST" } }));
    const res = await requireClubPro(supabase, "club-4", CORS);
    expect(res!.status).toBe(500);
    expect(await readBody(res!)).toEqual({ error: "pro_check_failed" });
  });

  it("must convert a thrown club entitlement lookup into a safe denial response", async () => {
    const supabase = makeSupabase(() => {
      throw new Error("internal: postgres://user:secret@host/db failed: token=abc123\n at foo:42");
    });
    const res = await requireClubPro(supabase, "club-5", CORS);
    expect(res!.status).toBe(500);
    assertCommonHeaders(res!);
    const body = await readBody(res!);
    expect(body).toEqual({ error: "pro_check_failed" });
    // Never leak exception detail into the client response.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("postgres");
    expect(raw).not.toContain("secret");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("foo:42");
  });

  it("converts a rejected RPC promise (async transport failure) into 500 pro_check_failed", async () => {
    const supabase = {
      rpc: vi.fn(() => Promise.reject(new Error("fetch failed"))),
    };
    const res = await requireClubPro(supabase, "club-6", CORS);
    expect(res!.status).toBe(500);
    expect(await readBody(res!)).toEqual({ error: "pro_check_failed" });
  });
});

// ---- requireTeamPro -----------------------------------------------------

describe("requireTeamPro", () => {
  it("returns 400 missing_team_id when teamId is empty", async () => {
    const supabase = makeSupabase(() => ({ data: true, error: null }));
    const res = await requireTeamPro(supabase, "", CORS);
    expect(res!.status).toBe(400);
    assertCommonHeaders(res!);
    expect(await readBody(res!)).toEqual({ error: "missing_team_id" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns null on successful exact boolean true", async () => {
    const supabase = makeSupabase(() => ({ data: true, error: null }));
    const res = await requireTeamPro(supabase, "team-1", CORS);
    expect(res).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith("has_active_pro_for_team", { _team_id: "team-1" });
  });

  it.each(NON_TRUE_DATA)("returns 403 pro_required when data is %s", async (_label, data) => {
    const supabase = makeSupabase(() => ({ data, error: null }));
    const res = await requireTeamPro(supabase, "team-2", CORS);
    expect(res!.status).toBe(403);
    expect(await readBody(res!)).toEqual({ error: "pro_required", team_id: "team-2" });
  });

  it("returns 500 pro_check_failed when the RPC returns an error object", async () => {
    const supabase = makeSupabase(() => ({ data: null, error: { code: "PGRST" } }));
    const res = await requireTeamPro(supabase, "team-3", CORS);
    expect(res!.status).toBe(500);
    expect(await readBody(res!)).toEqual({ error: "pro_check_failed" });
  });

  it("must convert a thrown team entitlement lookup into a safe denial response", async () => {
    const supabase = makeSupabase(() => {
      throw new Error("boom: bearer=xyz");
    });
    const res = await requireTeamPro(supabase, "team-4", CORS);
    expect(res!.status).toBe(500);
    assertCommonHeaders(res!);
    const body = await readBody(res!);
    expect(body).toEqual({ error: "pro_check_failed" });
    expect(JSON.stringify(body)).not.toContain("bearer");
  });

  it("converts a rejected RPC promise into 500 pro_check_failed", async () => {
    const supabase = { rpc: vi.fn(() => Promise.reject("network")) };
    const res = await requireTeamPro(supabase, "team-5", CORS);
    expect(res!.status).toBe(500);
    expect(await readBody(res!)).toEqual({ error: "pro_check_failed" });
  });
});

// ---- requireAnyClubPro --------------------------------------------------

describe("requireAnyClubPro", () => {
  it("returns 400 missing_user_id when userId is empty", async () => {
    const supabase = makeSupabase(() => ({ data: true, error: null }));
    const res = await requireAnyClubPro(supabase, "", CORS);
    expect(res!.status).toBe(400);
    assertCommonHeaders(res!);
    expect(await readBody(res!)).toEqual({ error: "missing_user_id" });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns null on successful exact boolean true", async () => {
    const supabase = makeSupabase(() => ({ data: true, error: null }));
    const res = await requireAnyClubPro(supabase, "user-1", CORS);
    expect(res).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledWith("user_has_any_club_pro", { _user_id: "user-1" });
  });

  it.each(NON_TRUE_DATA)("returns 403 pro_required when data is %s (no scope in body)", async (_label, data) => {
    const supabase = makeSupabase(() => ({ data, error: null }));
    const res = await requireAnyClubPro(supabase, "user-2", CORS);
    expect(res!.status).toBe(403);
    expect(await readBody(res!)).toEqual({ error: "pro_required" });
  });

  it("returns 500 pro_check_failed when the RPC returns an error object", async () => {
    const supabase = makeSupabase(() => ({ data: null, error: { code: "PGRST" } }));
    const res = await requireAnyClubPro(supabase, "user-3", CORS);
    expect(res!.status).toBe(500);
    expect(await readBody(res!)).toEqual({ error: "pro_check_failed" });
  });

  it("must convert a thrown any-club entitlement lookup into a safe denial response", async () => {
    const supabase = makeSupabase(() => {
      throw new Error("SUPABASE_URL=https://reference.invalid secret=abc");
    });
    const res = await requireAnyClubPro(supabase, "user-4", CORS);
    expect(res!.status).toBe(500);
    assertCommonHeaders(res!);
    const body = await readBody(res!);
    expect(body).toEqual({ error: "pro_check_failed" });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("supabase.co");
    expect(raw).not.toContain("secret");
  });

  it("converts a rejected RPC promise into 500 pro_check_failed", async () => {
    const supabase = { rpc: vi.fn(() => Promise.reject(new Error("EAI_AGAIN"))) };
    const res = await requireAnyClubPro(supabase, "user-5", CORS);
    expect(res!.status).toBe(500);
    expect(await readBody(res!)).toEqual({ error: "pro_check_failed" });
  });
});
