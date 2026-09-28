/**
 * Guards for the Android resume "zombie request" family of freezes.
 *
 * Symptom: after the app is backgrounded for a while, Schedule and Media come
 * back stuck on skeletons until a force-quit. Cause: PostgREST GETs that were
 * in flight at suspend never fail (their `setTimeout` abort timer is frozen by
 * the OS), so they hold connection slots forever and any query gated on them
 * never resolves.
 *
 * These are source-level guards — the pages are far too heavy to mount in
 * jsdom, and the runtime behaviour depends on OS timer freezing we can't
 * reproduce here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) =>
  readFileSync(path.resolve(__dirname, rel), "utf8");

const authRetry = read("../lib/supabaseAuthRetry.ts");
const adapter = read("../lib/reactQueryNativeAdapter.ts");
const ensureFresh = read("../lib/ensureFreshSession.ts");
const refreshSessionOnce = read("../lib/refreshSessionOnce.ts");
const eventsPage = read("../pages/EventsPage.tsx");
const mediaPage = read("../pages/MediaPage.tsx");

describe("supabaseAuthRetry wall-clock deadlines", () => {
  it("tracks in-flight REST GETs with a wall-clock deadline, not just a timer", () => {
    expect(authRetry).toMatch(/inFlightRestGets/);
    expect(authRetry).toMatch(/deadlineAt: Date\.now\(\) \+ REST_GET_TIMEOUT_MS/);
  });

  it("exports abort helpers for the resume path", () => {
    expect(authRetry).toMatch(/export function abortStaleRestGets/);
    expect(authRetry).toMatch(/export function abortAllInFlightRestGets/);
  });

  it("sweeps the registry on an interval so frozen timers can't hide dead requests", () => {
    expect(authRetry).toMatch(/setInterval\(/);
    expect(authRetry).toMatch(/abortStaleRestGets\("sweep"\)/);
  });

  it("removes entries from the registry on both success and failure", () => {
    const cleanups = authRetry.match(/cleanupRestGet\(\);/g) ?? [];
    expect(cleanups.length).toBeGreaterThanOrEqual(2);
  });
});

describe("native adapter aborts before refetching on resume", () => {
  it("imports the abort helper", () => {
    expect(adapter).toMatch(
      /import \{ abortAllInFlightRestGets \} from '@\/lib\/supabaseAuthRetry'/
    );
  });

  it("aborts zombies before handleFocus / recovery on app resume", () => {
    const abortIdx = adapter.indexOf("abortZombieRequests('app-resume')");
    const recoverIdx = adapter.indexOf("recoverErroredQueries('app-resume'");
    expect(abortIdx).toBeGreaterThan(-1);
    expect(recoverIdx).toBeGreaterThan(-1);
    expect(abortIdx).toBeLessThan(recoverIdx);
  });

  it("only aborts after a genuinely long background stint", () => {
    expect(adapter).toMatch(/LONG_BACKGROUND_MS/);
    expect(adapter).toMatch(/hiddenFor >= LONG_BACKGROUND_MS/);
  });
});

describe("ensureFreshSession is bounded even when hidden", () => {
  it("does not gate the timeout race on document visibility", () => {
    // The bounded race now lives in the shared single-flight helper
    // (refreshSessionOnce.ts) so every caller — not just ensureFreshSession —
    // gets the same Android-Doze-safe timeout. ensureFreshSession still
    // supplies the bound and never re-introduces a visibility gate.
    expect(ensureFresh).not.toMatch(/const isVisible/);
    expect(ensureFresh).toMatch(/REFRESH_TIMEOUT_MS/);
    expect(refreshSessionOnce).toMatch(/Promise\.race\(\[/);
  });
});

describe("page-level escape hatches", () => {
  it("Schedule watchdog aborts in-flight reads and repeats while stuck", () => {
    expect(eventsPage).toMatch(
      /abortAllInFlightRestGets\("schedule-watchdog"\)/
    );
    expect(eventsPage).toMatch(/setInterval\(kick, 6000\)/);
  });

  it("Media pro-access gate can time out instead of blocking forever", () => {
    expect(mediaPage).toMatch(/proGateTimedOut/);
    expect(mediaPage).toMatch(
      /abortAllInFlightRestGets\("media-pro-watchdog"\)/
    );
    expect(mediaPage).toMatch(
      /loadingProAccess && !proGateTimedOut/
    );
  });

  it("Media opts out of its own visibility listeners on native", () => {
    const listeners =
      mediaPage.match(/addEventListener\("visibilitychange"/g) ?? [];
    expect(listeners.length).toBe(2);
    const optOuts = mediaPage.match(/if \(isNativeRuntime\(\)\) return;/g) ?? [];
    expect(optOuts.length).toBeGreaterThanOrEqual(2);
  });
});
