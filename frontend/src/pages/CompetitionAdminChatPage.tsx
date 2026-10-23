import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { cn } from "@/lib/utils";

interface Msg {
  id: string;
  author_id: string;
  text: string;
  is_admin_reply: boolean;
  created_at: string;
}

/**
 * Private thread between one participant and a competition's Owner/Admin
 * role holders. Access is enforced by RLS (club admins have none).
 */
export default function CompetitionAdminChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const db = supabase as any;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const { data: conv, isLoading: convLoading } = useQuery({
    queryKey: ["competition-admin-conv", conversationId],
    enabled: !!conversationId && !!user,
    queryFn: async () => {
      const { data } = await db
        .from("competition_admin_conversations")
        .select("id, competition_id, member_user_id, competitions:competition_id(name)")
        .eq("id", conversationId)
        .maybeSingle();
      return data;
    },
  });

  const messagesKey = ["competition-admin-messages", conversationId];
  const { data: messages = [] } = useQuery({
    queryKey: messagesKey,
    enabled: !!conv,
    refetchOnMount: "always",
    queryFn: async (): Promise<Msg[]> => {
      const { data } = await db
        .from("competition_admin_messages")
        .select("id, author_id, text, is_admin_reply, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(500);
      return data ?? [];
    },
  });

  const authorIds = [...new Set(messages.map((m) => m.author_id))];
  const { data: profiles } = useQuery({
    queryKey: ["competition-admin-authors", authorIds.join(",")],
    enabled: authorIds.length > 0,
    queryFn: () => fetchProfilesWithCache(authorIds),
  });

  useEffect(() => {
    if (!conversationId || !conv) return;
    const channel = supabase
      .channel(`competition-admin-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "competition_admin_messages", filter: `conversation_id=eq.${conversationId}` },
        () => qc.invalidateQueries({ queryKey: messagesKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, !!conv]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending || !user) return;
    setSending(true);
    const { error } = await db
      .from("competition_admin_messages")
      .insert({ conversation_id: conversationId, author_id: user.id, text: body });
    setSending(false);
    if (error) {
      toast({ title: "Message not sent", description: "Please try again.", variant: "destructive" });
      return;
    }
    setText("");
    qc.invalidateQueries({ queryKey: messagesKey });
    qc.invalidateQueries({ queryKey: ["competition-admin-inbox"] });
  };

  if (!convLoading && !conv) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">Conversation not found</p>
        <Button onClick={() => navigate("/messages")}>Go to Messages</Button>
      </div>
    );
  }

  const isMember = conv?.member_user_id === user?.id;
  const compName = conv?.competitions?.name ?? "Competition";
  const memberName = conv ? profiles?.get(conv.member_user_id)?.display_name : undefined;
  const title = isMember ? `${compName} admins` : memberName ?? "Member";

  return (
    <div className="flex flex-col h-[100dvh] bg-background">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background pt-[max(env(safe-area-inset-top),0.5rem)]">
        <Button variant="ghost" size="icon" aria-label="Go back" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Trophy className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="font-semibold truncate text-sm">{title}</h1>
          <p className="text-xs text-muted-foreground truncate">
            {isMember ? "Only the competition admins can see this" : `${compName} · competition admins`}
          </p>
        </div>
      </header>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {messages.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-10">
            {isMember ? "Send a message to the competition admins." : "No messages yet."}
          </p>
        )}
        {messages.map((m) => {
          const mine = m.author_id === user?.id;
          const name = m.is_admin_reply
            ? `${profiles?.get(m.author_id)?.display_name ?? "Admin"} · Competition admin`
            : profiles?.get(m.author_id)?.display_name ?? "Member";
          return (
            <div key={m.id} className={cn("flex flex-col max-w-[80%]", mine ? "ml-auto items-end" : "items-start")}>
              {!mine && <span className="text-[11px] text-muted-foreground px-1 mb-0.5">{name}</span>}
              <div className={cn("rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words", mine ? "bg-primary text-primary-foreground" : "bg-card border border-border")}>
                {m.text}
              </div>
              <span className="text-[10px] text-muted-foreground px-1 mt-0.5">{formatTimeShort(m.created_at)}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border bg-background p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message…"
          rows={1}
          maxLength={4000}
          className="min-h-[40px] max-h-32 resize-none"
        />
        <Button size="icon" onClick={send} disabled={!text.trim() || sending} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
