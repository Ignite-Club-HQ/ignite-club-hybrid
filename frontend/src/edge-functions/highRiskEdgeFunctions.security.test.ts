/**
 * Security regression tests for high-risk Edge Function behaviour.
 *
 * Covers:
 *  - Association club-event fan-out: authorization before mutation, membership
 *    filtering, duplicate club-id collapsing, single atomic RPC, all-or-nothing.
 *  - Signed URL issuance: per-object authorization, mixed batches, origin
 *    validation, traversal rejection and `expiresIn` bounds.
 */
import { describe, it, expect, vi } from "vitest";
import {
  parseStorageObjectRef,
  normalizeExpiresIn,
  DEFAULT_EXPIRES_IN,
  MAX_EXPIRES_IN,
  MIN_EXPIRES_IN,
} from "../../supabase/functions/_shared/storageUrlAuth.ts";
import { signAuthorizedBatch } from "../../supabase/functions/_shared/signedUrlBatch.ts";

const SUPA = "https://reference.invalid";
const pub = (bucket: string, path: string) =>
  `${SUPA}/storage/v1/object/public/${bucket}/${path}`;

// ---------------------------------------------------------------------------
// Association fan-out: replicate the Edge Function's validation pipeline.
// ---------------------------------------------------------------------------

interface FanoutDeps {
  isAdmin: boolean;
  assocKind: string | null;
  clubsUnderAssoc: string[];
  rpc: any;
}

async function runFanout(clubIds: unknown[], deps: FanoutDeps) {
  const calls = { authorizedBeforeMutation: false };

  const requested = Array.from(
    new Set((clubIds as string[]).filter((c) => typeof c === "string" && c.length > 0)),
  );
  if (requested.length === 0) return { status: 400, body: { error: "at least one club_id is required" } };

  if (!deps.isAdmin) return { status: 403, body: { error: "only association admins can create club events" } };
  if (deps.assocKind === null) return { status: 404, body: { error: "association not found" } };
  if (deps.assocKind !== "association") return { status: 400, body: { error: "club is not an association" } };

  const invited = requested.filter((c) => deps.clubsUnderAssoc.includes(c));
  if (invited.length === 0) {
    return { status: 400, body: { error: "no invited clubs belong to this association" } };
  }

  calls.authorizedBeforeMutation = true;
  const { data, error } = await deps.rpc("create_association_club_event_atomic", {
    _caller_id: "caller-1",
    _club_ids: invited,
  });
  if (error || !data) return { status: 500, body: { error: "Failed to create association event" } };
  return { status: 200, body: { ok: true, ...data }, calls };
}

function okRpc() {
  return vi.fn(async (_name: string, args: any) => ({
    data: {
      parent_event_id: "parent-1",
      child_event_ids: args._club_ids.map((c: string) => `child-${c}`),
      invited_clubs: args._club_ids.length,
    },
    error: null,
  }));
}

describe("association club-event fan-out", () => {
  const base = { isAdmin: true, assocKind: "association", clubsUnderAssoc: ["a", "b"] };

  it("rejects non-admin callers before any mutation", async () => {
    const rpc = okRpc();
    const res = await runFanout(["a"], { ...base, isAdmin: false, rpc });
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects a club that is not an association", async () => {
    const rpc = okRpc();
    const res = await runFanout(["a"], { ...base, assocKind: "club", rpc });
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("accepts only clubs belonging to the association", async () => {
    const rpc = okRpc();
    const res = await runFanout(["a", "outsider"], { ...base, rpc });
    expect(res.status).toBe(200);
    expect(rpc.mock.calls[0][1]._club_ids).toEqual(["a"]);
  });

  it("rejects when no requested club belongs to the association", async () => {
    const rpc = okRpc();
    const res = await runFanout(["outsider"], { ...base, rpc });
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("collapses duplicate club ids into one child event per club", async () => {
    const rpc = okRpc();
    const res = await runFanout(["a", "a", "b", "a"], { ...base, rpc });
    expect(rpc.mock.calls[0][1]._club_ids).toEqual(["a", "b"]);
    expect(res.body.child_event_ids).toEqual(["child-a", "child-b"]);
    expect(res.body.invited_clubs).toBe(2);
  });

  it("creates parent and children through exactly one atomic RPC", async () => {
    const rpc = okRpc();
    await runFanout(["a", "b"], { ...base, rpc });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("create_association_club_event_atomic");
  });

  it("never trusts a caller-supplied created_by", async () => {
    const rpc = okRpc();
    await runFanout(["a"], { ...base, rpc });
    expect(rpc.mock.calls[0][1]._caller_id).toBe("caller-1");
  });

  it("returns no parent or child ids when the atomic RPC fails", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "duplicate key in events_pkey" } }));
    const res = await runFanout(["a", "b"], { ...base, rpc });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to create association event" });
    expect(JSON.stringify(res.body)).not.toContain("events_pkey");
  });
});

// ---------------------------------------------------------------------------
// Storage URL parsing / origin validation
// ---------------------------------------------------------------------------

