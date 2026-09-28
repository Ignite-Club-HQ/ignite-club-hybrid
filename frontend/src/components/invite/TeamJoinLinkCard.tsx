import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Copy, Check, ChevronLeft, Link2, QrCode, Share2, Download } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
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
import { getCachedRoles } from "@/lib/rolesCache";

const APP_URL = "https://reference.invalid";
const DEFAULT_EXPIRY_DAYS = 30;
const TOKEN_METADATA_KIND = "team_join_link";

type RoleVariant = "parent" | "player" | "coach" | "team_admin";
type TeamType = "junior" | "senior" | "mixed";

const ALL_ROLE_OPTIONS: { value: RoleVariant; label: string; juniorOnly?: boolean; seniorOnly?: boolean }[] = [
  { value: "parent", label: "Parent", juniorOnly: true },
  { value: "player", label: "Player", seniorOnly: true },
  { value: "coach", label: "Coach" },
  { value: "team_admin", label: "Admin" },
];

const ROLE_DESCRIPTIONS: Record<RoleVariant, string> = {
  parent: "Can view team information and respond to events.",
  player: "Can view team information and respond to events.",
  coach: "Can manage team information, events and other coach-level features.",
  team_admin: "Has full team administration access.",
};


const SENSITIVE_ROLES: RoleVariant[] = ["coach", "team_admin"];

interface TeamJoinLinkCardProps {
  teamId: string;
  teamName: string;
  teamType?: TeamType;
  /** Optional back affordance rendered in the card header (used by the invite sheet). */
  onBack?: () => void;
  /**
   * When true, a link for the default (non-sensitive) role is created
   * automatically on mount if none exists yet — so the share/copy buttons are
   * visible the moment the card renders, with zero taps. Sensitive roles
   * (coach/admin) still always require an explicit create.
   */
  autoCreateLink?: boolean;
}

interface JoinLinkRow {
  id: string;
  token: string;
  expires_at: string | null;
  uses_count: number;
  max_uses: number | null;
  created_at: string;
  metadata: { kind?: string; role_variant?: RoleVariant } | null;
}

