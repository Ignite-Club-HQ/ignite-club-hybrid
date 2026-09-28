import { expect, test } from "vitest";
import { resolvePitchBoardRestore } from "../src/lab/componentCandidatePolicies";

const recent = 1_000;

test("preserves cold-start restoration of the exact board route and query", () => {
  expect(resolvePitchBoardRestore({
    currentPath: "/messages",
    storedPath: "/events/event-1?tab=attendance",
    open: true,
    openedAt: recent,
    now: recent + 1,
    mounted: false,
    restoreWindowOpen: true,
  })).toEqual({
    navigateTo: "/events/event-1?tab=attendance&openPitchBoard=1",
    clearMarker: true,
  });
  expect(resolvePitchBoardRestore({
    currentPath: "/",
    storedPath: "/teams/team-1?from=game-day",
    open: true,
    openedAt: recent,
    now: recent + 1,
    mounted: false,
    restoreWindowOpen: true,
  }).navigateTo).toBe("/teams/team-1?from=game-day&openPitchBoard=1");
});

test("preserves authentication-route protection, mounted no-op, and home overlay ownership", () => {
  const base = {
    storedPath: "/events/event-1",
    open: true,
    openedAt: recent,
    now: recent + 1,
    restoreWindowOpen: true,
  };
  expect(resolvePitchBoardRestore({ ...base, currentPath: "/auth", mounted: false }))
    .toEqual({ navigateTo: null, clearMarker: false });
  expect(resolvePitchBoardRestore({ ...base, currentPath: "/", mounted: true }))
    .toEqual({ navigateTo: null, clearMarker: false });
  expect(resolvePitchBoardRestore({
    ...base,
    currentPath: "/",
    storedPath: "/",
    mounted: false,
  })).toEqual({ navigateTo: null, clearMarker: false });
  expect(resolvePitchBoardRestore({
    ...base,
    currentPath: "/events/event-1?openPitchBoard=1",
    mounted: false,
  })).toEqual({ navigateTo: null, clearMarker: false });
});

test("self-heals stale or missing open markers instead of restoring them", () => {
  expect(resolvePitchBoardRestore({
    currentPath: "/messages",
    storedPath: "/events/event-1",
    open: true,
    openedAt: recent - 12 * 60 * 60 * 1000,
    now: recent,
    mounted: false,
    restoreWindowOpen: true,
  })).toEqual({ navigateTo: null, clearMarker: true });
  expect(resolvePitchBoardRestore({
    currentPath: "/messages",
    storedPath: "/events/event-1",
    open: true,
    openedAt: null,
    now: recent,
    mounted: false,
    restoreWindowOpen: true,
  })).toEqual({ navigateTo: null, clearMarker: true });
});

test("does not restore outside an explicit cold-start or resume window", () => {
  expect(resolvePitchBoardRestore({
    currentPath: "/",
    storedPath: "/events/event-1",
    open: true,
    openedAt: recent,
    now: recent + 1,
    mounted: false,
    restoreWindowOpen: false,
  })).toEqual({ navigateTo: null, clearMarker: false });
});
