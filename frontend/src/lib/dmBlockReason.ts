import { supabase } from "@/integrations/supabase/client";

export type DmBlockReason =
  | "no_shared_club"
  | "no_shared_pro_club"
  | "dms_disabled"
  | "role_not_allowed";

export const DM_BLOCK_FALLBACK =
  "Direct messages require both users to be members of a Pro club.";

export function dmBlockMessage(reason: string | null | undefined): string {
  switch (reason) {
    case "no_shared_club":
      return "You can only message people in a club you share.";
    case "no_shared_pro_club":
      return "Private messages need a Pro club you both belong to.";
    case "dms_disabled":
      return "Private messages are turned off for this club.";
    case "role_not_allowed":
      return "This club only lets admins send private messages. Ask a club admin to allow your role.";
    default:
      return DM_BLOCK_FALLBACK;
  }
}

/** Returns the reason code, or null when it can't be loaded. */
export async function fetchDmBlockReason(otherUserId: string): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("dm_block_reason", {
    other_user_id: otherUserId,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}
