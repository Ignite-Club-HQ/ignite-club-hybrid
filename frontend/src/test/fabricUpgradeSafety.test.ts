import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import packageJson from "../../package.json";

function runtimeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return runtimeFiles(path);
    if (!/\.(ts|tsx)$/.test(entry) || /\.(test|spec)\.(ts|tsx)$/.test(entry)) return [];
    return [path];
  });
}

describe("Fabric security and upgrade acceptance boundary", () => {
  it(
    "pins Fabric at or above the version that fixes CVE-2026-44311",
    () => {
      const version = packageJson.dependencies.fabric.replace(/^[^\d]*/, "");
      const [major, minor, patch] = version.split(".").map(Number);

      expect(
        major > 7 || (major === 7 && (minor > 4 || (minor === 4 && patch >= 0))),
      ).toBe(true);
    },
  );

  it("does not export Fabric canvases to SVG in browser runtime code", () => {
    const offenders = runtimeFiles(join(process.cwd(), "src"))
      .filter((path) => readFileSync(path, "utf8").includes(".toSVG("));

    expect(offenders).toEqual([]);
  });

  it("keeps Pitch Board persistence on JSON rather than executable markup", () => {
    const pitchBoard = readFileSync(
      join(process.cwd(), "src/components/pitch/PitchBoard.tsx"),
      "utf8",
    );
    const formationLibrary = readFileSync(
      join(process.cwd(), "src/components/pitch/hooks/usePitchBoardFormationLibrary.ts"),
      "utf8",
    );
    const text = `${pitchBoard}\n${formationLibrary}`;

    expect(text).toContain(".toJSON(");
    expect(text).toContain(".loadFromJSON(");
    expect(text).not.toContain(".toSVG(");
  });
});
