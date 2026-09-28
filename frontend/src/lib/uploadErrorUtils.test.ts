import { describe, expect, it } from "vitest";

import { getReadableUploadError, isCancelledSelectionError } from "./uploadErrorUtils";

describe("upload error normalization", () => {
  it.each([
    [new Error("Storage quota exceeded"), "Storage quota exceeded"],
    ["Network unavailable", "Network unavailable"],
    [{ message: "Upload denied", code: 403 }, "message: Upload denied | code: 403"],
    [{ localizedDescription: "Photo access denied" }, "localizedDescription: Photo access denied"],
  ])("extracts useful diagnostics without returning an opaque object", (error, expected) => {
    expect(getReadableUploadError(error)).toBe(expected);
  });

  it("serializes unfamiliar structured errors with a bounded message", () => {
    expect(getReadableUploadError({ native: { status: "failed" } })).toBe('{"native":{"status":"failed"}}');
    expect(getReadableUploadError({ payload: "x".repeat(300) }).length).toBeLessThanOrEqual(221);
  });

  it.each([
    "User cancelled selection",
    { reason: "picker was canceled" },
    { localizedDescription: "No image selected" },
    { message: "User denied access to photos app" },
    { details: "Picker dismissed" },
  ])("recognises benign picker cancellation: %j", (error) => {
    expect(isCancelledSelectionError(error)).toBe(true);
  });

  it.each([
    new Error("Upload failed"),
    { code: "storage_quota_exceeded" },
    null,
  ])("does not hide a real upload failure as cancellation", (error) => {
    expect(isCancelledSelectionError(error)).toBe(false);
  });
});
