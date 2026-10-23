import { supabase } from "@/integrations/supabase/client";

/**
 * Sends the competition welcome email (e.g. Women's Masters) to an existing
 * member who was just given a role on a team. The email service only sends it
 * when the team is entered in a competition with a saved welcome message;
 * otherwise it skips silently, so other clubs' behaviour is unchanged.
 */
export async function sendCompetitionWelcomeEmail(opts: {
  userId: string;
  recipientName?: string | null;
  teamId: string;
  teamName: string;
  clubId: string;
  clubName?: string | null;
  roleName: string;
}): Promise<void> {
  try {
    let clubName = opts.clubName ?? null;
    if (!clubName) {
      const { data } = await supabase.from("clubs").select("name").eq("id", opts.clubId).maybeSingle();
      clubName = data?.name ?? null;
    }
    if (!clubName) return;
    await supabase.functions.invoke("send-email", {
      body: {
        toUserId: opts.userId,
        subject: `${clubName}: You've been added to ${opts.teamName}`,
        template: "team-invite",
        templateData: {
          recipientName: opts.recipientName || opts.roleName,
          teamName: opts.teamName,
          clubName,
          roleName: opts.roleName,
          inviteLink: `${window.location.origin}/teams/${opts.teamId}`,
          onlyIfCompetitionWelcome: true,
        },
      },
    });
  } catch (err) {
    console.warn("[competitionWelcome] email failed", err);
  }
}
