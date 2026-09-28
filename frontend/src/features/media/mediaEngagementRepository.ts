import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type IgniteSupabaseClient = SupabaseClient<Database>;

export async function replaceMediaReaction(
  input: { photoId: string; userId: string; reactionType: string },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  const { error: deleteError } = await client.from("photo_reactions").delete()
    .eq("photo_id", input.photoId).eq("user_id", input.userId);
  if (deleteError) throw deleteError;

  const { error: insertError } = await client.from("photo_reactions").insert({
    photo_id: input.photoId,
    user_id: input.userId,
    reaction_type: input.reactionType,
  });
  if (insertError) throw insertError;
}

export async function removeMediaReaction(
  input: { photoId: string; userId: string },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  const { error } = await client.from("photo_reactions").delete()
    .eq("photo_id", input.photoId).eq("user_id", input.userId);
  if (error) throw error;
}

export async function createMediaComment(
  input: { photoId: string; userId: string; text: string; replyToId?: string },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  const { error } = await client.from("photo_comments").insert({
    photo_id: input.photoId,
    user_id: input.userId,
    text: input.text,
    reply_to_id: input.replyToId || null,
  });
  if (error) throw error;
}
