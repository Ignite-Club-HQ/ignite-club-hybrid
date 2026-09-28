import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Flame } from "lucide-react";
import { PageLoading } from "@/components/ui/page-loading";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useMemo } from "react";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabWelcomeMessage } from "@/lab/fixtureDataLayer";

// Helper to convert URLs and markdown-style links in text to clickable links
function renderTextWithLinks(text: string) {
  // Combined regex for markdown links [text](url) and plain URLs
  const combinedRegex = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(https?:\/\/[^\s\]]+)/g;
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = combinedRegex.exec(text)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // Markdown-style link: [text](url)
      const linkText = match[2];
      const url = match[3];
      result.push(
        <button
          key={match.index}
          onClick={() => safeOpenUrl(url)}
          className="text-primary underline hover:text-primary/80"
        >
          {linkText}
        </button>
      );
    } else if (match[4]) {
      // Plain URL
      result.push(
        <button
          key={match.index}
          onClick={() => safeOpenUrl(match[4])}
          className="text-primary underline hover:text-primary/80"
        >
          {match[4]}
        </button>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}

export default function WelcomeMessagePage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    const welcome = getLocalLabWelcomeMessage("club-icp-001");
    return (
      <div className="container max-w-2xl mx-auto px-4 py-10 text-center space-y-4">
        <Flame className="h-10 w-10 mx-auto text-primary" />
        <h1 className="text-lg font-semibold">Welcome</h1>
        <p className="text-sm text-muted-foreground">{welcome.message}</p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Go back
        </Button>
      </div>
    );
  }

  return <SupabaseWelcomeMessagePage />;
}

function SupabaseWelcomeMessagePage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: systemMessage, isLoading } = useQuery({
    queryKey: ["system-messages", user?.id, "welcome"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("system_messages")
        .select("*")
        .eq("user_id", user!.id)
        .eq("message_type", "welcome")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  if (isLoading) return <PageLoading />;

  if (!systemMessage) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">No welcome message found</p>
        <Button onClick={() => navigate("/messages")}>Go to Messages</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="h-10 w-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'hsl(142, 71%, 45%)' }}>
          <Flame className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="font-semibold">Ignite Support</h1>
          <p className="text-xs text-muted-foreground">Welcome & tips</p>
        </div>
      </div>

      {/* Message */}
      <ScrollArea className="flex-1 pr-4 -mr-4">
        <div className="py-4">
          <div className="flex gap-3">
            <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'hsl(142, 71%, 45%)' }}>
              <Flame className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-semibold text-sm">Ignite Support</span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(systemMessage.created_at), "h:mm a")}
                </span>
              </div>
              <div className="bg-muted rounded-lg rounded-tl-none p-3 max-w-[85%]">
                <p className="text-sm whitespace-pre-wrap">{renderTextWithLinks(systemMessage.text)}</p>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Input area - disabled */}
      <div className="pt-4 border-t shrink-0">
        <div className="text-center text-sm text-muted-foreground py-3 bg-muted/50 rounded-lg">
          This is a welcome message from Ignite Support. Replies are not available.
        </div>
      </div>
    </div>
  );
}
