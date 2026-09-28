// Deterministic avatar gradient + initial from a display name.
// Used by chat avatar fallbacks (ChatMessage, GroupChatMessageRow) so
// initials-based avatars feel intentional and personal — every member
// gets the same colour every time, across DMs / team / group chats.

// Muted, slightly desaturated palette — avatars support identification
// without dominating sender name or bubble. Each pair is a tonal gradient
// (low contrast within the chip) so initials read clearly and the chip
// doesn't pull focus from message content.
const PALETTES: Array<{ from: string; to: string; fg: string }> = [
  { from: "#B86B6B", to: "#9E5560", fg: "#ffffff" }, // dusty rose
  { from: "#B8895A", to: "#A06E45", fg: "#ffffff" }, // warm clay
  { from: "#6B9E7A", to: "#52806A", fg: "#ffffff" }, // sage
  { from: "#5A95A8", to: "#467A8E", fg: "#ffffff" }, // muted teal
  { from: "#6B82B3", to: "#52679A", fg: "#ffffff" }, // dusty blue
  { from: "#8576AC", to: "#6F5E96", fg: "#ffffff" }, // soft violet
  { from: "#A876A4", to: "#8E5F8E", fg: "#ffffff" }, // muted plum
  { from: "#6FA08D", to: "#558877", fg: "#ffffff" }, // seafoam
  { from: "#B89968", to: "#9E8050", fg: "#ffffff" }, // ochre
  { from: "#7A8896", to: "#5F6D7B", fg: "#ffffff" }, // slate
];

function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getAvatarPalette(name?: string | null) {
  const seed = (name || "?").trim().toLowerCase() || "?";
  return PALETTES[hash(seed) % PALETTES.length];
}

export function getAvatarInitial(name?: string | null): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  // First letter of first word; fall back to first char.
  return (trimmed[0] || "?").toUpperCase();
}

export function getAvatarFallbackStyle(
  name?: string | null,
): React.CSSProperties {
  const { from, to, fg } = getAvatarPalette(name);
  return {
    backgroundImage: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
    color: fg,
  };
}
