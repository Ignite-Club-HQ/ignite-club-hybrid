/**
 * Club filter handling when a user accepts an invite.
 *
 * Historically we only ever *seeded* the active club filter (see
 * `seedClubFilterFromInvite`), which deliberately refuses to override an
 * explicit choice. That left existing members of Club A who accepted an invite
 * to Club B still filtered to Club A, with no indication Club B existed.
 *
 * Accepting an invite is a USER-DRIVEN action, so it MAY move the club filter.
 * This helper is the ONLY place allowed to switch on that basis, and it always
 * announces the switch with an Undo affordance so the previous club is one tap
 * away (`setActiveClubTheme` restores state + localStorage + profile row).
 */
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { seedClubFilterFromInvite } from "./seedClubFilterFromInvite";

const STORAGE_KEY_PREFIX = "ignite-club-theme-";
const NO_CLUB_THEME_SENTINEL = "__ignite_no_club__";

function readStoredClubId(userId: string): string | null {
  try {
    const value = localStorage.getItem(`${STORAGE_KEY_PREFIX}${userId}`);
    if (!value || value === NO_CLUB_THEME_SENTINEL) return null;
    return value;
  } catch {
    return null;
  }
}

async function fetchClubNames(clubIds: string[]): Promise<Record<string, string>> {
  const ids = clubIds.filter(Boolean);
  if (!ids.length) return {};
  try {
    const { data } = await supabase.from("clubs").select("id, name").in("id", ids);
    const map: Record<string, string> = {};
    (data || []).forEach((row: any) => {
      if (row?.id && row?.name) map[row.id] = String(row.name).trim();
    });
    return map;
  } catch {
    return {};
  }
}

export interface InviteClubSwitchResult {
  /** True when the active club filter now points at the invited club. */
  switched: boolean;
  /** The real club id the user was on before, when we overrode it. */
  previousClubId: string | null;
}

export async function applyInviteClubSwitch(
  userId: string | null | undefined,
  invitedClubId: string | null | undefined,
  setActiveClubTheme: (clubId: string | null) => void,
  options: { source?: string; announce?: boolean } = {},
): Promise<InviteClubSwitchResult> {
  if (!userId || !invitedClubId) return { switched: false, previousClubId: null };
  if (typeof window === "undefined") return { switched: false, previousClubId: null };

  const { source = "invite", announce = true } = options;
  const previousClubId = readStoredClubId(userId);

  // Already on the invited club — never switch, never announce.
  if (previousClubId === invitedClubId) {
    return { switched: false, previousClubId };
  }

  // Normal path: no explicit preference yet (or still on the signup sentinel).
  const seeded = seedClubFilterFromInvite(userId, invitedClubId, setActiveClubTheme);
  if (seeded) {
    console.log(`[${source}] Seeded club filter from invite:`, invitedClubId);
    return { switched: true, previousClubId: null };
  }

  // The user is an existing member of a DIFFERENT club. Switch anyway — they
  // just accepted an invite — and tell them, with an Undo.
  setActiveClubTheme(invitedClubId);
  console.log(`[${source}] Switched club filter to newly joined club:`, {
    from: previousClubId,
    to: invitedClubId,
  });

  if (announce) {
    const names = await fetchClubNames([invitedClubId, previousClubId!].filter(Boolean) as string[]);
    const joinedName = names[invitedClubId] || "your new club";
    const previousName = previousClubId ? names[previousClubId] : null;

    toast.success(`You've joined ${joinedName}`, {
      description: previousName
        ? `We've switched you over — tap the club name in the header any time to switch back to ${previousName}.`
        : "We've switched you over — tap the club name in the header any time to switch clubs.",
      duration: 10000,
      action: previousClubId
        ? {
            label: "Undo",
            onClick: () => setActiveClubTheme(previousClubId),
          }
        : undefined,
    });
  }

  return { switched: true, previousClubId };
}
