import { useState, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Loader2, Copy, Check, Link2, QrCode, Share2, Download } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
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
import type { MiniLeagueJoinLinkCardCopy } from "./miniLeagueJoinLinkCardContract";

export interface MiniLeagueJoinLink {
  id: string;
  invite_token: string;
}

interface MiniLeagueJoinLinkCardProps {
  miniLeagueName: string;
  link: MiniLeagueJoinLink | null | undefined;
  fullUrl: string;
  copy: MiniLeagueJoinLinkCardCopy;
  notice?: ReactNode;
  isLoading: boolean;
  isError: boolean;
  isGenerating: boolean;
  isRegenerating: boolean;
  isRevoking: boolean;
  copied: boolean;
  showQR: boolean;
  pendingCount?: number;
  onGenerate: () => void;
  onRetry: () => void;
  onShare: () => void;
  onCopy: () => void;
  onToggleQR: () => void;
  onSaveQR: () => void;
  onRegenerate: () => void;
  onRevoke: () => void;
}

export function MiniLeagueJoinLinkCard({
  miniLeagueName,
  link,
  fullUrl,
  copy,
  notice,
  isLoading,
  isError,
  isGenerating,
  isRegenerating,
  isRevoking,
  copied,
  showQR,
  pendingCount,
  onGenerate,
  onRetry,
  onShare,
  onCopy,
  onToggleQR,
  onSaveQR,
  onRegenerate,
  onRevoke,
}: MiniLeagueJoinLinkCardProps) {
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Link2 className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{copy.heading}</p>
          <p className="text-xs text-muted-foreground">{copy.description(miniLeagueName)}</p>
        </div>
      </div>

      {notice}

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : !link ? (
        <div className="space-y-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={isGenerating}
            onClick={onGenerate}
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Link2 className="h-4 w-4 mr-2" />
            )}
            {copy.generateLabel}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">{copy.emptyHelp}</p>
          {isError && (
            <button
              type="button"
              onClick={onRetry}
              className="w-full text-[11px] text-muted-foreground underline"
            >
              Couldn't load existing link — tap to retry
            </button>
          )}
        </div>
      ) : (
        <>
          <Button type="button" className="w-full h-11 text-sm font-semibold" onClick={onShare}>
            <Share2 className="h-4 w-4 mr-2" />
            Share link
          </Button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCopy}
              aria-label="Copy join link"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors min-h-[40px]"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-primary" />
                  <span className="text-primary">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy link</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onToggleQR}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors min-h-[40px]"
            >
              <QrCode className="h-3.5 w-3.5" />
              {showQR ? "Hide QR" : "Show QR"}
            </button>
          </div>

          <Collapsible open={showQR}>
            <CollapsibleContent>
              <div className="flex flex-col items-center gap-2 py-3 bg-background rounded-md border border-border">
                <div id={`ml-join-qr-${link.id}`} className="bg-white p-3 rounded-md">
                  <QRCodeSVG value={fullUrl} size={180} level="M" includeMargin={false} />
                </div>
                <p className="text-[11px] text-muted-foreground">{copy.qrDescription}</p>
                <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onSaveQR}>
                  <Download className="h-3 w-3 mr-1" />
                  {Capacitor.isNativePlatform() ? "Share QR image" : "Download QR"}
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between text-[11px] text-muted-foreground/80 pt-1">
            <span>
              {pendingCount && pendingCount > 0
                ? `${pendingCount} pending email invite${pendingCount === 1 ? "" : "s"} · `
                : ""}
              never expires
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="hover:text-foreground transition-colors disabled:opacity-50"
                onClick={() => setConfirmRegenerate(true)}
                disabled={isRegenerating}
              >
                Regenerate
              </button>
              <span aria-hidden>·</span>
              <button
                type="button"
                className="hover:text-destructive transition-colors disabled:opacity-50"
                onClick={onRevoke}
                disabled={isRevoking}
              >
                Revoke
              </button>
            </div>
          </div>
        </>
      )}

      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.regenerateTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              The current link will stop working immediately. Anyone you've already shared it with won't be able to join — you'll need to send them the new link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmRegenerate(false);
                onRegenerate();
              }}
            >
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
