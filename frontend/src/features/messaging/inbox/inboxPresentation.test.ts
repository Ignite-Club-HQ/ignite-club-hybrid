import { describe, expect, it } from "vitest";
import {
  abbreviateClubName,
  conversationTypeAccentStyle,
  conversationTypeActiveStyle,
  conversationTypeBadgeStyle,
  getFirstName,
  isSystemReminderText,
} from "./inboxPresentation";

describe("inboxPresentation", () => {
  it("keeps neutral conversation types unstyled and accents scoped conversations", () => {
    expect(conversationTypeAccentStyle("dm")).toBeUndefined();
    expect(conversationTypeBadgeStyle("support")).toBeUndefined();
    expect(conversationTypeAccentStyle("team")).toEqual({
      borderLeftWidth: 3,
      borderLeftStyle: "solid",
      borderLeftColor: "hsl(142 71% 42%)",
    });
    expect(conversationTypeActiveStyle("club")).toEqual({
      backgroundColor: "hsl(210 85% 52% / 0.14)",
      color: "hsl(210 85% 52%)",
      borderColor: "hsl(210 85% 52% / 0.45)",
    });
  });

  it("preserves system reminder detection and conversation-name formatting", () => {
    expect(isSystemReminderText("[galleryprompt:0d5f926a-da4a-4cb8-9ee6-467dfd802414]")).toBe(true);
    expect(isSystemReminderText("A normal message")).toBe(false);
    expect(getFirstName("Taylor Smith")).toBe("Taylor");
    expect(abbreviateClubName("Bridgewater Soccer Club")).toBe("Bridgewater SC");
  });
});
