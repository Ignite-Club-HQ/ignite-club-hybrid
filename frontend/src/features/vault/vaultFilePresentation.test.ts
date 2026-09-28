import { describe, expect, it } from "vitest";
import {
  formatVaultFileSize,
  getVaultExternalLinkInfo,
  isVaultDocumentFile,
  isVaultSpreadsheetFile,
} from "./vaultFilePresentation";

describe("vault file presentation", () => {
  it.each([
    [0, ""],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1024 * 1024, "1.0 MB"],
    [1024 * 1024 * 1024, "1.00 GB"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatVaultFileSize(bytes)).toBe(expected);
  });

  it("classifies spreadsheet and document names case-insensitively", () => {
    expect(isVaultSpreadsheetFile("Roster.CSV")).toBe(true);
    expect(isVaultSpreadsheetFile("document.pdf")).toBe(false);
    expect(isVaultDocumentFile("Training.PDF")).toBe(true);
    expect(isVaultDocumentFile("sheet.ods")).toBe(false);
  });

  it("maps recognized external providers and falls back consistently", () => {
    expect(getVaultExternalLinkInfo("https://docs.google.com/spreadsheets/d/test"))
      .toMatchObject({ type: "Google Sheet", color: "text-green-600" });
    expect(getVaultExternalLinkInfo("https://example.invalid/file"))
      .toMatchObject({ type: "External Link", color: "text-muted-foreground" });
  });
});
