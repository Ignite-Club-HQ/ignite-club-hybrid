import { useState, useEffect, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Share2, Copy, Download, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  createLiveCompetitionJoinLink,
  listLiveCompetitionJoinLinks,
  rotateLiveCompetitionJoinLink,
} from "@/live/features/competitions";

const PUBLIC_BASE = "https://reference.invalid";

export function CompetitionShareJoinLink({
  competitionId,
  competitionName,
  triggerClassName,
  triggerVariant = "outline",
}: {
  competitionId: string;
  competitionName: string;
  triggerClassName?: string;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost";
}) {

  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || token) return;
    setLoading(true);
    (async () => {
      try {
        const tok = await withFeatureBackend("competitions", {
          supabase: async () => {
            const { data, error } = await supabase
              .from("competitions")
              .select("join_token")
              .eq("id", competitionId)
              .maybeSingle();
            if (error) throw error;
            if (data?.join_token) return data.join_token as string;
            const { data: newTok, error: rerr } = await supabase.rpc(
              "regenerate_competition_join_token",
              { p_competition_id: competitionId }
            );
            if (rerr) throw rerr;
            return newTok as unknown as string;
          },
          icp: async (ctx) => {
            const existing = await listLiveCompetitionJoinLinks(ctx, competitionId);
            const active = existing.find((link) => !link.revoked);
            if (active) return active.token;
            const created = await createLiveCompetitionJoinLink(ctx, competitionId, "player", null);
            return created.token;
          },
        });
        setToken(tok);
      } catch (err: any) {
        toast({ title: "Could not load link", description: err.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    })();
  }, [open, competitionId, token, toast]);

  // Direct join URL (used for QR + copy — clean URL users can read)
  const url = token ? `${PUBLIC_BASE}/competitions/join?token=${token}` : "";
  // Share URL goes through /share so chat/SMS/socials get rich OG preview.
  // Cache-bust per session so previews don't get stuck on stale previews.
  const shareUrl = token
    ? `${PUBLIC_BASE}/share?type=competition&id=${token}&cb=${Date.now()}`
    : "";

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const share = async () => {
    const linkToShare = shareUrl || url;
    if (!linkToShare) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${competitionName}`,
          text: `Join ${competitionName} on Ignite`,
          url: linkToShare,
        });
      } catch {
        /* user cancelled */
      }
    } else {
      copy();
    }
  };

  const download = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${competitionName.replace(/\s+/g, "-").toLowerCase()}-join.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const regenerate = async () => {
    if (!confirm("Replace the current link? The old link will stop working.")) return;
    setRegenerating(true);
    try {
      const newToken = await withFeatureBackend("competitions", {
        supabase: async () => {
          const { data, error } = await supabase.rpc("regenerate_competition_join_token", {
            p_competition_id: competitionId,
          });
          if (error) throw error;
          return data as unknown as string;
        },
        icp: async (ctx) => {
          const rotated = await rotateLiveCompetitionJoinLink(ctx, competitionId);
          return rotated.token;
        },
      });
      setToken(newToken);
      toast({ title: "New link generated" });
    } catch (err: any) {
      toast({ title: "Could not regenerate", description: err.message, variant: "destructive" });
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm" className={triggerClassName}>
          <Share2 className="h-4 w-4 mr-2" />
          Share join link
        </Button>
      </DialogTrigger>


      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share competition</DialogTitle>
          <DialogDescription>
            Anyone with this link can join one of their teams to {competitionName}.
          </DialogDescription>
        </DialogHeader>

        {loading || !token ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div ref={qrRef} className="flex justify-center bg-background p-4 rounded-md border">
              <QRCodeCanvas value={url} size={200} includeMargin />
            </div>

            <div className="flex gap-2">
              <Input value={url} readOnly className="text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="icon" onClick={copy} aria-label="Copy link">
                <Copy className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={share}>
                <Share2 className="h-4 w-4 mr-1" /> Share
              </Button>
              <Button variant="outline" size="sm" onClick={download}>
                <Download className="h-4 w-4 mr-1" /> QR
              </Button>
              <Button variant="outline" size="sm" onClick={regenerate} disabled={regenerating}>
                {regenerating ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Reset
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Team admins who open the link can pick one of their teams to enter. You can remove teams later from the Teams tab.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
