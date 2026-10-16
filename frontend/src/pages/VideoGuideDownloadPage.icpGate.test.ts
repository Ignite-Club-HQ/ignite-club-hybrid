import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/VideoGuideDownloadPage.tsx"), "utf8");

describe("VideoGuideDownloadPage admin gating", () => {
  it("gates on useIsAppAdmin instead of an ICP-unavailable notice", () => {
    expect(source).toContain('import { useIsAppAdmin } from "@/hooks/useIsAppAdmin"');
    expect(source).toContain("const { isAppAdmin, isLoading: roleLoading } = useIsAppAdmin();");
    expect(source).not.toContain("IcpUnavailablePage");
    expect(source).not.toContain('resolveAuthBackend() === "icp"');
  });
});
