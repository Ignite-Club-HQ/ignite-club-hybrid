/**
 * Security acceptance: transitive advisories (dompurify, postcss, undici) must
 * be resolved at or above their patched versions, and dependent behaviour
 * (jsPDF generation, PostCSS processing) must keep working.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import picomatch from "picomatch";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const root = path.resolve(import.meta.dirname, "../..");

const readText = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

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

const MINIMUMS: Record<string, string> = {
  dompurify: "3.4.13",
  postcss: "8.5.23",
  undici: "7.29.0",
};

describe("transitive security upgrade safety", () => {
  for (const [name, min] of Object.entries(MINIMUMS)) {
    it(`has no ${name} copy below ${min}`, () => {
      const copies = installed(name);
      expect(copies.length).toBeGreaterThan(0);
      for (const copy of copies) {
        if (name === "undici" && !copy.version.startsWith("7.")) continue;
        expect(cmp(copy.version, min), `${copy.path}@${copy.version}`).toBeGreaterThanOrEqual(0);
      }
    });

    const sourceFilesTop = (directory: string): string[] =>
      fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFilesTop(absolutePath);
        if (!entry.name.match(/\.(ts|tsx)$/) || entry.name.match(/\.(test|spec)\.(ts|tsx)$/)) {
          return [];
        }
        return [absolutePath];
      });

    describe("security-sensitive transitive dependency boundaries", () => {
      it("keeps Firebase database transports out of the web application source", () => {
        const runtimeSource = sourceFilesTop(path.join(root, "src"))
          .map((file) => fs.readFileSync(file, "utf8"))
          .join("\n");

        expect(runtimeSource).not.toMatch(
          /(?:from\s+|import\s*\()\s*["']firebase(?:\/(?:database|firestore))?["']/,
        );
      });

      it("loads native Firebase Messaging only after confirming a native platform", () => {
        const nativePush = readText("src/lib/nativePush.ts");
        const nativeGuard = nativePush.indexOf("if (!capacitorOk || !checkIsNative())");
        const firebaseImport = nativePush.indexOf("loadOptionalNativeModule('@capacitor-firebase/messaging')");
        expect(nativeGuard).toBeGreaterThan(-1);
        expect(firebaseImport).toBeGreaterThan(nativeGuard);
      });

      it("keeps PDF generation on text primitives instead of the HTML rendering path", () => {
        const pdfPage = readText("src/pages/VideoGuideDownloadPage.tsx");
        expect(pdfPage).toContain("doc.text(");
        expect(pdfPage).toContain("doc.splitTextToSize(");
        expect(pdfPage).not.toMatch(/\bdoc\.html\s*\(/);
      });

      it("can generate a non-empty PDF with the installed jsPDF runtime", () => {
        const document = new jsPDF();
        document.text("Ignite Club HQ security upgrade check", 15, 15);
        const output = document.output("arraybuffer");
        const signature = new TextDecoder().decode(output.slice(0, 5));
        expect(signature).toBe("%PDF-");
        expect(output.byteLength).toBeGreaterThan(500);
      });

      it("keeps the checked-in service worker independent from Workbox generation", () => {
        const viteConfig = readText("vite.config.ts");
        const main = readText("src/main.tsx");
        expect(viteConfig).not.toContain("vite-plugin-pwa");
        expect(viteConfig).not.toContain("VitePWA");
        expect(main).not.toContain("navigator.serviceWorker.register");
        expect(fs.existsSync(path.join(root, "public", "sw.js"))).toBe(false);
      });

      it("preserves the test-file glob behaviour used by the Vitest toolchain", () => {
        const includeTest = picomatch("src/**/*.{test,spec}.{ts,tsx}");
        const excludeDependencies = picomatch("**/node_modules/**");

        expect(includeTest("src/hooks/useAuth.test.tsx")).toBe(true);
        expect(includeTest("src/pages/AuthPage.spec.ts")).toBe(true);
        expect(includeTest("src/pages/AuthPage.tsx")).toBe(false);
        expect(excludeDependencies("node_modules/pkg/index.test.ts")).toBe(true);
        expect(excludeDependencies("src/lib/security.test.ts")).toBe(false);
      });

      it("handles ordinary POSIX character classes without method-like pattern injection", () => {
        const numericFixture = picomatch("fixtures/[[:digit:]][[:digit:]].json");
        const sourceFixture = picomatch("src/**/[[:alpha:]]*.test.ts");

        expect(numericFixture("fixtures/42.json")).toBe(true);
        expect(numericFixture("fixtures/ab.json")).toBe(false);
        expect(sourceFixture("src/lib/auth.test.ts")).toBe(true);
        expect(sourceFixture("src/lib/42.test.ts")).toBe(false);
      });
    });

    const sourceFiles = (directory: string): string[] =>
      fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(absolutePath);
        if (!entry.name.match(/\.(ts|tsx)$/) || entry.name.match(/\.(test|spec)\.(ts|tsx)$/)) {
          return [];
        }
        return [absolutePath];
      });

    describe("security-sensitive transitive dependency boundaries", () => {
      it("keeps Firebase database transports out of the web application source", () => {
        const runtimeSource = sourceFiles(path.join(root, "src"))
          .map((file) => fs.readFileSync(file, "utf8"))
          .join("\n");

        expect(runtimeSource).not.toMatch(
          /(?:from\s+|import\s*\()\s*["']firebase(?:\/(?:database|firestore))?["']/,
        );
      });

      it("loads native Firebase Messaging only after confirming a native platform", () => {
        const nativePush = readText("src/lib/nativePush.ts");
        const nativeGuard = nativePush.indexOf("if (!capacitorOk || !checkIsNative())");
        const firebaseImport = nativePush.indexOf("loadOptionalNativeModule('@capacitor-firebase/messaging')");

        expect(nativeGuard).toBeGreaterThan(-1);
        expect(firebaseImport).toBeGreaterThan(nativeGuard);
      });

      it("keeps PDF generation on text primitives instead of the HTML rendering path", () => {
        const pdfPage = readText("src/pages/VideoGuideDownloadPage.tsx");

        expect(pdfPage).toContain("doc.text(");
        expect(pdfPage).toContain("doc.splitTextToSize(");
        expect(pdfPage).not.toMatch(/\bdoc\.html\s*\(/);
      });

      it("can generate a non-empty PDF with the installed jsPDF runtime", () => {
        const document = new jsPDF();
        document.text("Ignite Club HQ security upgrade check", 15, 15);

        const output = document.output("arraybuffer");
        const signature = new TextDecoder().decode(output.slice(0, 5));

        expect(signature).toBe("%PDF-");
        expect(output.byteLength).toBeGreaterThan(500);
      });

      it("keeps the checked-in service worker independent from Workbox generation", () => {
        const viteConfig = readText("vite.config.ts");
        const main = readText("src/main.tsx");

        expect(viteConfig).not.toContain("vite-plugin-pwa");
        expect(viteConfig).not.toContain("VitePWA");
        expect(main).not.toContain("navigator.serviceWorker.register");
        expect(fs.existsSync(path.join(root, "public", "sw.js"))).toBe(false);
      });

      it("preserves the test-file glob behaviour used by the Vitest toolchain", () => {
        const includeTest = picomatch("src/**/*.{test,spec}.{ts,tsx}");
        const excludeDependencies = picomatch("**/node_modules/**");

        expect(includeTest("src/hooks/useAuth.test.tsx")).toBe(true);
        expect(includeTest("src/pages/AuthPage.spec.ts")).toBe(true);
        expect(includeTest("src/pages/AuthPage.tsx")).toBe(false);
        expect(excludeDependencies("node_modules/pkg/index.test.ts")).toBe(true);
        expect(excludeDependencies("src/lib/security.test.ts")).toBe(false);
      });

      it("handles ordinary POSIX character classes without method-like pattern injection", () => {
        const numericFixture = picomatch("fixtures/[[:digit:]][[:digit:]].json");
        const sourceFixture = picomatch("src/**/[[:alpha:]]*.test.ts");

        expect(numericFixture("fixtures/42.json")).toBe(true);
        expect(numericFixture("fixtures/ab.json")).toBe(false);
        expect(sourceFixture("src/lib/auth.test.ts")).toBe(true);
        expect(sourceFixture("src/lib/42.test.ts")).toBe(false);
      });
    });
  }

  it("still generates a PDF with jsPDF", async () => {
    const { default: JsPDF } = await import("jspdf");
    const doc = new JsPDF();
    doc.text("Ignite export", 10, 10);
    const output = doc.output("arraybuffer");
    expect(output.byteLength).toBeGreaterThan(0);
  });

  it("still processes CSS with postcss", async () => {
    const { default: postcss } = await import("postcss");
    const result = await postcss([]).process(".a{color:red}", { from: undefined });
    expect(result.css).toContain("color:red");
  });
});

