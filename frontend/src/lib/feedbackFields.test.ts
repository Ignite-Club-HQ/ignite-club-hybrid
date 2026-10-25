import { describe, expect, it } from "vitest";
import { decodeFeedbackFields, encodeFeedbackMessage } from "./feedbackFields";
describe("feedback field interpretation", () => {
  it("preserves the new title and description separately", () => {
    expect(decodeFeedbackFields("Problem", encodeFeedbackMessage("Details"))).toEqual({ title: "Problem", description: "Details" });
  });
  it("reads the previous producer without rewriting stored data", () => {
    expect(decodeFeedbackFields("Details", "Problem")).toEqual({ title: "Problem", description: "Details" });
  });
});