import { Download, FileText } from "lucide-react";
import { formatFileSize, type NewsAttachment } from "@/features/news/newsAttachments";
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

/** Renders embedded images and file attachments for a Club News article. */
export default function NewsAttachments({ attachments }: { attachments: NewsAttachment[] }) {
  const images = attachments.filter((a) => a.kind === "image");
  const files = attachments.filter((a) => a.kind === "file");
  if (images.length === 0 && files.length === 0) return null;

  return (
    <div className="space-y-3">
      {images.length > 0 && (
        <div className={images.length === 1 ? "" : "grid grid-cols-2 gap-2"}>
          {images.map((img) => (
            <a
              key={img.url}
              href={img.url}
              target="_blank"
              rel="noreferrer"
              className="block"
              onClick={(e) => {
                e.preventDefault();
                void openAttachment(img.url);
              }}
            >
              <SecureImage
                src={img.url}
                alt={img.name}
                className="w-full rounded-lg border object-cover"
              />
            </a>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Attachments</p>
          {files.map((file) => (
            <a
              key={file.url}
              href={file.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/40"
              onClick={(e) => {
                e.preventDefault();
                void openAttachment(file.url);
              }}
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{file.name}</p>
                {formatFileSize(file.size) && (
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                )}
              </div>
              <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