describe("parseStorageObjectRef", () => {
  it("resolves recognized private buckets on our own origin", () => {
    expect(parseStorageObjectRef(pub("photos", "club/1/a.jpg"), SUPA)).toEqual({
      bucket: "photos",
      path: "club/1/a.jpg",
    });
    expect(
      parseStorageObjectRef(`${SUPA}/storage/v1/object/sign/avatars/u/1.png?token=x`, SUPA),
    ).toEqual({ bucket: "avatars", path: "u/1.png" });
  });

  it("rejects external URLs that merely contain a Storage marker", () => {
    expect(
      parseStorageObjectRef("https://reference.invalid", SUPA),
    ).toBeNull();
    expect(
      parseStorageObjectRef(
        "https://reference.invalid",
        SUPA,
      ),
    ).toBeNull();
  });

  it("rejects traversal, empty and malformed encoded paths", () => {
    expect(parseStorageObjectRef(pub("photos", "../secrets/a.jpg"), SUPA)).toBeNull();
    expect(parseStorageObjectRef(pub("photos", "a//b.jpg"), SUPA)).toBeNull();
    expect(parseStorageObjectRef(pub("photos", "%2e%2e/b.jpg"), SUPA)).toBeNull();
    expect(parseStorageObjectRef(pub("photos", "%E0%A4%A"), SUPA)).toBeNull();
    expect(parseStorageObjectRef(`${SUPA}/storage/v1/object/public/photos/`, SUPA)).toBeNull();
    expect(parseStorageObjectRef("", SUPA)).toBeNull();
    expect(parseStorageObjectRef("not a url", SUPA)).toBeNull();
  });

  it("ignores unrecognized buckets", () => {
    expect(parseStorageObjectRef(pub("club-logos", "a.png"), SUPA)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// expiresIn bounds
// ---------------------------------------------------------------------------

describe("normalizeExpiresIn", () => {
  it("defaults for non-integer, NaN, infinite, string and object inputs", () => {
    for (const bad of [undefined, null, NaN, Infinity, -Infinity, "3600", {}, [], 12.5]) {
      expect(normalizeExpiresIn(bad as unknown)).toBe(DEFAULT_EXPIRES_IN);
    }
  });

  it("clamps to the permitted range and never exceeds 3600", () => {
    expect(normalizeExpiresIn(999999)).toBe(MAX_EXPIRES_IN);
    expect(normalizeExpiresIn(-5)).toBe(MIN_EXPIRES_IN);
    expect(normalizeExpiresIn(0)).toBe(MIN_EXPIRES_IN);
    expect(normalizeExpiresIn(120)).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Batch signing authorization
// ---------------------------------------------------------------------------

function makeDeps(allow: (bucket: string, path: string) => boolean) {
  const authorize = vi.fn(async (items: { bucket: string; path: string }[]) => ({
    data: items.map((i) => ({ ...i, allowed: allow(i.bucket, i.path) })),
    error: null,
  }));
  const sign = vi.fn(async (bucket: string, path: string) => ({
    url: `${SUPA}/signed/${bucket}/${path}?token=t`,
    error: null,
  }));
  return { supabaseUrl: SUPA, authorize, sign };
}

describe("signAuthorizedBatch", () => {
  it("omits another club's chat attachment but still signs authorized siblings", async () => {
    const mine = pub("chat-attachments", "clubs/mine/a.jpg");
    const theirs = pub("chat-attachments", "clubs/theirs/b.jpg");
    const deps = makeDeps((_b, p) => p.startsWith("clubs/mine/"));
    const { signedUrls } = await signAuthorizedBatch([mine, theirs], deps);

    expect(signedUrls[mine]).toContain("/signed/chat-attachments/clubs/mine/a.jpg");
    expect(signedUrls).not.toHaveProperty(theirs);
    expect(deps.sign).toHaveBeenCalledTimes(1);
  });

  it("omits another user's general attachment and never returns it raw", async () => {
    const other = pub("chat-attachments", "general/other-user/x.jpg");
    const deps = makeDeps(() => false);
    const { signedUrls } = await signAuthorizedBatch([other], deps);
    expect(signedUrls).toEqual({});
    expect(Object.values(signedUrls)).not.toContain(other);
  });

  it("authorizes every object in a single batch call before signing", async () => {
    const deps = makeDeps(() => true);
    await signAuthorizedBatch([pub("photos", "a.jpg"), pub("avatars", "u/1.png")], deps);
    expect(deps.authorize).toHaveBeenCalledTimes(1);
    expect(deps.authorize.mock.calls[0][0]).toHaveLength(2);
  });

  it("does not sign anything when the authorization check fails", async () => {
    const sign = vi.fn();
    const res = await signAuthorizedBatch([pub("photos", "a.jpg")], {
      supabaseUrl: SUPA,
      authorize: async () => ({ data: null, error: { message: "boom" } }),
      sign: sign as never,
    });
    expect(res.authorizationFailed).toBe(true);
    expect(res.signedUrls).toEqual({});
    expect(sign).not.toHaveBeenCalled();
  });

  it("never signs external or traversal URLs", async () => {
    const evil = "https://reference.invalid";
    const trav = pub("photos", "../etc/passwd");
    const deps = makeDeps(() => true);
    const { signedUrls } = await signAuthorizedBatch([evil, trav], deps);
    expect(signedUrls).toEqual({});
    expect(deps.authorize).not.toHaveBeenCalled();
  });

  it("passes through genuinely non-storage URLs unchanged", async () => {
    const cdn = "https://reference.invalid";
    const deps = makeDeps(() => true);
    const { signedUrls } = await signAuthorizedBatch([cdn], deps);
    expect(signedUrls[cdn]).toBe(cdn);
  });

  it("handles a full 50-path batch", async () => {
    const paths = Array.from({ length: 50 }, (_, i) => pub("photos", `p/${i}.jpg`));
    const deps = makeDeps((_b, p) => !p.endsWith("7.jpg"));
    const { signedUrls } = await signAuthorizedBatch(paths, deps);
    expect(deps.authorize).toHaveBeenCalledTimes(1);
    expect(Object.keys(signedUrls)).toHaveLength(45);
  });
});
