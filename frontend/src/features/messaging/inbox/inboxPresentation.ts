import type { CSSProperties } from "react";

const TYPE_ACCENT_HSL: Record<string, string | undefined> = {
  team: "142 71% 42%",
  club: "210 85% 52%",
  group: "25 92% 52%",
  admin_group: "210 85% 52%",
  league: "270 60% 55%",
  dm: undefined,
  broadcast: undefined,
  support: undefined,
};

export function conversationTypeAccentStyle(type: string): CSSProperties | undefined {
  const hue = TYPE_ACCENT_HSL[type];
  return hue
    ? { borderLeftWidth: 3, borderLeftStyle: "solid", borderLeftColor: `hsl(${hue})` }
    : undefined;
}

export function conversationTypeBadgeStyle(type: string): CSSProperties | undefined {
  const hue = TYPE_ACCENT_HSL[type];
  return hue
    ? {
        color: `hsl(${hue})`,
        borderColor: `hsl(${hue} / 0.4)`,
        backgroundColor: `hsl(${hue} / 0.08)`,
      }
    : undefined;
}

export function conversationTypeActiveStyle(type: string): CSSProperties | undefined {
  const hue = TYPE_ACCENT_HSL[type];
  return hue
    ? {
        backgroundColor: `hsl(${hue} / 0.14)`,
        color: `hsl(${hue})`,
        borderColor: `hsl(${hue} / 0.45)`,
      }
    : undefined;
}

export function isSystemReminderText(text: string | null | undefined): boolean {
  return Boolean(text && /\[galleryprompt:[0-9a-f-]{36}\]/i.test(text));
}

export function getFirstName(fullName: string | undefined): string {
  return fullName ? fullName.split(" ")[0] : "";
}

export function abbreviateClubName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) return name;
  return `${words[0]} ${words
    .slice(1)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")}`;
}
