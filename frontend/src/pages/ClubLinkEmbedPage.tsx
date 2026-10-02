import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LegalPageEmbed from "@/components/LegalPageEmbed";
import { Button } from "@/components/ui/button";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveClubLink } from "@/live/features/club";

/**
 * Renders a club-managed link inside the app (native in-app web view).
 * Falls back to a plain redirect on web, matching LegalPageEmbed behaviour.
 */
export default function ClubLinkEmbedPage() {
  const { linkId } = useParams<{ linkId: string }>();
  const navigate = useNavigate();
  const providerKey = resolveAuthBackend() === "icp" ? "icp" : "supabase";

  const { data, isLoading } = useQuery({
    queryKey: ["club-link", linkId, providerKey],
    enabled: !!linkId,
    queryFn: async () => {
      // ICP branch resolves against club_domain's club listings; inactive
      // links return null, matching the "no longer available" state below.
      return withFeatureBackend("news", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("club_links")
            .select("id, title, url")
            .eq("id", linkId!)
            .maybeSingle();
          if (error) throw error;
          return data;
        },
        icp: (ctx) => getLiveClubLink(ctx, linkId!),
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data?.url) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="text-sm text-muted-foreground">
          This link is no longer available.
        </p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    );
  }

  return <LegalPageEmbed title={data.title} websiteUrl={data.url} />;
}
