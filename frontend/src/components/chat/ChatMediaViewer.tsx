import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Play,
  ImageIcon,
  FileText,
  Link as LinkIcon,
  ExternalLink,
  Folder,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import {
  useChatSharedMedia,
  type ChatSharedMediaType,
  type SharedMediaItem,
  type SharedMediaKind,
} from "@/hooks/useChatSharedMedia";
import { isVideoUrl } from "@/lib/videoUtils";
import { SecureImage } from "@/components/SecureImage";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { cn } from "@/lib/utils";

interface ChatMediaViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatType: ChatSharedMediaType;
  chatId: string | undefined;
  title?: string;
}

type TabKey = "photos" | "files" | "links" | "all";

const TABS: { key: TabKey; label: string; match: (k: SharedMediaKind) => boolean }[] = [
  { key: "photos", label: "Photos", match: (k) => k === "photo" },
  { key: "files", label: "Files", match: (k) => k === "file" },
  { key: "links", label: "Links", match: (k) => k === "link" },
  { key: "all", label: "All", match: () => true },
];

export function ChatMediaViewer({
  open,
  onOpenChange,
  chatType,
  chatId,
  title = "Shared in Chat",
}: ChatMediaViewerProps) {
  const navigate = useNavigate();
  const { data: items = [], isLoading } = useChatSharedMedia(chatType, chatId, {
    limit: 200,
    enabled: open,
  });
  const [tab, setTab] = useState<TabKey>("photos");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const photos = useMemo(() => items.filter((i) => i.kind === "photo"), [items]);
  const files = useMemo(() => items.filter((i) => i.kind === "file"), [items]);
  const links = useMemo(() => items.filter((i) => i.kind === "link"), [items]);

  const visible = useMemo(() => {
    const cfg = TABS.find((t) => t.key === tab)!;
    return items.filter((i) => cfg.match(i.kind));
  }, [items, tab]);

  const counts = {
    photos: photos.length,
    files: files.length,
    links: links.length,
    all: items.length,
  };

  const handleClose = () => onOpenChange(false);

  const handleOpenFile = (item: SharedMediaItem) => {
    handleClose();
    setTimeout(() => {
      if (item.vaultFileId) navigate(`/vault?file=${item.vaultFileId}`);
      else if (item.vaultFolderId) navigate(`/vault/folder/${item.vaultFolderId}`);
      else if (item.vaultRootScope && item.vaultRootId) {
        navigate(`/vault?${item.vaultRootScope}=${item.vaultRootId}`);
      }
    }, 80);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          hideCloseButton
          className={cn(
            "flex flex-col gap-0 p-0 bg-background",
            "h-[100dvh] max-h-[100dvh] w-screen max-w-none rounded-none border-0",
          )}
          data-lock-keyboard-scroll="true"
          data-allow-scroll
          style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <SheetDescription className="sr-only">
            All photos, files and links shared in this conversation.
          </SheetDescription>

          {/* Header */}
          <header className="flex items-center gap-2 px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2 border-b bg-background shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-10 -ml-1"
              onClick={handleClose}
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-[17px] font-semibold leading-tight truncate">{title}</h1>
              <p className="text-[12px] text-muted-foreground leading-tight">
                {isLoading
                  ? "Loading…"
                  : `${counts.all} ${counts.all === 1 ? "Item" : "Items"}`}
              </p>
            </div>
          </header>

          {/* Segmented tabs */}
          <div className="px-3 pt-3 pb-2 border-b bg-background shrink-0">
            <div className="inline-flex w-full items-center gap-1 rounded-full bg-muted/60 p-1">
              {TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "flex-1 h-9 rounded-full text-[13px] font-medium transition-colors touch-manipulation",
                      active
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                    <span className={cn(
                      "ml-1.5 text-[11px] tabular-nums",
                      active ? "text-muted-foreground" : "text-muted-foreground/70",
                    )}>
                      {counts[t.key]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
            data-chat-scroll-lock="true"
            style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
          >
            {isLoading ? (
              <SkeletonGrid />
            ) : visible.length === 0 ? (
              <EmptyState kind={tab} />
            ) : tab === "photos" ? (
              <PhotosGrid
                items={photos}
                onOpen={(i) => setLightboxIndex(i)}
              />
            ) : tab === "files" ? (
              <FilesList items={files} onOpen={handleOpenFile} />
            ) : tab === "links" ? (
              <LinksList items={links} />
            ) : (
              <AllList
                items={visible}
                onOpenPhoto={(item) => {
                  const idx = photos.findIndex((p) => p.id === item.id);
                  if (idx >= 0) setLightboxIndex(idx);
                }}
                onOpenFile={handleOpenFile}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {lightboxIndex !== null && photos.length > 0 && (
        <PhotoLightbox
          isOpen={lightboxIndex !== null}
          onClose={() => setLightboxIndex(null)}
          photos={photos.map((it) => ({
            id: it.id,
            image_url: it.image_url,
            title: it.author_name ?? undefined,
          }))}
          currentIndex={lightboxIndex}
          onNavigate={(idx) => setLightboxIndex(idx)}
        />
      )}
    </>
  );
}

/* ───────────────────────── helpers ───────────────────────── */

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "";
  }
}

function AuthorRow({ item }: { item: SharedMediaItem }) {
  const name = item.author_name || "Unknown";
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Avatar className="h-4 w-4 shrink-0">
        <AvatarImage src={item.author_avatar || undefined} />
        <AvatarFallback className="text-[8px]">
          {name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-[11px] text-muted-foreground truncate">
        {name}
      </span>
    </div>
  );
}

/* ───────────────────────── Photos grid ───────────────────────── */

function PhotosGrid({
  items,
  onOpen,
}: {
  items: SharedMediaItem[];
  onOpen: (index: number) => void;
}) {
  return (
    <div className="p-4 grid grid-cols-2 gap-3">
      {items.map((item, i) => {
        const isVideo = isVideoUrl(item.image_url);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(i)}
            className="group flex flex-col gap-2 text-left active:opacity-80 transition-opacity touch-manipulation"
          >
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-muted ring-1 ring-border/50">
              <SecureImage
                src={item.image_url}
                alt="Shared media"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-active:scale-[0.98]"
              />
              {isVideo && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                  <div className="h-10 w-10 rounded-full bg-black/60 flex items-center justify-center">
                    <Play className="h-4 w-4 text-white fill-white" />
                  </div>
                </div>
              )}
              {isVideo && (
                <span className="absolute left-2 top-2 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  Video
                </span>
              )}
            </div>
            <div className="px-0.5 min-w-0 space-y-0.5">
              <AuthorRow item={item} />
              <p className="text-[11px] text-muted-foreground/80 truncate">
                {relativeTime(item.created_at)}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Files list ───────────────────────── */

function FilesList({
  items,
  onOpen,
}: {
  items: SharedMediaItem[];
  onOpen: (item: SharedMediaItem) => void;
}) {
  return (
    <div className="p-4 space-y-3">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item)}
          className="w-full flex items-center gap-3 rounded-2xl border bg-card p-3 text-left active:bg-muted/50 transition-colors touch-manipulation"
        >
          <div className="h-12 w-12 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
            {item.vaultFolderId ? (
              <Folder className="h-6 w-6 text-primary" />
            ) : (
              <FileText className="h-6 w-6 text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-medium truncate">{item.label}</p>
            <p className="text-[12px] text-muted-foreground truncate">
              {item.sublabel}
            </p>
            <div className="mt-1 flex items-center gap-2 min-w-0">
              <AuthorRow item={item} />
              <span className="text-[11px] text-muted-foreground/70 shrink-0">
                · {relativeTime(item.created_at)}
              </span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── Links list ───────────────────────── */

function LinksList({ items }: { items: SharedMediaItem[] }) {
  return (
    <div className="p-4 space-y-3">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => item.url && safeOpenUrl(item.url)}
          className="w-full flex items-center gap-3 rounded-2xl border bg-card p-3 text-left active:bg-muted/50 transition-colors touch-manipulation"
        >
          <div className="h-12 w-12 shrink-0 rounded-xl bg-accent flex items-center justify-center">
            <LinkIcon className="h-5 w-5 text-accent-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-medium truncate">{item.sublabel}</p>
            <p className="text-[12px] text-muted-foreground truncate">
              {item.label}
            </p>
            <div className="mt-1 flex items-center gap-2 min-w-0">
              <AuthorRow item={item} />
              <span className="text-[11px] text-muted-foreground/70 shrink-0">
                · {relativeTime(item.created_at)}
              </span>
            </div>
          </div>
          <ExternalLink className="h-4 w-4 text-muted-foreground/70 shrink-0" />
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── All list (mixed) ───────────────────────── */

function AllList({
  items,
  onOpenPhoto,
  onOpenFile,
}: {
  items: SharedMediaItem[];
  onOpenPhoto: (item: SharedMediaItem) => void;
  onOpenFile: (item: SharedMediaItem) => void;
}) {
  return (
    <div className="p-4 space-y-3">
      {items.map((item) => {
        if (item.kind === "photo") {
          const isVideo = isVideoUrl(item.image_url);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenPhoto(item)}
              className="w-full flex items-center gap-3 rounded-2xl border bg-card p-2.5 text-left active:bg-muted/50 transition-colors touch-manipulation"
            >
              <div className="relative h-14 w-14 shrink-0 rounded-xl overflow-hidden bg-muted">
                <SecureImage
                  src={item.image_url}
                  alt="Shared media"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {isVideo && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Play className="h-4 w-4 text-white fill-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium truncate">
                  {isVideo ? "Video" : "Photo"}
                </p>
                <div className="mt-0.5 flex items-center gap-2 min-w-0">
                  <AuthorRow item={item} />
                  <span className="text-[11px] text-muted-foreground/70 shrink-0">
                    · {relativeTime(item.created_at)}
                  </span>
                </div>
              </div>
              <Badge label={isVideo ? "Video" : "Photo"} />
            </button>
          );
        }
        if (item.kind === "file") {
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenFile(item)}
              className="w-full flex items-center gap-3 rounded-2xl border bg-card p-3 text-left active:bg-muted/50 transition-colors touch-manipulation"
            >
              <div className="h-12 w-12 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
                {item.vaultFolderId ? (
                  <Folder className="h-6 w-6 text-primary" />
                ) : (
                  <FileText className="h-6 w-6 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium truncate">{item.label}</p>
                <div className="mt-0.5 flex items-center gap-2 min-w-0">
                  <AuthorRow item={item} />
                  <span className="text-[11px] text-muted-foreground/70 shrink-0">
                    · {relativeTime(item.created_at)}
                  </span>
                </div>
              </div>
              <Badge label="File" />
            </button>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => item.url && safeOpenUrl(item.url)}
            className="w-full flex items-center gap-3 rounded-2xl border bg-card p-3 text-left active:bg-muted/50 transition-colors touch-manipulation"
          >
            <div className="h-12 w-12 shrink-0 rounded-xl bg-accent flex items-center justify-center">
              <LinkIcon className="h-5 w-5 text-accent-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium truncate">{item.sublabel}</p>
              <p className="text-[12px] text-muted-foreground truncate">{item.label}</p>
              <div className="mt-0.5 flex items-center gap-2 min-w-0">
                <AuthorRow item={item} />
                <span className="text-[11px] text-muted-foreground/70 shrink-0">
                  · {relativeTime(item.created_at)}
                </span>
              </div>
            </div>
            <Badge label="Link" />
          </button>
        );
      })}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
  );
}

/* ───────────────────────── Skeleton & empty ───────────────────────── */

function SkeletonGrid() {
  return (
    <div className="p-4 grid grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="aspect-square rounded-2xl bg-muted animate-pulse" />
          <div className="h-3 w-2/3 rounded-full bg-muted animate-pulse" />
          <div className="h-2.5 w-1/3 rounded-full bg-muted/70 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ kind }: { kind: TabKey }) {
  const copy: Record<TabKey, { icon: any; title: string; body: string }> = {
    photos: {
      icon: ImageIcon,
      title: "No photos yet",
      body: "Photos and videos shared in this chat will appear here.",
    },
    files: {
      icon: FileText,
      title: "No files yet",
      body: "Vault files shared in this chat will be listed here.",
    },
    links: {
      icon: LinkIcon,
      title: "No links yet",
      body: "Web links posted in this chat will be collected here.",
    },
    all: {
      icon: ImageIcon,
      title: "Nothing shared yet",
      body: "Photos, files and links shared in this chat will appear here.",
    },
  };
  const { icon: Icon, title, body } = copy[kind];
  return (
    <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
      <div className="h-14 w-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground max-w-xs">{body}</p>
    </div>
  );
}
