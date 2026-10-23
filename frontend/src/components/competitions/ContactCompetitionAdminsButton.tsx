import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, ChevronRight, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";

interface ContactableCompetition {
  id: string;
  name: string;
  logo_url: string | null;
}

/**
 * Opens (or creates) the caller's private chat with a competition's
 * Owner/Admin role holders. The thread is a normal chat group, so it uses
 * the full chat interface. Membership is managed server-side: the caller
 * plus competition owners/admins only — club admins are never added.
 */
export function useOpenCompetitionAdminChat() {
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const open = async (competitionId: string) => {
    if (busyId) return;
    setBusyId(competitionId);
    try {
      const { data, error } = await (supabase as any).rpc("get_or_create_competition_admin_chat", {
        p_competition_id: competitionId,
      });
      if (error) throw error;
      navigate(`/groups/${data}`);
    } catch (err: any) {
      toast({
        title: "Unable to contact competition admins",
        description: err.message || "Please try again later",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };
  return { open, busyId };
}

function ContactCard({
  comp,
  busy,
  compact,
  onClick,
}: {
  comp: ContactableCompetition;
  busy: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="w-full text-left">
      <Card className="hover:border-primary/50 transition-colors border-primary/20 bg-primary/5">
        <CardContent className={`flex items-center gap-3 ${compact ? "p-3" : "p-4"}`}>
          <div className="relative">
            <Avatar className={compact ? "h-9 w-9" : "h-10 w-10"}>
              <AvatarImage src={comp.logo_url || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary">
                <Trophy className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full bg-primary flex items-center justify-center border-2 border-background">
              <MessageSquare className="h-2.5 w-2.5 text-primary-foreground" />
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={`truncate font-semibold ${compact ? "text-sm" : ""}`}>Contact {comp.name} admins</h3>
            <p className={`text-muted-foreground truncate ${compact ? "text-xs" : "text-sm"}`}>
              {busy ? "Opening conversation..." : "Message the competition organisers directly"}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </CardContent>
      </Card>
    </button>
  );
}

function useContactableCompetitions(clubFilter: string | null | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["contactable-competitions", user?.id, clubFilter ?? null],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ContactableCompetition[]> => {
      const { data, error } = await (supabase as any).rpc("list_contactable_competitions", {
        p_club_id: clubFilter ?? null,
      });
      if (error) {
        console.warn("[list_contactable_competitions]", error);
        return [];
      }
      return data ?? [];
    },
  });
}

/** Single competition (competition detail page). */
export function ContactCompetitionAdminsButton({
  competitionId,
  competitionName,
}: {
  competitionId: string;
  competitionName: string;
}) {
  const { data = [] } = useContactableCompetitions(null);
  const { open, busyId } = useOpenCompetitionAdminChat();
  const comp = data.find((c) => c.id === competitionId);
  if (!comp) return null;
  return (
    <ContactCard
      comp={{ ...comp, name: comp.name || competitionName }}
      busy={busyId === competitionId}
      compact
      onClick={() => open(competitionId)}
    />
  );
}

/** Every competition the user can contact, scoped to the active club (home / messages). */
export function ContactCompetitionAdminsList({
  clubFilter,
  compact = false,
}: {
  clubFilter?: string | null;
  compact?: boolean;
}) {
  const { data = [] } = useContactableCompetitions(clubFilter);
  const { open, busyId } = useOpenCompetitionAdminChat();
  if (!data.length) return null;
  return (
    <>
      {data.map((c) => (
        <ContactCard key={c.id} comp={c} busy={busyId === c.id} compact={compact} onClick={() => open(c.id)} />
      ))}
    </>
  );
}
