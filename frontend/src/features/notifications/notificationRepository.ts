import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

export const CROSS_CLUB_NOTIFICATION_TYPES = [
  "direct_message",
  "streak_progress",
  "reward_unlocked",
] as const;

export type NotificationListItem = {
  id: string;
  user_id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
  related_id: string | null;
};

function clubScopeFilter(clubId: string): string {
  return `club_id.eq.${clubId},type.in.(${CROSS_CLUB_NOTIFICATION_TYPES.join(",")})`;
}

export async function listNotifications(
  userId: string,
  activeClubId: string | null,
  client: IgniteSupabaseClient = supabase,
): Promise<NotificationListItem[]> {
  let query = client
    .from("notifications")
    .select("id, user_id, type, message, related_id, is_read, created_at, club_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(500);
  if (activeClubId) query = query.or(clubScopeFilter(activeClubId));
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((notification) => ({
    id: notification.id,
    user_id: notification.user_id,
    type: notification.type,
    message: notification.message,
    related_id: notification.related_id,
    created_at: notification.created_at,
    read: notification.is_read,
  }));
}

export async function markNotificationRead(
  notificationId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  const { error } = await client.from("notifications").update({ is_read: true }).eq("id", notificationId);
  if (error) throw error;
  return notificationId;
}

export async function markAllNotificationsRead(
  userId: string,
  activeClubId: string | null,
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  let query = client.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
  if (activeClubId) query = query.or(clubScopeFilter(activeClubId));
  const { error } = await query;
  if (error) throw error;
}

export async function deleteNotification(
  notificationId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  const { error } = await client.from("notifications").delete().eq("id", notificationId);
  if (error) throw error;
  return notificationId;
}

export async function clearNotifications(
  userId: string,
  activeClubId: string | null,
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  let query = client.from("notifications").delete().eq("user_id", userId);
  if (activeClubId) query = query.or(clubScopeFilter(activeClubId));
  const { error } = await query;
  if (error) throw error;
}
