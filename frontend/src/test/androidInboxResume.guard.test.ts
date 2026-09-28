/**
 * Guard: on native (Capacitor) platforms, MessagesPage must NOT run its own
 * six-query `visibilitychange` invalidation batch. `reactQueryNativeAdapter`
 * is the single owner of native foreground recovery — duplicating it caused
 * Android WebView main-thread saturation, leaving the inbox rendered but
 * unresponsive to row taps until the app was force-quit.
 *
 * Source-level guard (MessagesPage is far too heavy to mount in jsdom).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(
  path.resolve(__dirname, "../pages/MessagesPage.tsx"),
  "utf8"
);

describe("MessagesPage android resume guard", () => {
  it("has exactly one visibilitychange listener registration", () => {
    const matches = src.match(/addEventListener\(\s*['"]visibilitychange['"]/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("opts out of the visibility refresh batch on native before attaching the listener", () => {
    const refreshIdx = src.indexOf("const refreshPreviews = () => {");
    const listenerIdx = src.indexOf("addEventListener('visibilitychange'");
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(listenerIdx).toBeGreaterThan(refreshIdx);

    const between = src.slice(refreshIdx, listenerIdx);
    // Native early-return must sit between the mount refresh and the listener.
    expect(between).toMatch(/if \(isNativeRuntime\(\)\) return;/);
  });

  it("still reconciles the inbox once on mount", () => {
    const refreshIdx = src.indexOf("const refreshPreviews = () => {");
    const nativeIdx = src.indexOf("if (isNativeRuntime()) return;", refreshIdx);
    const between = src.slice(refreshIdx, nativeIdx);
    expect(between).toMatch(/refreshPreviews\(\);/);
  });

  it("keeps native platform detection using the project's Capacitor helper", () => {
    expect(src).toMatch(
      /const isNativeRuntime = \(\) => !!\(window as any\)\.Capacitor\?\.isNativePlatform\?\.\(\)/
    );
  });
});
