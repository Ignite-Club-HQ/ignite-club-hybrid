import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, MessageCircle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveCompetitionAdminThreads, listLiveLatestMessagesPage } from "@/live/features/messaging";

interface ThreadRow {
  id: string;
  memberId: string;
  memberName: string;
  preview: string;
  updatedAt: string;
}

/** hostClubId: the club running the competition, whose canisters hold its threads. */
export function CompetitionAdminInboxCard({ competitionId, hostClubId }: { competitionId: string; hostClubId?: string | null }) {
  const { data: threads = [], isLoading } = useQuery({
    queryKey: ["competition-admin-inbox", competitionId],
    enabled: !!competitionId,
    staleTime: 30_000,
    queryFn: () => withFeatureBackend("messaging", {
      supabase: async () => {
        const { data: groups, error } = await supabase
          .from("chat_groups")
          .select("id, created_by")
          .eq("competition_id", competitionId)
          .eq("competition_scope", "admin_contact")
          .is("deleted_at", null);
        if (error) throw error;
        const rows = groups ?? [];
        if (rows.length === 0) return [];
        const ids = rows.map((row) => row.id);
        const [{ data: messages, error: messageError }, profiles] = await Promise.all([
          supabase
            .from("group_messages")
            .select("group_id, text, image_url, created_at")
            .in("group_id", ids)
            .is("deleted_at", null)
            .order("created_at", { ascending: false }),
          fetchProfilesWithCache(rows.map((row) => row.created_by)),
        ]);
        if (messageError) throw messageError;
        const latestByGroup = new Map<string, (typeof messages)[number]>();
        for (const message of messages ?? []) {
          if (!latestByGroup.has(message.group_id)) latestByGroup.set(message.group_id, message);
        }
        return rows.flatMap((row) => {
          const latest = latestByGroup.get(row.id);
          if (!latest) return [];
          const profile = profiles.get(row.created_by);
          return [{
            id: row.id,
            memberId: row.created_by,
            memberName: profile?.display_name || "Competition member",
            preview: latest.text || (latest.image_url ? "Attachment" : ""),
            updatedAt: latest.created_at,
          }];
        }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      },
      icp: async (ctx) => {
        const rows = await listLiveCompetitionAdminThreads(ctx, competitionId);
        if (rows.length === 0) return [];
        const profiles = await fetchProfilesWithCache(rows.map((row) => row.member));
        return (await Promise.all(rows.map(async (row) => {
          try {
            const page = await listLiveLatestMessagesPage(ctx, row.id, null, 1);
            const latest = page.messages[0];
            if (!latest) return null;
            const attachment = latest.attachment?.[0];
            return {
              id: row.id,
              memberId: row.member,
              memberName: profiles.get(row.member)?.display_name || "Competition member",
              preview: latest.body || (attachment ? "Attachment" : ""),
              updatedAt: new Date(Number(latest.created_at_ms)).toISOString(),
            };
          } catch {
            return null;
          }
        }))).filter((row): row is ThreadRow => row !== null)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      },
    }, hostClubId ? { clubId: hostClubId } : undefined),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4" /> Admin inbox
        </CardTitle>
        <CardDescription>Private conversations with competition members.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin" /></div>
        ) : threads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No member conversations yet.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {threads.map((thread) => (
              <Button
                key={thread.id}
                asChild
                variant="ghost"
                className="h-auto min-h-14 w-full justify-start rounded-none px-3 py-2 text-left first:rounded-t-md last:rounded-b-md"
              >
                <Link to={`/groups/${encodeURIComponent(thread.id)}`}>
                  <Avatar className="mr-3 h-8 w-8 shrink-0">
                    <AvatarFallback>{thread.memberName.charAt(0).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{thread.memberName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{thread.preview}</span>
                  </span>
                </Link>
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}