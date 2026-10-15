import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { MessageSquare, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

const SCOPE_LABEL: Record<string, string> = {
  all_members: "Competition chat (all members)",
  coordinators: "Coordinators chat",
  referees: "Referees chat",
  committee: "Committee chat",
};
const EMPTY_HINT: Record<string, string> = {
  all_members: "Turn on competition-wide chat to create it",
  coordinators: "Created once a team is entered",
  referees: "Add a referee below to create it",
  committee: "Add a committee member below to create it",
};
const ORDER = ["all_members", "coordinators", "referees", "committee"];

/** Quick links for competition admins to every chat of this competition. */
export function CompetitionChatsCard({ competitionId }: { competitionId: string }) {
  const navigate = useNavigate();
  const { data: chats = [] } = useQuery({
    queryKey: ["competition-chats-links", competitionId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("chat_groups") as any)
        .select("id, name, competition_scope, deleted_at")
        .eq("competition_id", competitionId);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        name: string;
        competition_scope: string | null;
        deleted_at: string | null;
      }[];
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Competition chats</CardTitle>
        <CardDescription>
          Competition admins are automatically in every chat for this competition.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {ORDER.map((scope) => {
          const chat = chats.find((c) => c.competition_scope === scope && !c.deleted_at);
          if (!chat) {
            return (
              <div
                key={scope}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-dashed border-border text-left opacity-70"
              >
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{SCOPE_LABEL[scope]}</p>
                  <p className="text-xs text-muted-foreground">{EMPTY_HINT[scope]}</p>
                </div>
              </div>
            );
          }
          return (
            <button
              key={scope}
              type="button"
              onClick={() => navigate(`/groups/${chat.id}`)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 text-left"
            >
              <MessageSquare className="h-4 w-4 text-primary" />
              <span className="flex-1 text-sm font-medium">{SCOPE_LABEL[scope]}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}
