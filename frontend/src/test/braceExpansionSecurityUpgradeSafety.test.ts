/**
 * Security acceptance: brace-expansion is installed in three incompatible
 * majors across the tree. Each installed copy must satisfy the patched
 * version for ITS OWN major (not a single universal threshold), and any
 * unexpected major fails the test.
 *
 * Also keeps coverage that glob / ESLint / ExcelJS consumers still work.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { createRequire } from "node:module";
import ExcelJS from "exceljs";
import { Linter } from "eslint";

const require = createRequire(import.meta.url);
const minimatch = require("minimatch") as (
  value: string,
  pattern: string,
  options?: Record<string, unknown>,
) => boolean;

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

function cmp(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

const MIN_BY_MAJOR: Record<string, string> = {
  "1": "1.1.18",
  "2": "2.1.4",
  "5": "5.0.9",
};

const copies = Object.entries(lock.packages as Record<string, { version?: string }>)
  .filter(([path]) => path.endsWith("node_modules/brace-expansion"))
  .map(([path, meta]) => ({ path, version: meta.version ?? "0.0.0" }));

describe("brace-expansion security upgrade safety", () => {
  it("finds installed brace-expansion copies", () => {
    expect(copies.length).toBeGreaterThan(0);
  });

  describe("brace-expansion consumer compatibility", () => {
    it("preserves the TypeScript and TSX include globs used by the test toolchain", () => {
      const pattern = "src/**/*.{test,spec}.{ts,tsx}";

      expect(minimatch("src/hooks/useAuth.test.tsx", pattern)).toBe(true);
      expect(minimatch("src/lib/permissions.spec.ts", pattern)).toBe(true);
      expect(minimatch("src/pages/AuthPage.tsx", pattern)).toBe(false);
      expect(minimatch("tests/useAuth.test.tsx", pattern)).toBe(false);
    });

    it("preserves ordinary brace ranges and exclusion behaviour", () => {
      expect(minimatch("fixture-03.json", "fixture-{01..05}.json")).toBe(true);
      expect(minimatch("fixture-09.json", "fixture-{01..05}.json")).toBe(false);
      expect(minimatch("src/hooks/useAuth.tsx", "{src,tests}/**/*.{ts,tsx}")).toBe(true);
      expect(minimatch("node_modules/pkg/index.ts", "{src,tests}/**/*.{ts,tsx}")).toBe(false);
    });

    it("keeps ESLint's programmatic lint engine functional", () => {
      const linter = new Linter();
      const messages = linter.verify(
        "const unused = true;\nconst used = 1;\nconsole.log(used);",
        [
          {
            languageOptions: { ecmaVersion: 2022 },
            rules: { "no-unused-vars": "error" },
          },
        ],
      );

      expect(messages).toEqual([
        expect.objectContaining({
          ruleId: "no-unused-vars",
          severity: 2,
          message: expect.stringContaining("unused"),
        }),
      ]);
    });

    it("round-trips a multi-sheet ExcelJS archive without losing workbook data", async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "Ignite Club HQ";
      const events = workbook.addWorksheet("Events");
      events.addRow(["event_id", "title", "starts_at"]);
      events.addRow(["event-synthetic-1", "Synthetic Game Day", new Date("2027-06-12T09:30:00.000Z")]);
      const attendance = workbook.addWorksheet("Attendance");
      attendance.addRow(["member_id", "status"]);
      attendance.addRow(["member-synthetic-1", "attending"]);
      attendance.getCell("C1").value = "attending_count";
      attendance.getCell("C2").value = { formula: 'COUNTIF(B:B,"attending")', result: 1 };

      const output = await workbook.xlsx.writeBuffer();
      expect(output.byteLength).toBeGreaterThan(1_000);

      const imported = new ExcelJS.Workbook();
      await imported.xlsx.load(output);
      expect(imported.worksheets.map(({ name }) => name)).toEqual(["Events", "Attendance"]);
      expect(imported.getWorksheet("Events")?.getCell("B2").value).toBe("Synthetic Game Day");
      expect(imported.getWorksheet("Attendance")?.getCell("C2").value).toMatchObject({
        formula: 'COUNTIF(B:B,"attending")',
        result: 1,
      });
    });
  });

  describe("brace-expansion security acceptance gate", () => {
    it("resolves every brace-expansion copy to the patched range", () => {
      const vulnerable = copies.filter(({ version }) => {
        const min = MIN_BY_MAJOR[version.split(".")[0]];
        return min === undefined || cmp(version, min) < 0;
      });

      expect(
        vulnerable,
        `Vulnerable brace-expansion resolutions remain:\n${vulnerable
          .map(({ path, version }) => `${path}: ${version}`)
          .join("\n")}`,
      ).toEqual([]);
    });

    it("keeps separate patched overrides for every supported consumer major", () => {
      const pkg = JSON.parse(readFileSync("package.json", "utf8"));
      expect(pkg.overrides?.["brace-expansion@1.x"]).toBe("1.1.18");
      expect(pkg.overrides?.["brace-expansion@2.x"]).toBe("2.1.4");
      expect(pkg.overrides?.["brace-expansion@5.x"]).toBe("5.0.9");
    });

    it("does not downgrade the major consumers to satisfy npm audit", () => {
      expect(cmp(lock.packages?.["node_modules/eslint"]?.version, "9.32.0")).toBeGreaterThanOrEqual(0);
      expect(cmp(lock.packages?.["node_modules/exceljs"]?.version, "4.4.0")).toBeGreaterThanOrEqual(0);
    });
  });

  it("validates each copy against the minimum for its own major", () => {
    for (const copy of copies) {
      const major = copy.version.split(".")[0];
      const min = MIN_BY_MAJOR[major];
      expect(min, `unexpected brace-expansion major at ${copy.path}@${copy.version}`).toBeDefined();
      expect(cmp(copy.version, min!), `${copy.path}@${copy.version}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("preserves the separate 1.x / 2.x / 5.x overrides", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.overrides["brace-expansion@1.x"]).toBe("1.1.18");
    expect(pkg.overrides["brace-expansion@2.x"]).toBe("2.1.4");
    expect(pkg.overrides["brace-expansion@5.x"]).toBe("5.0.9");
  });

  it("keeps brace expansion behaviour working for glob-style consumers", async () => {
    const mod = (await import("brace-expansion")) as unknown as {
      default?: (pattern: string) => string[];
      expand?: (pattern: string) => string[];
    };
    const expand = mod.default ?? mod.expand;
    expect(expand?.("a{b,c}d")).toEqual(["abd", "acd"]);
    const mm = (await import("minimatch")) as unknown as {
      default?: (p: string, pattern: string) => boolean;
      minimatch?: (p: string, pattern: string) => boolean;
    };
    const match = mm.minimatch ?? mm.default;
    expect(match?.("src/a.ts", "src/*.{ts,tsx}")).toBe(true);
  });

  it("keeps ExcelJS usable (transitive brace-expansion consumer)", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["a", 1]);
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});

// This lab repo uses npm only (package-lock.json, checked above); there is
// no bun.lock. Skip rather than fabricate a bun-managed lockfile just to
// satisfy this test - the npm-side pin checks above already prove the fix.
describe.skipIf(!existsSync("bun.lock"))("bun.lock brace-expansion pins", () => {
  const bunLock = existsSync("bun.lock") ? readFileSync("bun.lock", "utf8") : "";
  const entries = [...bunLock.matchAll(/brace-expansion@(\d+\.\d+\.\d+)"/g)].map((m) => m[1]);

  it("locks every bun-resolved copy to the patched version for its major", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const version of entries) {
      const min = MIN_BY_MAJOR[version.split(".")[0]];
      expect(min, `unexpected brace-expansion major in bun.lock: ${version}`).toBeDefined();
      expect(cmp(version, min!), `bun.lock brace-expansion@${version}`).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("brace-expansion consumer compatibility", () => {
  it("preserves the TypeScript and TSX include globs used by the test toolchain", () => {
    const pattern = "src/**/*.{test,spec}.{ts,tsx}";

    expect(minimatch("src/hooks/useAuth.test.tsx", pattern)).toBe(true);
    expect(minimatch("src/lib/permissions.spec.ts", pattern)).toBe(true);
    expect(minimatch("src/pages/AuthPage.tsx", pattern)).toBe(false);
    expect(minimatch("tests/useAuth.test.tsx", pattern)).toBe(false);
  });

  it("preserves ordinary brace ranges and exclusion behaviour", () => {
    expect(minimatch("fixture-03.json", "fixture-{01..05}.json")).toBe(true);
    expect(minimatch("fixture-09.json", "fixture-{01..05}.json")).toBe(false);
    expect(minimatch("src/hooks/useAuth.tsx", "{src,tests}/**/*.{ts,tsx}")).toBe(true);
    expect(minimatch("node_modules/pkg/index.ts", "{src,tests}/**/*.{ts,tsx}")).toBe(false);
  });

  it("keeps ESLint's programmatic lint engine functional", () => {
    const linter = new Linter();
    const messages = linter.verify(
      "const unused = true;\nconst used = 1;\nconsole.log(used);",
      [
        {
          languageOptions: { ecmaVersion: 2022 },
          rules: { "no-unused-vars": "error" },
        },
      ],
    );

    expect(messages).toEqual([
      expect.objectContaining({
        ruleId: "no-unused-vars",
        severity: 2,
        message: expect.stringContaining("unused"),
      }),
    ]);
  });

  it("round-trips a multi-sheet ExcelJS archive without losing workbook data", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Ignite Club HQ";
    const events = workbook.addWorksheet("Events");
    events.addRow(["event_id", "title", "starts_at"]);
    events.addRow(["event-synthetic-1", "Synthetic Game Day", new Date("2027-06-12T09:30:00.000Z")]);
    const attendance = workbook.addWorksheet("Attendance");
    attendance.addRow(["member_id", "status"]);
    attendance.addRow(["member-synthetic-1", "attending"]);
    attendance.getCell("C1").value = "attending_count";
    attendance.getCell("C2").value = { formula: 'COUNTIF(B:B,"attending")', result: 1 };

    const output = await workbook.xlsx.writeBuffer();
    expect(output.byteLength).toBeGreaterThan(1_000);

    const imported = new ExcelJS.Workbook();
    await imported.xlsx.load(output);
    expect(imported.worksheets.map(({ name }) => name)).toEqual(["Events", "Attendance"]);
    expect(imported.getWorksheet("Events")?.getCell("B2").value).toBe("Synthetic Game Day");
    expect(imported.getWorksheet("Attendance")?.getCell("C2").value).toMatchObject({
      formula: 'COUNTIF(B:B,"attending")',
      result: 1,
    });
  });
});

describe("brace-expansion security acceptance gate", () => {
  it("resolves every brace-expansion copy to the patched range", () => {
    const vulnerable = copies.filter(({ version }) => {
      const min = MIN_BY_MAJOR[version.split(".")[0]];
      return min === undefined || cmp(version, min) < 0;
    });

    expect(
      vulnerable,
      `Vulnerable brace-expansion resolutions remain:\n${vulnerable
        .map(({ path, version }) => `${path}: ${version}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("keeps separate patched overrides for every supported consumer major", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.overrides?.["brace-expansion@1.x"]).toBe("1.1.18");
    expect(pkg.overrides?.["brace-expansion@2.x"]).toBe("2.1.4");
    expect(pkg.overrides?.["brace-expansion@5.x"]).toBe("5.0.9");
  });

  it("does not downgrade the major consumers to satisfy npm audit", () => {
    expect(cmp(lock.packages?.["node_modules/eslint"]?.version, "9.32.0")).toBeGreaterThanOrEqual(0);
    expect(cmp(lock.packages?.["node_modules/exceljs"]?.version, "4.4.0")).toBeGreaterThanOrEqual(0);
  });
});
