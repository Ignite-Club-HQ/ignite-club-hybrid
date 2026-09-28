import { describe, it, expect } from "vitest";
import { parseRecipients, looksLikeMultiRecipient } from "./recipientParser";

describe("recipientParser — supported formats", () => {
  it("parses a bare email", () => {
    expect(parseRecipients("alice@example.invalid")).toEqual([{ name: "alice", email: "alice@example.invalid" }]);
  });

  it("parses name-only", () => {
    expect(parseRecipients("Alice Smith")).toEqual([{ name: "Alice Smith", email: "" }]);
  });

  it("parses Name <email>", () => {
    expect(parseRecipients("Alice Smith <alice@example.invalid>")).toEqual([
      { name: "Alice Smith", email: "alice@example.invalid" },
    ]);
  });

  it("parses `Name, email` as one entry when it's the only recipient", () => {
    expect(parseRecipients("Alice Smith, alice@example.invalid")).toEqual([
      { name: "Alice Smith", email: "alice@example.invalid" },
    ]);
  });

  it("splits on newline / tab / semicolon", () => {
    expect(parseRecipients("a@example.invalid\nb@example.invalid\tc@example.invalid;d@example.invalid")).toEqual([
      { name: "a", email: "a@example.invalid" },
      { name: "b", email: "b@example.invalid" },
      { name: "c", email: "c@example.invalid" },
      { name: "d", email: "d@example.invalid" },
    ]);
  });

  it("splits on commas when multiple emails are present", () => {
    expect(parseRecipients("a@example.invalid, b@example.invalid")).toEqual([
      { name: "a", email: "a@example.invalid" },
      { name: "b", email: "b@example.invalid" },
    ]);
  });

  it("dedupes case-insensitively", () => {
    expect(parseRecipients("A@example.invalid\na@example.invalid")).toEqual([{ name: "A", email: "A@example.invalid" }]);
  });
});

describe("recipientParser — hardened rejections", () => {
  it("rejects `Alex <alex@example.test extra>` (extra tokens in bracket body)", () => {
    expect(parseRecipients("Alex <alex@example.test extra>")).toEqual([]);
  });

  it("rejects `Alex <alex@example.test><evil@example.test>` (multiple brackets)", () => {
    expect(parseRecipients("Alex <alex@example.test><evil@example.test>")).toEqual([]);
  });

  it("rejects unmatched opening bracket", () => {
    expect(parseRecipients("Alex <redacted@example.invalid")).toEqual([]);
  });

  it("rejects unmatched closing bracket", () => {
    expect(parseRecipients("Alex redacted@example.invalid>")).toEqual([]);
  });

  it("rejects nested brackets", () => {
    expect(parseRecipients("Alex <<redacted@example.invalid>>")).toEqual([]);
  });

  it("rejects content after the closing bracket", () => {
    expect(parseRecipients("Alex <redacted@example.invalid> redacted@example.invalid")).toEqual([]);
  });

  it("rejects a name-only entry that contains @-noise", () => {
    expect(parseRecipients("Alex @broken")).toEqual([]);
  });

  it("rejects an ambiguous un-splittable entry containing two emails", () => {
    // No list separators (comma/semicolon/newline/tab) → one entry with two
    // emails. Ambiguous — must be rejected so we never silently graft the
    // name onto an attacker-controlled second address.
    expect(parseRecipients("Alex redacted@example.invalid redacted@example.invalid")).toEqual([]);
  });
});

describe("looksLikeMultiRecipient", () => {
  it("returns true for newline-separated pairs", () => {
    expect(looksLikeMultiRecipient("a@example.invalid\nb@example.invalid")).toBe(true);
  });
  it("returns true for two bare emails", () => {
    expect(looksLikeMultiRecipient("a@example.invalid, b@example.invalid")).toBe(true);
  });
  it("returns false for a single Name <email>", () => {
    expect(looksLikeMultiRecipient("Alice <redacted@example.invalid>")).toBe(false);
  });
});
