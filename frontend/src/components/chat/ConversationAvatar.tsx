import { Flame, Megaphone } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getGroupIcon, getGroupSolidColor } from "@/lib/groupIcon";

// Fixed palette of brand-aligned colors with good white-text contrast
const AVATAR_COLORS = [
  "hsl(210, 60%, 42%)",  // Blue
  "hsl(340, 55%, 48%)",  // Rose
  "hsl(160, 50%, 38%)",  // Teal
  "hsl(270, 45%, 50%)",  // Purple
  "hsl(30, 65%, 45%)",   // Amber
  "hsl(190, 55%, 40%)",  // Cyan
  "hsl(0, 55%, 48%)",    // Red
  "hsl(120, 40%, 38%)",  // Green
  "hsl(250, 50%, 52%)",  // Indigo
  "hsl(15, 60%, 45%)",   // Orange
];

// Deterministic color from string hash
function getColorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Filler words to skip when generating initials
const FILLER_WORDS = new Set(["and", "&", "the", "of", "for", "in", "a", "an", "to"]);

// Generate 1-2 letter initials from a name
function getInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(w => !FILLER_WORDS.has(w.toLowerCase()));

  if (words.length === 0) return "?";
  if (words.length === 1) {
    // For single words like "U12", take first 2 chars
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

interface ConversationAvatarProps {
  type: 'club' | 'team' | 'group' | 'league' | 'dm' | 'broadcast' | 'support';
  name: string;
  avatarUrl?: string | null;
  /** Optional group category — used to pick a fallback icon for group/league avatars. */
  category?: string | null;
  className?: string;
}

export function ConversationAvatar({ type, name, avatarUrl, category, className = "h-10 w-10" }: ConversationAvatarProps) {
  const bgColor = getColorForName(name);
  const initials = getInitials(name);

  // Support — Ignite flame icon
  if (type === 'support') {
    return (
      <div
        className={`${className} rounded-full flex items-center justify-center shrink-0`}
        style={{ backgroundColor: 'hsl(142, 71%, 45%)' }}
      >
        <Flame className="h-5 w-5 text-white" />
      </div>
    );
  }

  // Broadcast — megaphone icon
  if (type === 'broadcast') {
    return (
      <div
        className={`${className} rounded-full flex items-center justify-center shrink-0`}
        style={{ backgroundColor: 'hsl(142, 71%, 45%)' }}
      >
        <Megaphone className="h-5 w-5 text-white" />
      </div>
    );
  }

  // DM — profile photo with initial fallback
  if (type === 'dm') {
    return (
      <Avatar className={`${className} shrink-0`}>
        <AvatarImage src={avatarUrl || undefined} />
        <AvatarFallback
          className="text-white font-bold text-sm"
          style={{ backgroundColor: bgColor }}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
    );
  }

  // Team / Club — logo with initial fallback
  if (type === 'team' || type === 'club') {
    return (
      <Avatar className={`${className} shrink-0`}>
        <AvatarImage src={avatarUrl || undefined} />
        <AvatarFallback
          className="text-white font-bold text-sm"
          style={{ backgroundColor: bgColor }}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
    );
  }

  // Group / League — uploaded image takes precedence, otherwise a keyword-based
  // icon (e.g. canteen → utensils, uniforms → shirt) so groups are easier to
  // tell apart at a glance. Falls back to initials only if no icon matches.
  if (avatarUrl) {
    return (
      <Avatar className={`${className} shrink-0`}>
        <AvatarImage src={avatarUrl} />
        <AvatarFallback className="text-white font-bold text-sm" style={{ backgroundColor: bgColor }}>
          {initials}
        </AvatarFallback>
      </Avatar>
    );
  }
  const Icon = getGroupIcon(name, category);
  const solid = getGroupSolidColor(name);
  return (
    <div
      className={`${className} rounded-full flex items-center justify-center shrink-0`}
      style={{ backgroundColor: solid }}
    >
      <Icon className="h-[55%] w-[55%] text-white" strokeWidth={2.25} />
    </div>
  );
}
