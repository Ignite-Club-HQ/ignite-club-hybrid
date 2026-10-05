import { Download, FileText } from "lucide-react";
import {
  formatFileSize,
  splitNewsBody,
  type NewsAttachment,
} from "@/features/news/newsAttachments";
import NewsAttachments from "@/components/news/NewsAttachments";
import { SecureImage } from "@/components/SecureImage";
import { resolveSignedUrl } from "@/hooks/useSignedPhotoUrl";
import { toast } from "@/hooks/use-toast";

/** Opens an attachment, decrypting ICP blob-store ciphertext in-browser. */
async function openAttachment(url: string) {
  try {
    window.open(await resolveSignedUrl(url), "_blank", "noreferrer");
  } catch {
    toast({ title: "Couldn't open file", description: "Please try again.", variant: "destructive" });
  }
}

/**
 * Article body with attachments rendered exactly where the author placed them.
 * Anything the author never placed inline falls back to the trailing
 * gallery/attachment list so nothing is ever hidden.
 */
export default function NewsArticleBody({
  content,
  attachments,
}: {
  content: string;
  attachments: NewsAttachment[];
}) {
  const { segments, usedAnchors } = splitNewsBody(content || "", attachments);
  const leftovers = attachments.filter((a) => !a.anchor || !usedAnchors.has(a.anchor));

  return (
    <div className="space-y-3">
      {segments.map((segment, i) =>
        segment.type === "text" ? (
          <p
            key={`t-${i}`}
            className="whitespace-pre-wrap text-sm leading-relaxed text-foreground"
          >
            {segment.text.trim()}
          </p>
        ) : segment.attachment.kind === "image" ? (
          <a
            key={`a-${i}`}
            href={segment.attachment.url}
            target="_blank"
            rel="noreferrer"
            className="block"
            onClick={(e) => {
              e.preventDefault();
              void openAttachment(segment.attachment.url);
            }}
          >
            <SecureImage
              src={segment.attachment.url}
              alt={segment.attachment.name}
              className="w-full rounded-lg border object-cover"
            />
          </a>
        ) : (
          <a
            key={`a-${i}`}
            href={segment.attachment.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/40"
            onClick={(e) => {
              e.preventDefault();
              void openAttachment(segment.attachment.url);
            }}
          >
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{segment.attachment.name}</p>
              {formatFileSize(segment.attachment.size) && (
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(segment.attachment.size)}
                </p>
              )}
            </div>
            <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
          </a>
        ),
      )}

      <NewsAttachments attachments={leftovers} />
    </div>
  );
}
