/**
 * Static guard for the Android OS resume regression harness.
 *
 * The emulator test itself runs in CI. This test runs everywhere and protects
 * the two properties that matter most:
 *
 *  1. The harness stays ISOLATED — no Supabase client, URL, key, Firebase
 *     config, signing config or production package ID can creep in.
 *  2. The `android-os-resume-test` Codemagic workflow stays unsigned,
 *     unpublished and free of environment groups.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HARNESS = path.join(ROOT, "tests", "android-os");
const APP_ID = "app.igniteclubhq.androidosresumetest";

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe("android-os harness — files", () => {
  it.each([
    "tests/android-os/app/index.html",
    "tests/android-os/app/main.ts",
    "tests/android-os/app/supabaseAuthRetryStub.ts",
    "tests/android-os/vite.config.ts",
    "tests/android-os/verify-safety.mjs",
    "tests/android-os/run-emulator-test.sh",
    "tests/android-os/workspace/capacitor.config.json",
  ])("%s exists", (f) => {
    expect(exists(f)).toBe(true);
  });

  it("exposes build and safety npm scripts", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["test:android-os:build"]).toContain("tests/android-os/vite.config.ts");
    expect(pkg.scripts["test:android-os:safety"]).toContain("verify-safety.mjs");
  });
});

describe("android-os harness — isolation", () => {
  const capConfig = JSON.parse(read("tests/android-os/workspace/capacitor.config.json"));

  it("uses the disposable package id", () => {
    expect(capConfig.appId).toBe(APP_ID);
  });

  it("does not point at a live reload server", () => {
    expect(capConfig.server?.url).toBeUndefined();
  });

  it("does not reuse the production application id", () => {
    const prod = read("capacitor.config.ts");
    const prodId =
      /appId:\s*['"]([^'"]+)['"]/.exec(prod)?.[1] ??
      /APP_ID\s*=\s*['"]([^'"]+)['"]/.exec(prod)?.[1];
    expect(prodId).toBeDefined();
    expect(capConfig.appId).not.toBe(prodId);
  });


  it("declares only the @capacitor/app and @capacitor/network plugins", () => {
    const wsPkg = JSON.parse(read("tests/android-os/workspace/package.json"));
    expect(Object.keys(wsPkg.dependencies).sort()).toEqual([
      "@capacitor/app",
      "@capacitor/network",
    ]);
  });

  it("never imports the Supabase client anywhere in the harness app", () => {
    const files = fs
      .readdirSync(path.join(HARNESS, "app"))
      .filter((f) => /\.(ts|html)$/.test(f))
      .map((f) => fs.readFileSync(path.join(HARNESS, "app", f), "utf8"));
    for (const text of files) {
      expect(text).not.toMatch(/integrations\/supabase/);
      expect(text).not.toMatch(/supabase\.co/);
      expect(text).not.toMatch(/createClient/);
    }
  });

  it("aliases supabaseAuthRetry to a local stub and compiles Supabase env out", () => {
    const cfg = read("tests/android-os/vite.config.ts");
    expect(cfg).toMatch(/supabaseAuthRetry\$?/);
    expect(cfg).toContain("supabaseAuthRetryStub");
    expect(cfg).toContain('"import.meta.env.VITE_SUPABASE_URL": "undefined"');
  });

  it("uses the real production adapter under test", () => {
    const main = read("tests/android-os/app/main.ts");
    expect(main).toContain("@/lib/reactQueryNativeAdapter");
    expect(main).toContain("setupReactQueryNativeAdapter");
  });

  it("mounts 30 synthetic observers", () => {
    expect(read("tests/android-os/app/main.ts")).toContain("const OBSERVER_COUNT = 30");
  });

  it("ships no Firebase configuration in the workspace", () => {
    expect(exists("tests/android-os/workspace/google-services.json")).toBe(false);
    expect(exists("tests/android-os/workspace/GoogleService-Info.plist")).toBe(false);
  });
});

describe("android-os harness — safety verifier", () => {
  const safety = read("tests/android-os/verify-safety.mjs");

  it.each(["SUPABASE", "VITE_SUPABASE", "DATABASE_URL", "PGPASSWORD"])(
    "fails the build when %s is present",
    (v) => {
      expect(safety).toContain(v);
    },
  );

  it("scans built output for Supabase and database references", () => {
    expect(safety).toContain("supabase.co");
    expect(safety).toContain("postgres://");
  });

  it("rejects signing configuration and store credentials", () => {
    expect(safety).toContain("signingConfigs");
    expect(safety).toContain("CM_KEYSTORE");
  });
});

describe("android-os-resume-test codemagic workflow", () => {
  const yaml = read("codemagic.yaml");
  const start = yaml.indexOf("\n  android-os-resume-test:");
  const rest = yaml.slice(start + 1);
  const nextWorkflow = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const block = nextWorkflow === -1 ? rest : rest.slice(0, nextWorkflow + 1);

  it("exists as a top-level workflow", () => {
    expect(start).toBeGreaterThan(-1);
  });

  it("is configured as specified", () => {
    expect(block).toContain("name: Actual Android OS resume regression");
    expect(block).toContain("instance_type: linux_x2");
    expect(block).toContain("max_build_duration: 35");
    expect(block).toContain("cancel_previous_builds: true");
    expect(block).toContain("codespaces-review");
  });

  it("has no environment groups", () => {
    expect(block).not.toMatch(/^\s+groups:/m);
  });

  it("has no publishing section and no signing", () => {
    expect(block).not.toMatch(/^\s+publishing:/m);
    expect(block).not.toMatch(/android_signing/);
    expect(block).not.toMatch(/google_play/);
    expect(block).not.toMatch(/app_store_connect/);
  });

  it("runs the safety guard before anything else", () => {
    const safetyIdx = block.indexOf("verify-safety.mjs");
    const buildIdx = block.indexOf("test:android-os:build");
    expect(safetyIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(safetyIdx);
  });

  it("runs the harness guard test and the emulator script", () => {
    expect(block).toContain("src/test/androidOsHarness.guard.test.ts");
    expect(block).toContain("tests/android-os/run-emulator-test.sh");
  });

  it("only ever builds the isolated debug APK", () => {
    expect(block).toContain("assembleDebug");
    expect(block).not.toContain("assembleRelease");
    expect(block).not.toContain("bundleRelease");
    expect(block).toContain(APP_ID);
  });

  it("collects the required artifacts", () => {
    expect(block).toContain("test-results/android-os/**");
    expect(block).toContain(
      "tests/android-os/workspace/.generated/android/app/build/reports/**",
    );
    expect(block).toContain(
      "tests/android-os/workspace/.generated/android/app/build/outputs/apk/debug/app-debug.apk",
    );
  });

  it("leaves the existing dev/prod workflows untouched", () => {
    for (const wf of [
      "android-debug-workflow:",
      "ios-debug-workflow:",
      "ios-workflow:",
      "android-workflow:",
    ]) {
      expect(yaml).toContain(wf);
    }
  });
});
