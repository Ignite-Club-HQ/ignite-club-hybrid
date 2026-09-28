/**
 * Static guard for the iOS OS resume regression harness.
 *
 * The Simulator test itself runs on the macOS Codemagic workflow. This test
 * runs everywhere and protects the two properties that matter most:
 *
 *  1. The harness stays ISOLATED — no Supabase client/URL/key, no Firebase
 *     config, no signing config, no production bundle identifier.
 *  2. The `ios-os-resume-test` Codemagic workflow stays unsigned, unpublished
 *     and free of environment groups.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const APP_ID = "app.igniteclubhq.iososresumetest";

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

describe("ios-os harness — files", () => {
  it.each([
    "tests/ios-os/index.html",
    "tests/ios-os/main.ts",
    "tests/ios-os/supabaseAuthRetryStub.ts",
    "tests/ios-os/vite.config.ts",
    "tests/ios-os/verify-safety.mjs",
    "tests/ios-os/run-simulator-test.mjs",
    "tests/ios-os/resume.e2e.mjs",
    "tests/ios-os/appium.conf.mjs",
    "tests/ios-os/workspace/package.json",
    "tests/ios-os/workspace/capacitor.config.json",
  ])("%s exists", (f) => {
    expect(exists(f)).toBe(true);
  });

  it("exposes build and safety npm scripts", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["test:ios-os:build"]).toContain("verify-safety.mjs");
    expect(pkg.scripts["test:ios-os:build"]).toContain("tests/ios-os/vite.config.ts");
    expect(pkg.scripts["test:ios-os:safety"]).toContain("verify-safety.mjs");
  });

  it("ignores generated native files and web bundles", () => {
    const ignore = read("tests/ios-os/workspace/.gitignore");
    expect(ignore).toContain(".generated/");
    expect(ignore).toContain("www/");
  });
});

describe("ios-os harness — isolation", () => {
  const cap = JSON.parse(read("tests/ios-os/workspace/capacitor.config.json"));

  it("uses the isolated bundle identifier", () => {
    expect(cap.appId).toBe(APP_ID);
    expect(cap.appName).toBe("Ignite iOS OS Test");
    expect(cap.webDir).toBe("www");
  });

  it("keeps the generated path disposable", () => {
    expect(cap.ios.path).toBe(".generated/ios");
  });

  it("has no hosted content or server URL", () => {
    expect(cap.server?.url).toBeUndefined();
    const files = ["tests/ios-os/main.ts", "tests/ios-os/index.html", "tests/ios-os/vite.config.ts"];
    for (const f of files) {
      expect(read(f)).not.toMatch(/supabase\.co/);
      expect(read(f)).not.toMatch(/postgres(ql)?:\/\//);
      expect(read(f)).not.toMatch(/integrations\/supabase/);
      expect(read(f)).not.toMatch(/createClient/);
    }
  });

  it("does not reuse a real bundle identifier", () => {
    const prod = read("capacitor.config.ts");
    const ids = [...prod.matchAll(/['"]((?:app|com)\.[A-Za-z0-9._-]+)['"]/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain(APP_ID);
  });

  it("declares only the minimum Capacitor plugins", () => {
    const wsPkg = JSON.parse(read("tests/ios-os/workspace/package.json"));
    expect(Object.keys(wsPkg.dependencies).sort()).toEqual([
      "@capacitor/app",
      "@capacitor/network",
    ]);
  });

  it("ships no Firebase or push configuration", () => {
    expect(exists("tests/ios-os/workspace/GoogleService-Info.plist")).toBe(false);
    expect(exists("tests/ios-os/workspace/google-services.json")).toBe(false);
    expect(read("tests/ios-os/main.ts")).not.toMatch(/push-notifications|firebase/i);
  });

  it("aliases supabaseAuthRetry to a stub and compiles Supabase env out", () => {
    const cfg = read("tests/ios-os/vite.config.ts");
    expect(cfg).toContain("supabaseAuthRetryStub");
    expect(cfg).toContain('"import.meta.env.VITE_SUPABASE_URL": "undefined"');
  });

  it("exercises the real production resume modules", () => {
    const main = read("tests/ios-os/main.ts");
    expect(main).toContain("@/lib/reactQueryNativeAdapter");
    expect(main).toContain("setupReactQueryNativeAdapter");
    expect(main).toContain("@/lib/androidWebViewWake");
    expect(main).toContain("setupWebViewWake");
  });

  it("mounts 30 observers split 18 inbox / 6 schedule / 6 media", () => {
    const main = read("tests/ios-os/main.ts");
    expect(main).toContain('{ name: "inbox", count: 18 }');
    expect(main).toContain('{ name: "schedule", count: 6 }');
    expect(main).toContain('{ name: "media", count: 6 }');
  });

  it("emits the machine-readable state contract", () => {
    const main = read("tests/ios-os/main.ts");
    for (const key of [
      "IOS_OS_READY",
      "ACTIVE=",
      "REFETCH_COUNT=",
      "ONLINE=",
      "RESUME_COUNT=",
      "BACKGROUND_COUNT=",
      "PING_COUNT=",
      "[IOS_OS_TEST_STATE]",
    ]) {
      expect(main).toContain(key);
    }
    expect(read("tests/ios-os/index.html")).toContain('aria-label="PING"');
  });
});

describe("ios-os harness — safety verifier", () => {
  const safety = read("tests/ios-os/verify-safety.mjs");

  it.each(["SUPABASE", "VITE_SUPABASE", "DATABASE_URL", "PGPASSWORD"])(
    "fails when %s is present",
    (v) => expect(safety).toContain(v),
  );

  it("scans built output for hosted database URLs", () => {
    expect(safety).toContain("supabase.co");
    expect(safety).toContain("postgres://");
  });

  it("rejects signing identities, profiles and store credentials", () => {
    expect(safety).toContain("DEVELOPMENT_TEAM");
    expect(safety).toContain("PROVISIONING_PROFILE_SPECIFIER");
    expect(safety).toContain("CODE_SIGN_IDENTITY");
    expect(safety).toContain("APP_STORE_CONNECT_PRIVATE_KEY");
  });
});

describe("ios-os harness — assertions retained", () => {
  const e2e = read("tests/ios-os/resume.e2e.mjs");

  it("keeps warm-resume assertions", () => {
    expect(e2e).toContain("ordinary online warm resume");
    expect(e2e).toContain("driver.background");
    expect(e2e).not.toMatch(/driver\.(terminateApp|launchApp|reset)\(/);
  });

  it("keeps five-cycle protection", () => {
    expect(e2e).toContain("five repeated online resumes");
    expect(e2e).toMatch(/i <= 5/);
  });

  it("keeps long-background protection", () => {
    expect(e2e).toContain("longer background interval");
    expect(e2e).toContain("backgroundAndResume(28)");
  });

  it("keeps PING responsiveness assertions", () => {
    expect(e2e).toContain("PING still responsive after resume");
  });

  it("keeps crash / WKWebView failure detection", () => {
    expect(e2e).toContain("queryAppState");
    expect(e2e).toContain("crash or termination");
  });
});

describe("ios-os-resume-test codemagic workflow", () => {
  const yaml = read("codemagic.yaml");
  const start = yaml.indexOf("\n  ios-os-resume-test:");
  const rest = yaml.slice(start + 1);
  const nextWorkflow = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/);
  const block = nextWorkflow === -1 ? rest : rest.slice(0, nextWorkflow + 1);

  it("exists as a top-level workflow", () => {
    expect(start).toBeGreaterThan(-1);
  });

  it("is configured as specified", () => {
    expect(block).toContain("name: Actual iOS Simulator resume regression");
    expect(block).toContain("instance_type: mac_mini_m2");
    expect(block).toContain("max_build_duration: 35");
    expect(block).toContain("cancel_previous_builds: true");
    expect(block).toContain("codespaces-review");
  });

  it("has no environment groups, signing, integrations or publishing", () => {
    expect(block).not.toMatch(/^\s+groups:/m);
    expect(block).not.toMatch(/^\s+publishing:/m);
    expect(block).not.toMatch(/^\s+integrations:/m);
    expect(block).not.toMatch(/ios_signing/);
    expect(block).not.toMatch(/app_store_connect/);
  });

  it("runs the safety guard before building", () => {
    const safetyIdx = block.indexOf("tests/ios-os/verify-safety.mjs");
    const buildIdx = block.indexOf("test:ios-os:build");
    expect(safetyIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(safetyIdx);
  });

  it("runs the harness guard test and the simulator suite", () => {
    expect(block).toContain("src/test/iosOsHarness.guard.test.ts");
    expect(block).toContain("tests/ios-os/run-simulator-test.mjs");
  });

  it("never archives, signs or exports an IPA", () => {
    expect(block).not.toContain("archive");
    expect(block).not.toContain(".ipa");
    expect(block).toContain("CODE_SIGNING_ALLOWED=NO");
    expect(block).toContain(APP_ID);
  });

  it("collects the required artifacts", () => {
    expect(block).toContain("test-results/ios-os/**");
  });

  it("leaves the existing dev/prod workflows untouched", () => {
    for (const wf of [
      "android-debug-workflow:",
      "ios-debug-workflow:",
      "ios-workflow:",
      "android-workflow:",
      "android-os-resume-test:",
    ]) {
      expect(yaml).toContain(wf);
    }
  });
});
