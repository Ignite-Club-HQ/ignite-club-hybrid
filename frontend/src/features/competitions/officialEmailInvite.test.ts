import { describe, expect, it } from "vitest";
import { createOfficialEmailInviteSecrets, createOfficialInviteCode, createOfficialInviteToken, hashOfficialInviteCode, hashOfficialInviteEmail, sha256Hex } from "./officialEmailInvite";

describe("official email invite proof", () => {
  it("creates a high-entropy link token and fixed-width verification code", () => {
    expect(createOfficialInviteToken()).toMatch(/^[0-9a-f]{48}$/);
    expect(createOfficialInviteCode()).toMatch(/^\d{8}$/);
  });

  it("uses the same SHA-256 normalization for both providers", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("normalizes the address and salts both hashes per invitation", async () => {
    const secrets = await createOfficialEmailInviteSecrets(" Person@Example.com ");
    await expect(hashOfficialInviteEmail(secrets.token, "person@example.com")).resolves.toBe(secrets.emailHash);
    await expect(hashOfficialInviteCode(secrets.token, secrets.code)).resolves.toBe(secrets.codeHash);
    await expect(hashOfficialInviteCode("another-token", secrets.code)).resolves.not.toBe(secrets.codeHash);
  });
});