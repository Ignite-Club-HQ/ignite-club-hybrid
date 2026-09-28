import { describe, expect, it } from "vitest";
import { getLocalLabClubList, personas } from "./disabledLabRuntime";

describe("disabled live lab runtime", () => {
  it("exposes no synthetic personas", () => {
    expect(personas).toEqual([]);
  });

  it("fails closed if fixture code is called unexpectedly", () => {
    expect(() => getLocalLabClubList()).toThrow("disabled in the live application");
  });
});
