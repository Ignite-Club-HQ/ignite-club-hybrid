import { describe, expect, it, vi } from "vitest";
import { resolveDriveTitlesForClub } from "./driveTitleResolution";

describe("resolveDriveTitlesForClub", () => {
  it("passes the club scope and narrows the resolver summary", async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: {
        summary: {
          scanned: 3,
          updated: 2,
          unresolved: 1,
          errors: 0,
          hasOAuth: true,
        },
      },
      error: null,
    });

    await expect(resolveDriveTitlesForClub("club-1", invoke)).resolves.toEqual({
      scanned: 3,
      updated: 2,
      unresolved: 1,
      errors: 0,
      hasOAuth: true,
    });
    expect(invoke).toHaveBeenCalledWith("resolve-drive-titles", {
      body: { clubId: "club-1" },
    });
  });

  it("keeps an absent or malformed summary as the existing no-op result", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { summary: { scanned: "3" } }, error: null });

    await expect(resolveDriveTitlesForClub("club-1", invoke)).resolves.toBeNull();
  });

  it("surfaces the function error to the page's existing failure toast", async () => {
    const error = new Error("not authorized");
    const invoke = vi.fn().mockResolvedValue({ data: null, error });

    await expect(resolveDriveTitlesForClub("club-1", invoke)).rejects.toBe(error);
  });
});
