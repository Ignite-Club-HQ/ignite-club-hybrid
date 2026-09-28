/**
 * Security acceptance: js-yaml 4.x must be >= 4.3.1 everywhere, and YAML
 * parsing / round-tripping must keep working after the upgrade.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { load, dump } from "js-yaml";
import ExcelJS from "exceljs";
import { parse as parseFlatted, stringify as stringifyFlatted } from "flatted";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));

function cmp(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

function installed(name: string) {
  return Object.entries(lock.packages as Record<string, { version?: string }>)
    .filter(([path]) => path.endsWith(`node_modules/${name}`))
    .map(([path, meta]) => ({ path, version: meta.version ?? "0.0.0" }));
}

describe("high severity dependency upgrade safety", () => {
  it("has no js-yaml 4.x copy below 4.3.1", () => {
    const copies = installed("js-yaml");
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      if (!copy.version.startsWith("4.")) continue;
      expect(cmp(copy.version, "4.3.1"), `${copy.path}@${copy.version}`).toBeGreaterThanOrEqual(0);
    }
  });

  describe("high-severity dependency compatibility", () => {
    it("round-trips the fixture workbook values used by Ignite imports and templates", async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Fixtures");
      sheet.addRow(["title", "date", "time", "opponent", "address", "description", "reminder_hours"]);
      sheet.addRow([
        "U10 - Round 1 vs Eagles",
        new Date("2027-03-06T00:00:00.000Z"),
        "10:00",
        "Eagles FC",
        "123 Sports Ground Rd",
        "Home game",
        24,
      ]);
      sheet.getCell("H1").value = "double_reminder";
      sheet.getCell("H2").value = { formula: "G2*2", result: 48 };

      const output = await workbook.xlsx.writeBuffer();
      expect(output.byteLength).toBeGreaterThan(1_000);

      const imported = new ExcelJS.Workbook();
      await imported.xlsx.load(output);
      const importedSheet = imported.getWorksheet("Fixtures");
      expect(importedSheet).toBeDefined();
      expect(importedSheet!.getCell("A2").value).toBe("U10 - Round 1 vs Eagles");
      expect(importedSheet!.getCell("F2").value).toBe("Home game");
      expect(importedSheet!.getCell("G2").value).toBe(24);
      expect(importedSheet!.getCell("H2").value).toMatchObject({ formula: "G2*2", result: 48 });
      expect(importedSheet!.getCell("B2").value).toBeInstanceOf(Date);
    });

    it("keeps ExcelJS on the expected tmp and uuid dependency boundary", () => {
      const excelEntry = lock.packages?.["node_modules/exceljs"];
      expect(excelEntry?.version).toBe("4.4.0");
      expect(excelEntry?.dependencies).toMatchObject({ tmp: "^0.2.0", uuid: "^8.3.0" });
    });

    it("round-trips circular ESLint-style cache data with flatted", () => {
      const shared = { file: "src/hooks/useAuth.tsx", status: "clean" };
      const cache: Record<string, unknown> = { version: 1, entries: [shared, shared] };
      cache.self = cache;

      const decoded = parseFlatted(stringifyFlatted(cache)) as typeof cache;
      expect(decoded.self).toBe(decoded);
      expect((decoded.entries as unknown[])[0]).toBe((decoded.entries as unknown[])[1]);
      expect((decoded.entries as Array<typeof shared>)[0]).toEqual(shared);
    });

    it("parses and serializes ESLint-style YAML merges without changing values", () => {
      const source = [
        "defaults: &defaults",
        "  severity: warning",
        "  enabled: true",
        "rules:",
        "  no-unsafe-input:",
        "    <<: *defaults",
        "    paths:",
        "      - src",
        "      - supabase/functions",
      ].join("\n");

      const parsed = load(source) as any;
      expect(parsed.rules["no-unsafe-input"]).toEqual({
        severity: "warning",
        enabled: true,
        paths: ["src", "supabase/functions"],
      });
      expect(load(dump(parsed))).toEqual(parsed);
    });
  });

  describe("high-severity dependency acceptance gate", () => {
    it("does not downgrade ExcelJS while fixing its transitive tmp dependency", () => {
      expect(cmp(lock.packages?.["node_modules/exceljs"]?.version, "4.4.0")).toBeGreaterThanOrEqual(0);
    });
  });

  describe("high-severity dependency compatibility", () => {
    it("round-trips the fixture workbook values used by Ignite imports and templates", async () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Fixtures");
      sheet.addRow([
        "title",
        "date",
        "time",
        "opponent",
        "address",
        "description",
        "reminder_hours",
      ]);
      sheet.addRow([
        "U10 - Round 1 vs Eagles",
        new Date("2027-03-06T00:00:00.000Z"),
        "10:00",
        "Eagles FC",
        "123 Sports Ground Rd",
        "Home game",
        24,
      ]);
      sheet.getCell("H1").value = "double_reminder";
      sheet.getCell("H2").value = { formula: "G2*2", result: 48 };

      const output = await workbook.xlsx.writeBuffer();
      expect(output.byteLength).toBeGreaterThan(1_000);

      const imported = new ExcelJS.Workbook();
      await imported.xlsx.load(output);
      const importedSheet = imported.getWorksheet("Fixtures");

      expect(importedSheet).toBeDefined();
      expect(importedSheet!.getCell("A2").value).toBe("U10 - Round 1 vs Eagles");
      expect(importedSheet!.getCell("F2").value).toBe("Home game");
      expect(importedSheet!.getCell("G2").value).toBe(24);
      expect(importedSheet!.getCell("H2").value).toMatchObject({
        formula: "G2*2",
        result: 48,
      });
      expect(importedSheet!.getCell("B2").value).toBeInstanceOf(Date);
    });

    it("keeps ExcelJS on the expected tmp and uuid dependency boundary", () => {
      const excelEntry = lock.packages?.["node_modules/exceljs"];
      expect(excelEntry?.version).toBe("4.4.0");
      expect(excelEntry?.dependencies).toMatchObject({
        tmp: "^0.2.0",
        uuid: "^8.3.0",
      });
    });

    it("round-trips circular ESLint-style cache data with flatted", () => {
      const shared = { file: "src/hooks/useAuth.tsx", status: "clean" };
      const cache: Record<string, unknown> = {
        version: 1,
        entries: [shared, shared],
      };
      cache.self = cache;

      const decoded = parseFlatted(stringifyFlatted(cache)) as typeof cache;
      expect(decoded.self).toBe(decoded);
      expect((decoded.entries as unknown[])[0]).toBe((decoded.entries as unknown[])[1]);
      expect((decoded.entries as Array<typeof shared>)[0]).toEqual(shared);
    });

    it("parses and serializes ESLint-style YAML merges without changing values", () => {
      const source = [
        "defaults: &defaults",
        "  severity: warning",
        "  enabled: true",
        "rules:",
        "  no-unsafe-input:",
        "    <<: *defaults",
        "    paths:",
        "      - src",
        "      - supabase/functions",
      ].join("\n");

      const parsed = load(source) as any;
      expect(parsed.rules["no-unsafe-input"]).toEqual({
        severity: "warning",
        enabled: true,
        paths: ["src", "supabase/functions"],
      });
      expect(load(dump(parsed))).toEqual(parsed);
    });
  });

  describe("high-severity dependency acceptance gate", () => {
    it("does not downgrade ExcelJS while fixing its transitive tmp dependency", () => {
      expect(cmp(lock.packages?.["node_modules/exceljs"]?.version, "4.4.0")).toBeGreaterThanOrEqual(0);
    });
  });

  it("still parses YAML documents", () => {
    const parsed = load("name: ignite\nteams:\n  - u12\n  - u14\n") as {
      name: string;
      teams: string[];
    };
    expect(parsed.name).toBe("ignite");
    expect(parsed.teams).toEqual(["u12", "u14"]);
  });

  it("still round-trips YAML", () => {
    const value = { club: "Bridgewater", nested: { enabled: true, count: 3 } };
    expect(load(dump(value))).toEqual(value);
  });
});

describe("high-severity dependency compatibility", () => {
  it("round-trips the fixture workbook values used by Ignite imports and templates", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Fixtures");
    sheet.addRow(["title", "date", "time", "opponent", "address", "description", "reminder_hours"]);
    sheet.addRow([
      "U10 - Round 1 vs Eagles",
      new Date("2027-03-06T00:00:00.000Z"),
      "10:00",
      "Eagles FC",
      "123 Sports Ground Rd",
      "Home game",
      24,
    ]);
    sheet.getCell("H1").value = "double_reminder";
    sheet.getCell("H2").value = { formula: "G2*2", result: 48 };

    const output = await workbook.xlsx.writeBuffer();
    expect(output.byteLength).toBeGreaterThan(1_000);

    const imported = new ExcelJS.Workbook();
    await imported.xlsx.load(output);
    const importedSheet = imported.getWorksheet("Fixtures");
    expect(importedSheet).toBeDefined();
    expect(importedSheet!.getCell("A2").value).toBe("U10 - Round 1 vs Eagles");
    expect(importedSheet!.getCell("F2").value).toBe("Home game");
    expect(importedSheet!.getCell("G2").value).toBe(24);
    expect(importedSheet!.getCell("H2").value).toMatchObject({ formula: "G2*2", result: 48 });
    expect(importedSheet!.getCell("B2").value).toBeInstanceOf(Date);
  });

  it("keeps ExcelJS on the expected tmp and uuid dependency boundary", () => {
    const excelEntry = lock.packages?.["node_modules/exceljs"];
    expect(excelEntry?.version).toBe("4.4.0");
    expect(excelEntry?.dependencies).toMatchObject({ tmp: "^0.2.0", uuid: "^8.3.0" });
  });

  it("round-trips circular ESLint-style cache data with flatted", () => {
    const shared = { file: "src/hooks/useAuth.tsx", status: "clean" };
    const cache: Record<string, unknown> = { version: 1, entries: [shared, shared] };
    cache.self = cache;

    const decoded = parseFlatted(stringifyFlatted(cache)) as typeof cache;
    expect(decoded.self).toBe(decoded);
    expect((decoded.entries as unknown[])[0]).toBe((decoded.entries as unknown[])[1]);
    expect((decoded.entries as Array<typeof shared>)[0]).toEqual(shared);
  });

  it("parses and serializes ESLint-style YAML merges without changing values", () => {
    const source = [
      "defaults: &defaults",
      "  severity: warning",
      "  enabled: true",
      "rules:",
      "  no-unsafe-input:",
      "    <<: *defaults",
      "    paths:",
      "      - src",
      "      - supabase/functions",
    ].join("\n");

    const parsed = load(source) as any;
    expect(parsed.rules["no-unsafe-input"]).toEqual({
      severity: "warning",
      enabled: true,
      paths: ["src", "supabase/functions"],
    });
    expect(load(dump(parsed))).toEqual(parsed);
  });
});

describe("high-severity dependency acceptance gate", () => {
  it("does not downgrade ExcelJS while fixing its transitive tmp dependency", () => {
    expect(cmp(lock.packages?.["node_modules/exceljs"]?.version, "4.4.0")).toBeGreaterThanOrEqual(0);
  });
});
