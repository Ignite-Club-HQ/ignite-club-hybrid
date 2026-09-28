import {
  Award,
  Bell,
  Briefcase,
  Building2,
  Bus,
  Cake,
  Calendar,
  Camera,
  ClipboardList,
  Coffee,
  Coins,
  Drum,
  Dumbbell,
  Flag,
  Flame,
  Gift,
  Goal,
  HandHeart,
  HardHat,
  Landmark,
  Megaphone,
  Music,
  PartyPopper,
  PiggyBank,
  Pizza,
  Receipt,
  Shield,
  Shirt,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Ticket,
  TrafficCone,
  Trophy,
  Users,
  Utensils,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Semantic categories drive both the icon and the tinted background, so
 * groups of the same "kind" share a colour family (coaching = green,
 * governance = amber, operations = blue, events = purple, etc.) while still
 * staying visually quiet enough not to dominate a row.
 */
export type GroupSemanticCategory =
  | "coaching"
  | "governance"
  | "finance"
  | "operations"
  | "volunteers"
  | "food"
  | "merch"
  | "events"
  | "communications"
  | "media"
  | "match"
  | "health"
  | "transport"
  | "social"
  | "community"
  | "other";

interface ToneSpec {
  bg: string;
  fg: string;
  ring: string;
  solid: string;
}

const SEMANTIC_TONES: Record<GroupSemanticCategory, ToneSpec> = {
  coaching:       { bg: "bg-emerald-500/10",  fg: "text-emerald-600 dark:text-emerald-400",  ring: "ring-emerald-500/20",  solid: "hsl(160, 50%, 38%)" },
  governance:     { bg: "bg-amber-500/10",    fg: "text-amber-700 dark:text-amber-400",      ring: "ring-amber-500/20",    solid: "hsl(38, 70%, 42%)"  },
  finance:        { bg: "bg-amber-500/10",    fg: "text-amber-700 dark:text-amber-400",      ring: "ring-amber-500/20",    solid: "hsl(45, 80%, 40%)"  },
  operations:     { bg: "bg-sky-500/10",      fg: "text-sky-700 dark:text-sky-400",          ring: "ring-sky-500/20",      solid: "hsl(210, 60%, 42%)" },
  volunteers:     { bg: "bg-teal-500/10",     fg: "text-teal-700 dark:text-teal-400",        ring: "ring-teal-500/20",     solid: "hsl(180, 50%, 36%)" },
  food:           { bg: "bg-orange-500/10",   fg: "text-orange-700 dark:text-orange-400",    ring: "ring-orange-500/20",   solid: "hsl(20, 70%, 48%)"  },
  merch:          { bg: "bg-indigo-500/10",   fg: "text-indigo-700 dark:text-indigo-400",    ring: "ring-indigo-500/20",   solid: "hsl(245, 50%, 50%)" },
  events:         { bg: "bg-purple-500/10",   fg: "text-purple-700 dark:text-purple-400",    ring: "ring-purple-500/20",   solid: "hsl(270, 45%, 50%)" },
  communications: { bg: "bg-fuchsia-500/10",  fg: "text-fuchsia-700 dark:text-fuchsia-400",  ring: "ring-fuchsia-500/20",  solid: "hsl(290, 55%, 50%)" },
  media:          { bg: "bg-pink-500/10",     fg: "text-pink-700 dark:text-pink-400",        ring: "ring-pink-500/20",     solid: "hsl(330, 55%, 48%)" },
  match:          { bg: "bg-amber-500/10",    fg: "text-amber-700 dark:text-amber-400",      ring: "ring-amber-500/20",    solid: "hsl(35, 80%, 45%)"  },
  health:         { bg: "bg-rose-500/10",     fg: "text-rose-700 dark:text-rose-400",        ring: "ring-rose-500/20",     solid: "hsl(0, 55%, 48%)"   },
  transport:      { bg: "bg-cyan-500/10",     fg: "text-cyan-700 dark:text-cyan-400",        ring: "ring-cyan-500/20",     solid: "hsl(190, 55%, 40%)" },
  social:         { bg: "bg-pink-500/10",     fg: "text-pink-700 dark:text-pink-400",        ring: "ring-pink-500/20",     solid: "hsl(340, 55%, 48%)" },
  community:      { bg: "bg-blue-500/10",     fg: "text-blue-700 dark:text-blue-400",        ring: "ring-blue-500/20",     solid: "hsl(220, 50%, 48%)" },
  other:          { bg: "bg-muted",           fg: "text-muted-foreground",                   ring: "ring-border",          solid: "hsl(220, 10%, 45%)" },
};

interface Rule {
  match: RegExp;
  icon: LucideIcon;
  semantic: GroupSemanticCategory;
}

// Order matters — more specific phrases first.
const RULES: Rule[] = [
  // Coaching / Leadership
  { match: /coach(?:es|ing)?|coordinator|trainer|mentor/i, icon: ClipboardList, semantic: "coaching" },
  { match: /tact|playbook|line ?up|game ?plan/i,           icon: Goal,          semantic: "coaching" },
  { match: /captain|leader(?:ship)?/i,                     icon: Goal,          semantic: "coaching" },
  { match: /training|practice|drills?|conditioning/i,      icon: Dumbbell,      semantic: "coaching" },

  // Governance / Committee
  { match: /committee|board|exec(?:utive)?|governance/i,   icon: Shield,        semantic: "governance" },
  { match: /club ?house|head ?quarters|hq\b|office/i,      icon: Building2,     semantic: "governance" },
  { match: /policy|policies|rules|by ?laws|constitution/i, icon: Landmark,      semantic: "governance" },
  { match: /admin(?:s|istration)?|management/i,            icon: Shield,        semantic: "governance" },

  // Finance
  { match: /finance|treasur|accounts?|budget/i,            icon: Coins,         semantic: "finance" },
  { match: /payment|fees|invoice|registr|enrol/i,          icon: Receipt,       semantic: "finance" },
  { match: /fundrais|donat|raffle|sponsor/i,               icon: PiggyBank,     semantic: "finance" },

  // Operations — grounds, gear, safety
  { match: /maintenance|repair|setup|pack ?down|equipment|gear/i, icon: Wrench, semantic: "operations" },
  { match: /ground|field|pitch|court|facility|facilities|venue/i, icon: TrafficCone, semantic: "operations" },
  { match: /safety|wh&?s|risk|emergency/i,                 icon: HardHat,       semantic: "operations" },
  { match: /logistics|operations?|\bops\b/i,               icon: Wrench,        semantic: "operations" },
  { match: /roster|signup|sign-?up|sheet|list/i,           icon: ClipboardList, semantic: "operations" },

  // Food
  { match: /canteen|kitchen|catering|lunch|breakfast/i,    icon: Utensils,      semantic: "food" },
  { match: /bbq|barbecue|grill/i,                          icon: Flame,         semantic: "food" },
  { match: /pizza|dinner|food/i,                           icon: Pizza,         semantic: "food" },
  { match: /coffee|cafe|tea/i,                             icon: Coffee,        semantic: "food" },
  { match: /cake|bake/i,                                   icon: Cake,          semantic: "food" },

  // Merch
  { match: /uniform|kit|merch|apparel/i,                   icon: Shirt,         semantic: "merch" },
  { match: /shop|store/i,                                  icon: ShoppingBag,   semantic: "merch" },

  // Communications
  { match: /announce|news|notice|broadcast|comms?/i,       icon: Megaphone,     semantic: "communications" },
  { match: /alert|reminder|notif/i,                        icon: Bell,          semantic: "communications" },

  // Media
  { match: /photo|gallery|image|video|stream|footage/i,    icon: Camera,        semantic: "media" },

  // Events / Social
  { match: /presentation|awards? night|gala|trophy night/i, icon: Award,        semantic: "events" },
  { match: /ticket|booking/i,                              icon: Ticket,        semantic: "events" },
  { match: /music|band|song|dj/i,                          icon: Music,         semantic: "events" },
  { match: /parade|march/i,                                icon: Drum,          semantic: "events" },
  { match: /social|party|celebrat|function|gathering/i,    icon: PartyPopper,   semantic: "social" },
  { match: /event|fixture|\bday\b|\bnight\b/i,             icon: Calendar,      semantic: "events" },
  { match: /gift|prize|present/i,                          icon: Gift,          semantic: "events" },

  // Match
  { match: /referee|umpire|official/i,                     icon: Flag,          semantic: "match" },
  { match: /match|game|comp(?:etition)?|fixtures?|finals?/i, icon: Trophy,      semantic: "match" },

  // Health
  { match: /first ?aid|medic|physio|injury|health|wellbeing/i, icon: Stethoscope, semantic: "health" },

  // Transport
  { match: /transport|bus|carpool|travel|driver|shuttle/i, icon: Bus,           semantic: "transport" },

  // Volunteers / community catch-alls
  { match: /volunteer|help(?:er)?s?|crew/i,                icon: HandHeart,     semantic: "volunteers" },
  { match: /parent|family|member|community|squad|supporters?/i, icon: Users,    semantic: "community" },
];

// Category-fallback when no keyword hits — maps the user-set `chat_groups.category`
// enum to a sensible icon + tinted background.
const CATEGORY_FALLBACK: Record<string, { icon: LucideIcon; semantic: GroupSemanticCategory }> = {
  operations:  { icon: Wrench,    semantic: "operations" },
  volunteers:  { icon: HandHeart, semantic: "volunteers" },
  events:      { icon: Calendar,  semantic: "events" },
  "match day": { icon: Trophy,    semantic: "match" },
  admin:       { icon: Shield,    semantic: "governance" },
  finance:     { icon: Coins,     semantic: "finance" },
  other:       { icon: Sparkles,  semantic: "other" },
};

function resolve(name: string, category?: string | null): {
  icon: LucideIcon;
  semantic: GroupSemanticCategory;
} {
  const rule = RULES.find((r) => r.match.test(name));
  if (rule) return { icon: rule.icon, semantic: rule.semantic };
  const key = (category ?? "").trim().toLowerCase();
  const fb = CATEGORY_FALLBACK[key];
  if (fb) return { icon: fb.icon, semantic: fb.semantic };
  return { icon: Briefcase, semantic: "other" };
}

export interface GroupVisual {
  Icon: LucideIcon;
  semantic: GroupSemanticCategory;
  /** Combined Tailwind classes: subtle tinted background + foreground + ring. */
  tone: string;
  bgClass: string;
  fgClass: string;
  ringClass: string;
  /** Solid HSL — used by ConversationAvatar when no upload is set. */
  solidColor: string;
}

export function getGroupVisual(name: string, category?: string | null): GroupVisual {
  const { icon, semantic } = resolve(name, category);
  const t = SEMANTIC_TONES[semantic];
  return {
    Icon: icon,
    semantic,
    tone: `${t.bg} ${t.fg} ring-1 ${t.ring}`,
    bgClass: t.bg,
    fgClass: t.fg,
    ringClass: t.ring,
    solidColor: t.solid,
  };
}

// Backward-compatible helpers used elsewhere (ConversationAvatar, etc.)
export function getGroupIcon(name: string, category?: string | null): LucideIcon {
  return resolve(name, category).icon;
}

export function getGroupTone(name: string, category?: string | null): string {
  return getGroupVisual(name, category).tone;
}

export function getGroupSolidColor(name: string, category?: string | null): string {
  return getGroupVisual(name, category).solidColor;
}
