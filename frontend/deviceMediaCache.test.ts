
import { MAX_STORED_RECORD_KEYS, storeClubKey as storeKeyBound, loadStoredClubKey as loadKeyBound } from "./deviceMediaCache";
import { it as itBound, expect as expectBound } from "vitest";
itBound("keeps at most MAX_STORED_RECORD_KEYS record keys per sign-in", () => {
  localStorage.clear();
  for (let i = 0; i <= MAX_STORED_RECORD_KEYS; i++) storeKeyBound("c", "p", `pii:name:${i}`, new Uint8Array([1]));
  const count = Object.keys(localStorage).filter(k => k.includes(":p:pii:")).length;
  expectBound(count).toBe(MAX_STORED_RECORD_KEYS);
  expectBound(loadKeyBound("c", "p", `pii:name:${MAX_STORED_RECORD_KEYS}`)).not.toBeNull();
  expectBound(loadKeyBound("c", "p", "clubA")).toBeNull();
});
