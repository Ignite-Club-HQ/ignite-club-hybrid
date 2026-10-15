import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Download, Link2, Loader2, QrCode, Share2 } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

const APP_URL = "https://igniteclubhq.app";
type OfficialRole = "referee" | "committee";
const LABEL: Record<OfficialRole, string> = { referee: "referee", committee: "committee member" };

function newToken() {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** One reusable join link + QR per competition role (referee / committee). */
export function CompetitionRoleLinkPanel({
  competitionId,
  competitionName,
  role,
}: {
  competitionId: string;
  competitionName: string;
  role: OfficialRole;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);
  const key = ["competition-role-link", competitionId, role];
  const db = supabase as any;

  const { data: link, isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db
        .from("competition_role_links")
        .select("id, token")
        .eq("competition_id", competitionId)
        .eq("role", role)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; token: string } | null;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (link) await db.from("competition_role_links").delete().eq("id", link.id);
      const { error } = await db.from("competition_role_links").insert({
        competition_id: competitionId,
        role,
        token: newToken(),
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: Error) => toast({ title: "Couldn't create link", description: e.message, variant: "destructive" }),
  });

  const revoke = useMutation({
    mutationFn: async () => {
      if (!link) return;
      const { error } = await db.from("competition_role_links").delete().eq("id", link.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast({ title: "Link turned off", description: "The old link and QR code no longer work." });
    },
  });

  const url = useMemo(() => (link ? `${APP_URL}/competitions/officials/join?token=${link.token}` : ""), [link]);
  const title = `Join ${competitionName} as a ${LABEL[role]}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const share = async () => {
    const text = `Tap to join ${competitionName} as a ${LABEL[role]} on Ignite:`;
    if (Capacitor.isNativePlatform()) {
      try { await Share.share({ title, text, url, dialogTitle: "Share link" }); return; } catch { return; }
    }
    if ((navigator as any).share) {
      try { await (navigator as any).share({ title, text, url }); return; } catch { return; }
    }
    copy();
  };

  const saveQR = async () => {
    const svg = document.getElementById(`role-qr-${role}`)?.querySelector("svg");
    if (!svg) return;
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const size = 720, pad = 48;
      const canvas = document.createElement("canvas");
      canvas.width = size + pad * 2;
      canvas.height = size + pad * 2 + 60;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, pad, pad, size, size);
      ctx.fillStyle = "#0f172a";
      ctx.font = "600 22px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(title, canvas.width / 2, size + pad + 38);
      const dataUrl = canvas.toDataURL("image/png");
      const filename = `${role}-${competitionName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      if (Capacitor.isNativePlatform()) {
        const written = await Filesystem.writeFile({ path: filename, data: dataUrl.split(",")[1], directory: Directory.Cache });
        await Share.share({ title, url: written.uri, dialogTitle: "Share QR code" });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = filename;
        a.click();
      }
    } catch (e: any) {
      toast({ title: "Couldn't save QR", description: e?.message, variant: "destructive" });
    }
  };

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin mx-auto" />;

  if (!link) {
    return (
      <Button size="sm" variant="secondary" className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>
        {create.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Link2 className="h-4 w-4 mr-2" />}
        Create {LABEL[role]} link &amp; QR code
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Button size="sm" className="w-full" onClick={share}>
        <Share2 className="h-4 w-4 mr-2" /> Share {LABEL[role]} link
      </Button>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="flex-1" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Copy className="h-3.5 w-3.5 mr-1.5" />}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => setShowQR((v) => !v)}>
          <QrCode className="h-3.5 w-3.5 mr-1.5" /> {showQR ? "Hide QR" : "Show QR"}
        </Button>
      </div>
      {showQR && (
        <div className="flex flex-col items-center gap-2 py-3 rounded-md border border-border">
          <div id={`role-qr-${role}`} className="bg-white p-3 rounded-md">
            <QRCodeSVG value={url} size={180} level="M" />
          </div>
          <p className="text-[11px] text-muted-foreground">Scan to join as a {LABEL[role]}</p>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={saveQR}>
            <Download className="h-3 w-3 mr-1" />
            {Capacitor.isNativePlatform() ? "Share QR image" : "Download QR"}
          </Button>
        </div>
      )}
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>Anyone with this link becomes a {LABEL[role]}</span>
        <span className="flex gap-2">
          <button type="button" className="hover:text-foreground" onClick={() => create.mutate()}>New link</button>
          <span aria-hidden>·</span>
          <button type="button" className="hover:text-destructive" onClick={() => revoke.mutate()}>Turn off</button>
        </span>
      </div>
    </div>
  );
}
