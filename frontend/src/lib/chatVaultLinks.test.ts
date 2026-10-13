import { describe, expect, it } from "vitest";
import { isVaultOnlyMessage, makeVaultFileToken, makeVaultFolderToken, makeVaultRootToken } from "./chatVaultLinks";

const id = "12345678-abcd-4321-abcd-123456789abc";

describe("vault-only message recognition", () => {
  it.each(["club", "team"] as const)("recognizes an entire %s vault without a caption", (scope) => {
    expect(isVaultOnlyMessage(` \n${makeVaultRootToken(scope, id)} \n`)).toBe(true);
  });
  it("recognizes a file share without a caption", () => {
    expect(isVaultOnlyMessage(makeVaultFileToken(id))).toBe(true);
  });
  it("recognizes a folder share without a caption", () => {
    expect(isVaultOnlyMessage(makeVaultFolderToken(id))).toBe(true);
  });
  it("preserves a typed caption alongside a vault", () => {
    expect(isVaultOnlyMessage(`Here are our files ${makeVaultRootToken("club", id)}`)).toBe(false);
  });
  it("does not classify plain or missing text as a vault share", () => {
    expect(isVaultOnlyMessage("Hello")).toBe(false);
    expect(isVaultOnlyMessage(null)).toBe(false);
  });
});