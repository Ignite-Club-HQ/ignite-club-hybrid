import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import autoprefixer from "autoprefixer";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const packageLock = JSON.parse(
  readFileSync(resolve(root, "package-lock.json"), "utf8"),
);
const postcssConfig = readFileSync(
  resolve(root, "postcss.config.js"),
  "utf8",
);

function versionTuple(version: string): [number, number, number] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported semantic version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function atLeast(actual: string, minimum: string): boolean {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

function postcssResolutions(): Array<{ path: string; version: string }> {
  return Object.entries<Record<string, any>>(packageLock.packages ?? {})
    .filter(([path, entry]) =>
      (path === "node_modules/postcss" || path.endsWith("/node_modules/postcss"))
      && typeof entry?.version === "string"
    )
    .map(([path, entry]) => ({ path, version: entry.version }));
}

describe("PostCSS security patch acceptance", () => {
  it("resolves every PostCSS copy to 8.5.12 or newer", () => {
    const resolutions = postcssResolutions();
    expect(resolutions.length).toBeGreaterThan(0);

    const vulnerable = resolutions.filter(
      ({ version }) => !atLeast(version, "8.5.12"),
    );

    expect(
      vulnerable,
      `Vulnerable PostCSS resolutions remain:\n${vulnerable
        .map(({ path, version }) => `${path}: ${version}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  it("keeps Tailwind and Autoprefixer in the checked-in PostCSS pipeline", () => {
    expect(postcssConfig).toContain("tailwindcss: {}");
    expect(postcssConfig).toContain("autoprefixer: {}");
  });

  it("processes representative Ignite utilities and vendor prefixes", async () => {
    const result = await postcss([
      tailwindcss({
        content: [
          {
            raw: '<button class="flex rounded-lg bg-primary px-4 py-2"></button>',
            extension: "html",
          },
        ],
        theme: {
          extend: {
            colors: {
              primary: "hsl(var(--primary))",
            },
          },
        },
        corePlugins: { preflight: false },
      }),
      autoprefixer,
    ]).process(
      [
        "@tailwind utilities;",
        ".postcss-security-check {",
        "  user-select: none;",
        "  appearance: none;",
        "}",
      ].join("\n"),
      { from: undefined },
    );

    expect(result.css).toContain(".flex");
    expect(result.css).toContain(".rounded-lg");
    expect(result.css).toContain(".bg-primary");
    expect(result.css).toContain("-webkit-user-select: none");
    expect(result.css).toContain("-webkit-appearance: none");
    expect(result.warnings()).toEqual([]);
  });

  it("serializes ordinary CSS comments and source maps without losing rules", async () => {
    const result = await postcss().process(
      "/* Ignite generated stylesheet */\n.club-card { color: red; }",
      {
        from: "ignite-input.css",
        to: "ignite-output.css",
        map: { inline: true },
      },
    );

    expect(result.css).toContain("Ignite generated stylesheet");
    expect(result.css).toContain(".club-card { color: red; }");
    expect(result.css).toContain("sourceMappingURL=data:application/json");
  });
});
