import { useRef } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
import { getShareUrl } from "@/lib/shareUtils";
import { gateShareWithPro } from "@/lib/proShareGate";

interface SharePhotoButtonProps {
  photoId: string;
  imageUrl: string;
  title?: string;
  clubName?: string;
  teamName?: string;
  clubId?: string | null;
  teamId?: string | null;
}

export function SharePhotoButton({ photoId, clubId, teamId }: SharePhotoButtonProps) {
  const isSharingRef = useRef(false);
  const navigate = useNavigate();

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Link copied to clipboard!");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      toast.success("Link copied to clipboard!");
    }
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isSharingRef.current) return;
    isSharingRef.current = true;

    try {
      const allowed = await gateShareWithPro({ teamId, clubId, navigate, featureLabel: "Photo sharing" });
      if (!allowed) return;

      // Always share the /share URL so recipients get rich previews + proper redirects
      const shareUrl = getShareUrl("photo", photoId);

      if (Capacitor.isNativePlatform()) {
        try {
          await Share.share({
            url: shareUrl,
            dialogTitle: "Share photo",
          });
        } catch (error) {
          if ((error as Error).name !== "AbortError") {
            console.log("Capacitor Share failed, falling back to clipboard:", error);
            await copyToClipboard(shareUrl);
          }
        }
        return;
      }

      if (navigator.share) {
        try {
          await navigator.share({
            url: shareUrl,
          });
          return;
        } catch (error) {
          if ((error as Error).name === "AbortError") return;
          console.log("Web Share failed, falling back to clipboard:", error);
        }
      }

      await copyToClipboard(shareUrl);
    } finally {
      isSharingRef.current = false;
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11 text-muted-foreground hover:text-primary"
      onClick={handleShare}
      title="Share photo"
    >
      <Share2 className="h-6 w-6" />
    </Button>
  );
}