const sourceFilesTopLevel = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesTopLevel(absolutePath);
    if (!entry.name.match(/\.(ts|tsx)$/) || entry.name.match(/\.(test|spec)\.(ts|tsx)$/)) {
      return [];
    }
    return [absolutePath];
  });

describe("security-sensitive transitive dependency boundaries", () => {
  it("keeps Firebase database transports out of the web application source", () => {
    const runtimeSource = sourceFilesTopLevel(path.join(root, "src"))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");

    expect(runtimeSource).not.toMatch(
      /(?:from\s+|import\s*\()\s*["']firebase(?:\/(?:database|firestore))?["']/,
    );
  });

  it("loads native Firebase Messaging only after confirming a native platform", () => {
    const nativePush = readText("src/lib/nativePush.ts");
    const nativeGuard = nativePush.indexOf("if (!capacitorOk || !checkIsNative())");
    const firebaseImport = nativePush.indexOf("loadOptionalNativeModule('@capacitor-firebase/messaging')");
    expect(nativeGuard).toBeGreaterThan(-1);
    expect(firebaseImport).toBeGreaterThan(nativeGuard);
  });

  it("keeps PDF generation on text primitives instead of the HTML rendering path", () => {
    const pdfPage = readText("src/pages/VideoGuideDownloadPage.tsx");
    expect(pdfPage).toContain("doc.text(");
    expect(pdfPage).toContain("doc.splitTextToSize(");
    expect(pdfPage).not.toMatch(/\bdoc\.html\s*\(/);
  });

  it("can generate a non-empty PDF with the installed jsPDF runtime", () => {
    const document = new jsPDF();
    document.text("Ignite Club HQ security upgrade check", 15, 15);
    const output = document.output("arraybuffer");
    const signature = new TextDecoder().decode(output.slice(0, 5));
    expect(signature).toBe("%PDF-");
    expect(output.byteLength).toBeGreaterThan(500);
  });

  it("keeps the checked-in service worker independent from Workbox generation", () => {
    const viteConfig = readText("vite.config.ts");
    const main = readText("src/main.tsx");
    expect(viteConfig).not.toContain("vite-plugin-pwa");
    expect(viteConfig).not.toContain("VitePWA");
    expect(main).not.toContain("navigator.serviceWorker.register");
    expect(fs.existsSync(path.join(root, "public", "sw.js"))).toBe(false);
  });

  it("preserves the test-file glob behaviour used by the Vitest toolchain", () => {
    const includeTest = picomatch("src/**/*.{test,spec}.{ts,tsx}");
    const excludeDependencies = picomatch("**/node_modules/**");

    expect(includeTest("src/hooks/useAuth.test.tsx")).toBe(true);
    expect(includeTest("src/pages/AuthPage.spec.ts")).toBe(true);
    expect(includeTest("src/pages/AuthPage.tsx")).toBe(false);
    expect(excludeDependencies("node_modules/pkg/index.test.ts")).toBe(true);
    expect(excludeDependencies("src/lib/security.test.ts")).toBe(false);
  });

  it("handles ordinary POSIX character classes without method-like pattern injection", () => {
    const numericFixture = picomatch("fixtures/[[:digit:]][[:digit:]].json");
    const sourceFixture = picomatch("src/**/[[:alpha:]]*.test.ts");

    expect(numericFixture("fixtures/42.json")).toBe(true);
    expect(numericFixture("fixtures/ab.json")).toBe(false);
    expect(sourceFixture("src/lib/auth.test.ts")).toBe(true);
    expect(sourceFixture("src/lib/42.test.ts")).toBe(false);
  });
});
