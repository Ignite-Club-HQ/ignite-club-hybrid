import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface IcsFallbackDetail {
  filename: string;
  ics: string;
  dataUrl: string;
}

/**
 * Listens for `ics-preview-fallback` events fired by `downloadIcs` when running
 * inside a sandboxed iframe (e.g. the Lovable preview) where blob downloads and
 * popup windows are blocked. Surfaces the .ics content so users can copy it or
 * try opening it manually — and confirms visually that the export ran.
 */
export function IcsPreviewFallbackDialog() {
  const [detail, setDetail] = useState<IcsFallbackDetail | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<IcsFallbackDetail>;
      if (ce.detail) setDetail(ce.detail);
    };
    window.addEventListener("ics-preview-fallback", handler);
    return () => window.removeEventListener("ics-preview-fallback", handler);
  }, []);

  if (!detail) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(detail.ics);
      toast({ title: "Copied", description: "Paste into a .ics file or your calendar import tool." });
    } catch {
      toast({ title: "Couldn't copy", variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && setDetail(null)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Calendar export ready</DialogTitle>
          <DialogDescription>
            File downloads are blocked inside the Lovable preview. Open the published app to download
            <span className="font-medium"> {detail.filename}</span> directly, or copy the calendar data below
            and import it manually into Google / Apple / Outlook Calendar.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          readOnly
          value={detail.ics}
          className="h-48 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleCopy}>
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </Button>
          <Button asChild>
            <a href={detail.dataUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Open in new tab
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
