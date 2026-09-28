import type { HomeRewardClub } from "./homeEntitlementRepository";

export type HomeChild = {
  id: string;
  name: string;
  ignite_points: number | null;
};

export async function fetchPendingHomeRedemptions(client: any, userId: string) {
  const { data } = await client
    .from("reward_redemptions")
    .select(`
      id,
      reward_id,
      club_id,
      points_spent,
      status,
      redeemed_at,
      club_rewards (id, name, description, points_required, qr_code_url, show_qr_code),
      clubs!club_id (name)
    `)
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("redeemed_at", { ascending: false })
    .limit(1);
  return data ?? [];
}

export async function fetchAvailableHomeRewards(client: any, clubId: string) {
  const { data } = await client
    .from("club_rewards")
    .select("*, sponsors(id, name, logo_url)")
    .eq("club_id", clubId)
    .eq("is_active", true)
    .neq("reward_type", "player_of_match")
    .order("points_required", { ascending: true });
  return data ?? [];
}

export async function fetchNextHomeRewardInfo(
  client: any,
  rewardClubs: readonly Pick<HomeRewardClub, "id" | "hasPro">[],
  isAppAdmin: boolean,
): Promise<{ points_required: number; name: string } | null> {
  const eligibleClubIds = rewardClubs
    .filter((club) => isAppAdmin || club.hasPro)
    .map((club) => club.id);
  if (eligibleClubIds.length === 0) return null;

  const { data } = await client
    .from("club_rewards")
    .select("points_required, name")
    .in("club_id", eligibleClubIds)
    .eq("is_active", true)
    .neq("reward_type", "player_of_match")
    .order("points_required", { ascending: true })
    .limit(1);
  return data?.[0]
    ? { points_required: data[0].points_required, name: data[0].name }
    : null;
}

export async function fetchHomeUserChildren(
  client: any,
  userId: string,
): Promise<HomeChild[]> {
  const ownedPromise = client
    .from("children")
    .select("id, name, ignite_points")
    .eq("parent_id", userId);
  const guardianLinksPromise = client
    .from("child_guardians")
    .select("child_id, children:child_id!inner(id, name, ignite_points)")
    .eq("guardian_id", userId);

  const [{ data: owned }, { data: guardianLinks }] = await Promise.all([
    ownedPromise,
    guardianLinksPromise,
  ]);

  const merged = new Map<string, HomeChild>();
  (owned ?? []).forEach((child: HomeChild) => merged.set(child.id, child));
  (guardianLinks ?? []).forEach((row: { children?: HomeChild | null }) => {
    if (row.children) merged.set(row.children.id, row.children);
  });
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
