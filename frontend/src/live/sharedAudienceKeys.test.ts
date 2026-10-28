import { beforeEach, describe, expect, it } from "vitest";
import { parseSharedCiphertext, sharedKeySlot, vaultRoleScope, wrapSharedCiphertext, type SharedAudience } from "./piiVetKeys";
import { pruneStoredClubKeys, storeClubKey, loadStoredClubKey, storedKeyClubId } from "./deviceMediaCache";

describe("shared audience keys", () => {
  beforeEach(() => localStorage.clear());

  it("children's names use one club key, guests one team key", () => {
    const child: SharedAudience = { kind: "clubchildren", scope: "club-1", club: "club-1" };
    const guest: SharedAudience = { kind: "teamnames", scope: "team-a", club: "club-1" };
    expect(parseSharedCiphertext(wrapSharedCiphertext(child, new Uint8Array([1, 2]))))
      .toEqual({ audience: child, ciphertext: new Uint8Array([1, 2]) });
    expect(parseSharedCiphertext(wrapSharedCiphertext(guest, new Uint8Array([9])))?.audience).toEqual(guest);
  });

  it("older per-record ciphertext is not treated as shared", () => {
    expect(parseSharedCiphertext(new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
  });

  it("vault role audience is the same regardless of role order", () => {
    expect(vaultRoleScope("c", "t", ["coach", "committee", "coach"])).toBe("c|t|coach,committee");
    expect(vaultRoleScope("c", null, ["committee", "coach"])).toBe("c||coach,committee");
  });

  it("leaving a club removes its saved shared keys and keeps other clubs'", () => {
    const a: SharedAudience = { kind: "teamnames", scope: "team-a", club: "club-1" };
    const b: SharedAudience = { kind: "clubchildren", scope: "club-2", club: "club-2" };
    expect(storedKeyClubId(sharedKeySlot(a))).toBe("club-1");
    storeClubKey("pii", "me", sharedKeySlot(a), new Uint8Array([1]));
    storeClubKey("pii", "me", sharedKeySlot(b), new Uint8Array([2]));
    pruneStoredClubKeys("me", ["club-2"]);
    expect(loadStoredClubKey("pii", "me", sharedKeySlot(a))).toBeNull();
    expect(loadStoredClubKey("pii", "me", sharedKeySlot(b))).not.toBeNull();
  });
});