function generateShortToken(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export default function TeamJoinLinkCard({ teamId, teamName, teamType = "mixed", onBack, autoCreateLink = false }: TeamJoinLinkCardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const roleOptions = ALL_ROLE_OPTIONS.filter(opt => {
    if (teamType === "junior") return !opt.seniorOnly;
    if (teamType === "senior") return !opt.juniorOnly;
    return true;
  });

  const defaultRole: RoleVariant = teamType === "junior" ? "parent" : "player";
  const [activeRole, setActiveRole] = useState<RoleVariant>(defaultRole);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(true);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [autoSelected, setAutoSelected] = useState(false);

  // Only admins/coaches can regenerate or revoke the link.
  const isAdmin = useMemo(() => {
    const roles = getCachedRoles();
    if (!roles) return false;
    return roles.some(
      (r) =>
        ["app_admin", "club_admin", "team_admin", "coach"].includes(r.role) &&
        (r.team_id === teamId || (r.club_id && !r.team_id)),
    );
  }, [teamId]);

  const queryKey = ["team-join-links", teamId];

  // Load all persistent join links for this team from DB so admins
  // can reuse a previously generated link instead of regenerating.
  const { data: links, isLoading, isError, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_invites")
        .select("id, token, expires_at, uses_count, max_uses, created_at, metadata, role")
        .eq("team_id", teamId)
        .contains("metadata", { kind: TOKEN_METADATA_KIND })
        .order("created_at", { ascending: false });
      if (error) throw error;
      const map: Record<RoleVariant, JoinLinkRow | null> = {
        parent: null, player: null, coach: null, team_admin: null,
      };
      for (const row of (data ?? []) as any[]) {
        const role = (row.metadata?.role_variant ?? row.role) as RoleVariant;
        if (role && map[role] === null) map[role] = row as JoinLinkRow;
      }
      return map;
    },
    staleTime: 30_000,
  });

  // Pending invite count for this team — gives admins a sense of traction
  // alongside the link's joined-count.
  const { data: pendingCount } = useQuery({
    queryKey: ["team-pending-invite-count", teamId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("pending_invites")
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
        .eq("status", "pending");
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
  });

  // Auto-jump to a role that already has a link the first time we load,
  // so users land on a usable link instead of an empty Generate state.
  if (!autoSelected && links) {
    const order = (["parent", "player", "coach", "team_admin"] as RoleVariant[]).filter(r => roleOptions.some(o => o.value === r));
    const existing = order.find((r) => links[r]);
    if (existing && existing !== activeRole) {
      setActiveRole(existing);
    }
    setAutoSelected(true);
  }

  const link = links?.[activeRole] ?? null;

  const createOrRotate = useMutation({
    mutationFn: async ({ rotate, role }: { rotate: boolean; role: RoleVariant }) => {
      if (!user) throw new Error("Not signed in");
      const existing = links?.[role];
      if (rotate && existing) {
        await supabase.from("team_invites").delete().eq("id", existing.id);
      }
      const token = generateShortToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + DEFAULT_EXPIRY_DAYS);
      const { data, error } = await supabase
        .from("team_invites")
        .insert({
          team_id: teamId,
          token,
          role,
          created_by: user.id,
          expires_at: expiresAt.toISOString(),
          max_uses: null,
          metadata: { kind: TOKEN_METADATA_KIND, role_variant: role },
        })
        .select("id, token, expires_at, uses_count, max_uses, created_at, metadata")
        .single();
      if (error) throw error;
      return { role, row: data as JoinLinkRow };
    },
    onSuccess: ({ role }) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Join link ready", description: `Share it with anyone joining as ${ALL_ROLE_OPTIONS.find(r => r.value === role)?.label.toLowerCase()}.` });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't create link", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  // Zero-tap share link: when enabled, silently create a link for the active
  // role as soon as we know none exists, so Copy/Share are ready on first
  // paint — for every role, including coach/admin. Only tries once per role
  // per mount so a manual revoke doesn't instantly regenerate.
  const autoCreateTriedRef = useRef<RoleVariant | null>(null);
  useEffect(() => {
    if (!autoCreateLink || isLoading || !links || !isAdmin) return;
    if (links[activeRole]) return;
    if (createOrRotate.isPending) return;
    if (autoCreateTriedRef.current === activeRole) return;
    autoCreateTriedRef.current = activeRole;
    createOrRotate.mutate({ rotate: false, role: activeRole });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCreateLink, isLoading, links, isAdmin, activeRole, createOrRotate.isPending]);

  const revoke = useMutation({
    mutationFn: async (role: RoleVariant) => {
      const existing = links?.[role];
      if (!existing) return role;
      const { error } = await supabase.from("team_invites").delete().eq("id", existing.id);
      if (error) throw error;
      return role;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Link revoked", description: "The previous link no longer works." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't revoke", description: err?.message ?? "Try again", variant: "destructive" });
    },
  });

  const fullUrl = useMemo(() => (link ? `${APP_URL}/join/${link.token}` : ""), [link]);
  const isSensitive = SENSITIVE_ROLES.includes(activeRole);
  const activeRoleLabel = ALL_ROLE_OPTIONS.find((r) => r.value === activeRole)?.label ?? "";

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
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: `Join ${teamName} on Ignite`,
          text: `Tap to join ${teamName} as ${activeRoleLabel.toLowerCase()}:`,
          url: fullUrl,
          dialogTitle: "Share team join link",
        });
        return;
      } catch {/* cancelled */}
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${teamName}`, text: `Tap to join ${teamName} as ${activeRoleLabel.toLowerCase()}:`, url: fullUrl });
        return;
      } catch {/* cancelled */}
    }
    handleCopy();
  };

  const handleRoleChange = (role: RoleVariant) => {
    setActiveRole(role);
    setShowQR(false);
    setCopied(false);
  };

  const handleSaveQR = async (linkId: string) => {
    const container = document.getElementById(`qr-${linkId}`);
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
      ctx.fillText(`Join ${teamName}`, canvas.width / 2, size + pad + 38);
      const dataUrl = canvas.toDataURL("image/png");
      const filename = `join-${teamName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${activeRole}.png`;

      if (Capacitor.isNativePlatform()) {
        const base64 = dataUrl.split(",")[1];
        const written = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });
        await Share.share({ title: `Join ${teamName}`, url: written.uri, dialogTitle: "Share QR code" });
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
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-start gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to invite options"
            className="h-8 w-8 rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
        <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Link2 className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Who is joining?</p>
          <p className="text-xs text-muted-foreground">Pick the role people get with this link.</p>
        </div>
      </div>

      {/* Role selector — segmented control */}
      <div className="space-y-1.5">
        <div
          role="radiogroup"
          aria-label="Role for this link"
          className={`grid gap-1 rounded-lg bg-background border border-border p-1 ${
            roleOptions.length === 2 ? "grid-cols-2" : roleOptions.length === 3 ? "grid-cols-3" : "grid-cols-4"
          }`}
        >
          {roleOptions.map((opt) => {
            const isActive = activeRole === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => handleRoleChange(opt.value)}
                className={`relative px-2 py-2 text-xs rounded-md transition-colors min-h-[40px] inline-flex items-center justify-center gap-1 ${
                  isActive
                    ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {isActive && <Check className="h-3 w-3" aria-hidden />}
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[activeRole]}</p>
      </div>


      {isLoading && !links ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : !link ? (
        <div className="space-y-2">
          {isAdmin ? (
            <Button
              type="button"
              className="w-full h-11 text-sm font-semibold"
              disabled={createOrRotate.isPending}
              onClick={() => {
                if (isSensitive) setConfirmGenerate(true);
                else createOrRotate.mutate({ rotate: false, role: activeRole });
              }}
            >
              {createOrRotate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Link2 className="h-4 w-4 mr-2" />
              )}
              Create {activeRoleLabel.toLowerCase()} link
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground text-center px-2 py-3">
              No {activeRoleLabel.toLowerCase()} link yet. Ask a coach or admin to create one.
            </p>
          )}
          {isError && (
            <button
              type="button"
              onClick={() => refetch()}
              className="w-full text-xs text-muted-foreground underline"
            >
              Couldn't load existing links — tap to retry
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-sm font-semibold">{activeRoleLabel} invite link</p>
            <p className="text-xs text-muted-foreground">This link stays active until you revoke it.</p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy invite link"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors min-h-[44px]"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-primary" />
                  <span className="text-primary">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Copy link</span>
                </>
              )}
            </button>
            <Button type="button" className="flex-1 h-11 text-sm font-semibold" onClick={handleShare}>
              <Share2 className="h-4 w-4 mr-2" />
              Share
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowQR((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors min-h-[36px]"
            >
              <QrCode className="h-3.5 w-3.5" />
              {showQR ? "Hide QR" : "Show QR"}
            </button>
            {isAdmin && (
              <button
                type="button"
                className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50 min-h-[36px]"
                onClick={() => setConfirmRevoke(true)}
                disabled={revoke.isPending}
              >
                Revoke link
              </button>
            )}
          </div>

          <Collapsible open={showQR}>
            <CollapsibleContent>
              <div className="flex flex-col items-center gap-2 py-3 bg-background rounded-md border border-border">
                <div id={`qr-${link.id}`} className="bg-white p-3 rounded-md">
                  <QRCodeSVG value={fullUrl} size={180} level="M" includeMargin={false} />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => handleSaveQR(link.id)}
                >
                  <Download className="h-3 w-3 mr-1" />
                  {Capacitor.isNativePlatform() ? "Share QR image" : "Download QR"}
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {(link.uses_count > 0 || (pendingCount ?? 0) > 0) && (
            <p className="text-xs text-muted-foreground/80">
              {link.uses_count > 0 ? `${link.uses_count} ${link.uses_count === 1 ? "join" : "joins"}` : ""}
              {link.uses_count > 0 && (pendingCount ?? 0) > 0 ? " · " : ""}
              {(pendingCount ?? 0) > 0 ? `${pendingCount} pending` : ""}
            </p>
          )}
        </>
      )}

      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {activeRoleLabel.toLowerCase()} link?</AlertDialogTitle>
            <AlertDialogDescription>
              The link stops working straight away. Anyone you've already shared it with
              won't be able to join.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRevoke(false);
                revoke.mutate(activeRole);
              }}
            >
              Revoke link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create a {activeRoleLabel.toLowerCase()} link?</AlertDialogTitle>
            <AlertDialogDescription>This will create a shareable join link for this role.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmGenerate(false);
                createOrRotate.mutate({ rotate: false, role: activeRole });
              }}
            >
              Create link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

