import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { MiniLeagueJoinLinkCard } from "./MiniLeagueJoinLinkCard";
import {
  buildMiniLeagueJoinLinkQrFilename,
  buildMiniLeagueJoinLinkUrl,
  generateShortToken,
  MINI_LEAGUE_ADMIN_JOIN_LINK_COPY,
  MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE,
  requireAuthenticatedUserId,
} from "./miniLeagueJoinLinkCardContract";

interface Props {
  miniLeagueId: string;
  miniLeagueName: string;
  clubId: string;
}

interface JoinLinkRow {
  id: string;
  invite_token: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export default function MiniLeagueAdminJoinLinkCard({ miniLeagueId, miniLeagueName, clubId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);

  const queryKey = ["mini-league-admin-join-link", miniLeagueId];

  const { data: link, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, invite_token, created_at, metadata")
        .eq("club_id", clubId)
        .eq("role", MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE.role as any)
        .eq("status", "pending")
        .contains("metadata", { kind: MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE.metadataKind, mini_league_id: miniLeagueId })
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as JoinLinkRow | undefined) ?? null;
    },
    staleTime: 30_000,
  });

  const { data: pendingCount } = useQuery({
    queryKey: ["mini-league-pending-admin-count", miniLeagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pending_invites")
        .select("id, metadata")
        .eq("club_id", clubId)
        .eq("role", MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE.role as any)
        .eq("status", "pending")
        .not("invited_email", "is", null);
      if (error) throw error;
      return (data || []).filter(
        (r) =>
          (r.metadata as any)?.mini_league_id === miniLeagueId &&
          (r.metadata as any)?.kind !== MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE.metadataKind,
      ).length;
    },
    staleTime: 30_000,
  });

  const createOrRotate = useMutation({
    mutationFn: async ({ rotate }: { rotate: boolean }) => {
      const userId = requireAuthenticatedUserId(user?.id);
      if (rotate && link) {
        await supabase.from("pending_invites").delete().eq("id", link.id);
      }
      const token = generateShortToken();
      const { data, error } = await supabase
        .from("pending_invites")
        .insert({
          club_id: clubId,
          role: MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE.role as any,
          invited_by_user_id: userId,
          invited_user_id: null,
          invited_label: MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE.invitedLabel(miniLeagueName),
          invited_email: null,
          invite_token: token,
          metadata: {
            kind: MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE.metadataKind,
            mini_league_id: miniLeagueId,
          },
        } as any)
        .select("id, invite_token, created_at, metadata")
        .single();
      if (error) throw error;
      return data as JoinLinkRow;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Join link ready", description: "Share it with anyone you want to grant League Admin rights." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't create link", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const revoke = useMutation({
    mutationFn: async () => {
      if (!link) return;
      const { error } = await supabase.from("pending_invites").delete().eq("id", link.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Link revoked", description: "The previous link no longer works." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't revoke", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const fullUrl = useMemo(() => (link ? buildMiniLeagueJoinLinkUrl(link.invite_token) : ""), [link]);

  const handleCopy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleShare = async () => {
    if (!fullUrl) return;
    const title = `Become a League Admin for ${miniLeagueName}`;
    const text = `Tap to accept League Admin rights for ${miniLeagueName}:`;
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ title, text, url: fullUrl, dialogTitle: "Share League Admin link" });
        return;
      } catch {/* cancelled */}
    }
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      try {
        await (navigator as any).share({ title, text, url: fullUrl });
        return;
      } catch {/* cancelled */}
    }
    handleCopy();
  };

  const handleSaveQR = async () => {
    if (!link) return;
    const container = document.getElementById(`ml-join-qr-${link.id}`);
    const svg = container?.querySelector("svg");
    if (!svg) return;
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const svg64 = btoa(unescape(encodeURIComponent(xml)));
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${svg64}`;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      const size = 720;
      const pad = 48;
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
      ctx.fillText(`Become a League Admin – ${miniLeagueName}`, canvas.width / 2, size + pad + 38);
      const dataUrl = canvas.toDataURL("image/png");
      const filename = buildMiniLeagueJoinLinkQrFilename("league-admin", miniLeagueName);

      if (Capacitor.isNativePlatform()) {
        const base64 = dataUrl.split(",")[1];
        const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        await Share.share({ title: `League Admin – ${miniLeagueName}`, url: written.uri, dialogTitle: "Share QR code" });
      } else {
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast({ title: "QR saved", description: filename });
      }
    } catch (e: any) {
      toast({ title: "Couldn't save QR", description: e?.message ?? "Unknown error", variant: "destructive" });
    }
  };

  return (
    <>
      <MiniLeagueJoinLinkCard
        miniLeagueName={miniLeagueName}
        link={link}
        fullUrl={fullUrl}
        copy={MINI_LEAGUE_ADMIN_JOIN_LINK_COPY}
        notice={
          <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>
              League Admin links grant full league management access. Only share with people you trust, and revoke when no longer needed.
            </span>
          </div>
        }
        isLoading={isLoading}
        isError={isError}
        isGenerating={createOrRotate.isPending}
        isRegenerating={createOrRotate.isPending}
        isRevoking={revoke.isPending}
        copied={copied}
        showQR={showQR}
        pendingCount={pendingCount}
        onGenerate={() => setConfirmGenerate(true)}
        onRetry={() => refetch()}
        onShare={handleShare}
        onCopy={handleCopy}
        onToggleQR={() => setShowQR((value) => !value)}
        onSaveQR={handleSaveQR}
        onRegenerate={() => createOrRotate.mutate({ rotate: true })}
        onRevoke={() => revoke.mutate()}
      />

      <AlertDialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a League Admin join link?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone with this link can become a League Admin for {miniLeagueName} — that grants full league management access. Only share it with people you trust, and revoke it when no longer needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={() => {
                setConfirmGenerate(false);
                createOrRotate.mutate({ rotate: false });
              }}
            >
              Yes, create link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
