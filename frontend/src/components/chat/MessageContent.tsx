import { useMemo, memo, useState, useCallback, useRef, useEffect } from "react";
import { Play } from "lucide-react";
import { LinkPreview } from "./LinkPreview";
import { YouTubeEmbed, extractYouTubeId } from "./YouTubeEmbed";
import { FullscreenImageViewer } from "./FullscreenImageViewer";
import { EventLinkCard } from "./EventLinkCard";
import { BoardLinkCard } from "./BoardLinkCard";
import { PollCard } from "./PollCard";
import { VaultFileCard } from "./VaultFileCard";
import { GalleryLinkCard } from "./GalleryLinkCard";
import { highlightText } from "./ChatSearch";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { NewsLinkCard } from "@/components/chat/NewsLinkCard";
import { preventIfReactionInteractionGuarded } from "@/lib/reactionInteractionGuard";
import { isVideoUrl } from "@/lib/videoUtils";
import {
  getCachedImageAspectRatio,
  setCachedImageAspectRatio,
} from "@/lib/chatImageAspectCache";

interface MessageContentProps {
  text: string;
  mentions?: { userId: string; displayName: string }[];
  imageUrl?: string | null;
  searchQuery?: string;
  showPreviews?: boolean;
  previewsOnly?: boolean;
  onReportImage?: () => void;
  onBlockImageAuthor?: () => void;
  onForwardImage?: () => void;
  showImageActions?: boolean;
}

// URL regex pattern - matches http(s):// or www. URLs
const URL_REGEX = /(?:https?:\/\/|www\.)[^\s]+/gi;
// Mention regex pattern @[name](userId)
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;
// Markdown link pattern [text](url)
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
// Event link pattern [event:uuid]
const EVENT_LINK_REGEX = /\[event:([0-9a-f-]{36})\]/gi;
// Event URL pattern - matches /events/uuid in URLs
const EVENT_URL_REGEX = /(?:https?:\/\/[^\s]*)?\/events\/([0-9a-f-]{36})/gi;
// Poll token pattern [poll:uuid]
const POLL_LINK_REGEX = /\[poll:([0-9a-f-]{36})\]/gi;

// Ensure URL has protocol for href
const ensureProtocol = (url: string): string => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `https://${url}`;
};

// Truncate a URL for display: show domain + ellipsis for long paths
const truncateUrl = (url: string, maxLength = 50): string => {
  if (url.length <= maxLength) return url;
  try {
    const parsed = new URL(ensureProtocol(url));
    const domain = parsed.hostname.replace(/^www\./, '');
    const pathStart = parsed.pathname.slice(0, 20);
    return `${domain}${pathStart}…`;
  } catch {
    return url.slice(0, maxLength) + '…';
  }
};

// Module-level cache of image URLs that have already decoded at least once
// in this session. Prevents the skeleton flash when virtuoso remounts a chat
// row whose image is already in the browser cache (the new <img> mounts with
// React state imageLoaded=false even though the bytes are cached, causing a
// 1-frame flicker on every scroll-back). Cache is keyed by the resolved
// (signed) URL because that's what actually hits the network.
const decodedImageUrls: Set<string> = (globalThis as any).__chatDecodedImages
  ?? ((globalThis as any).__chatDecodedImages = new Set<string>());

// Aspect ratios are now persisted across sessions via
// `chatImageAspectCache` (localStorage + in-memory mirror), keyed by the raw
// storage URL/path. This lets the very first paint after a reload reserve the
// correct height before decode, killing the "image area grows after the
// picture loads" jump that pushed everything below downward.

// Clamp to a tasteful range: very tall portraits get a min ratio so they
// don't dominate the viewport; very wide panoramas get a max ratio. Within
// these bounds we honour the image's real shape.
const MIN_ASPECT_RATIO = 3 / 4;   // tallest allowed (portrait)
const MAX_ASPECT_RATIO = 16 / 9;  // widest allowed (landscape)
const DEFAULT_ASPECT_RATIO = 4 / 3;
const clampAspectRatio = (r: number) =>
  Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, r));

export const MessageContent = memo(function MessageContent({ text, imageUrl, searchQuery, showPreviews = true, previewsOnly = false, onReportImage, onBlockImageAuthor, onForwardImage, showImageActions = false }: MessageContentProps) {
  // Get signed URL for private chat attachments
  const { signedUrl, isLoading: isLoadingSignedUrl } = useSignedPhotoUrl(imageUrl);
  const effectiveImageUrl = signedUrl || imageUrl;

  // Initialise from the decoded-cache so a remounted row that has already
  // loaded this image once does NOT flash the skeleton again. We check BOTH
  // the original and the (synchronously-cached) signed URL because the image
  // <img src> is the signed one but the original is what the parent passes.
  const isAlreadyDecoded = (url: string | null | undefined) =>
    !!url && decodedImageUrls.has(url);
  const [imageLoaded, setImageLoaded] = useState(
    () => isAlreadyDecoded(effectiveImageUrl) || isAlreadyDecoded(imageUrl),
  );
  const [imageError, setImageError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset image state when URL changes — but honour the decoded-cache so we
  // don't blank a row that's already been seen.
  useEffect(() => {
    setImageError(false);
    setImageLoaded(isAlreadyDecoded(effectiveImageUrl) || isAlreadyDecoded(imageUrl));
  }, [imageUrl, effectiveImageUrl]);

  // Check if image is already cached/loaded (for browser-cached images)
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current?.naturalHeight > 0) {
      setImageLoaded(true);
      if (effectiveImageUrl) decodedImageUrls.add(effectiveImageUrl);
      if (imageUrl) decodedImageUrls.add(imageUrl);
      const naturalW = imgRef.current.naturalWidth;
      const naturalH = imgRef.current.naturalHeight;
      if (naturalW > 0 && naturalH > 0) {
        setCachedImageAspectRatio(
          [effectiveImageUrl, imageUrl],
          clampAspectRatio(naturalW / naturalH),
        );
      }
    }
  }, [effectiveImageUrl, imageUrl]);
  
  const parts = useMemo(() => {
    if (!text) return [];
    
    const result: { type: "text" | "link" | "mention" | "markdown-link" | "event-link" | "poll-link" | "board-link" | "vault-file" | "vault-folder" | "vault-root" | "gallery-link" | "news-link"; content: string; userId?: string; linkText?: string; rootScope?: "team" | "club" }[] = [];
    let lastIndex = 0;
    
    // Combined regex. Order: vault root, vault file/folder, poll, board, event, gallery, markdown links, event URLs, plain URLs, mentions
    const combinedRegex = /(\[vaultroot:(team|club):([0-9a-f-]{36})\])|(\[vault:([0-9a-f-]{36})\])|(\[vaultfolder:([0-9a-f-]{36})\])|(\[poll:([0-9a-f-]{36})\])|(\[board:([0-9a-f-]{36})\])|(\[event:([0-9a-f-]{36})\])|(\[(?:gallery|galleryprompt):([0-9a-f-]{36})\])|(\[news:([0-9a-f-]{36})\])|(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|((?:https?:\/\/[^\s]*)?\/events\/([0-9a-f-]{36})(?:\S*)?)|((?:https?:\/\/|www\.)[^\s\]]+)|(@\[([^\]]+)\]\(([^)]+)\))/gi;
    let match;
    
    while ((match = combinedRegex.exec(text)) !== null) {
      // Add text before this match
      if (match.index > lastIndex) {
        const textBefore = text.slice(lastIndex, match.index);
        if (textBefore) {
          result.push({ type: "text", content: textBefore });
        }
      }
      
      if (match[1]) {
        // Vault root token: [vaultroot:scope:uuid] - match[2] scope, match[3] id
        const scope = (match[2] || "").toLowerCase();
        if (scope === "team" || scope === "club") {
          result.push({ type: "vault-root", content: match[3] || "", rootScope: scope });
        }
      } else if (match[4]) {
        // Vault file token: [vault:uuid] - match[5] is the file id
        result.push({ type: "vault-file", content: match[5] || "" });
      } else if (match[6]) {
        // Vault folder token: [vaultfolder:uuid] - match[7] is the folder id
        result.push({ type: "vault-folder", content: match[7] || "" });
      } else if (match[8]) {
        // Poll token: [poll:uuid] - match[9] is the poll ID
        result.push({ type: "poll-link", content: match[9] || "" });
      } else if (match[10]) {
        // Board token: [board:uuid] - match[11] is the active_games ID
        result.push({ type: "board-link", content: match[11] || "" });
      } else if (match[12]) {
        // Event token: [event:uuid] - match[13] is the event ID
        result.push({ type: "event-link", content: match[13] || "" });
      } else if (match[14]) {
        // Gallery token: [gallery:uuid] - match[15] is the gallery_chat_cards ID
        result.push({ type: "gallery-link", content: match[15] || "" });
      } else if (match[16]) {
        // News token: [news:uuid] - match[17] is the club_news ID
        result.push({ type: "news-link", content: match[17] || "" });
      } else if (match[18]) {
        // Markdown link match: [text](url) - match[19] is text, match[20] is URL
        result.push({ 
          type: "markdown-link", 
          content: match[20] || "", 
          linkText: match[19] || "" 
        });
      } else if (match[21]) {
        // Event URL match: /events/uuid - match[22] is the event ID
        result.push({ type: "event-link", content: match[22] || "" });
      } else if (match[23]) {
        // Plain URL match
        result.push({ type: "link", content: match[23] });
      } else if (match[24]) {
        // Mention match - match[25] is display name, match[26] is userId
        result.push({ 
          type: "mention", 
          content: match[25] || "", 
          userId: match[26] || "" 
        });
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex);
      if (remaining) {
        result.push({ type: "text", content: remaining });
      }
    }
    
    // If no matches found, return the entire text as a single part
    return result.length > 0 ? result : [{ type: "text" as const, content: text }];
  }, [text]);

  // Extract URLs and categorize them
  const { youtubeUrls, otherUrls, eventIds, pollIds, boardIds, vaultFileIds, vaultFolderIds, vaultRoots, galleryIds, newsIds } = useMemo(() => {
    const urls = [...new Set(parts.filter(p => p.type === "link").map(p => p.content))];
    const youtube: { url: string; videoId: string }[] = [];
    const other: string[] = [];
    const events = [...new Set(parts.filter(p => p.type === "event-link").map(p => p.content))];
    const polls = [...new Set(parts.filter(p => p.type === "poll-link").map(p => p.content))];
    const boards = [...new Set(parts.filter(p => p.type === "board-link").map(p => p.content))];
    const vaultFiles = [...new Set(parts.filter(p => p.type === "vault-file").map(p => p.content))];
    const vaultFolders = [...new Set(parts.filter(p => p.type === "vault-folder").map(p => p.content))];
    const galleries = [...new Set(parts.filter(p => p.type === "gallery-link").map(p => p.content))];
    const news = [...new Set(parts.filter(p => p.type === "news-link").map(p => p.content))];
    const rootSeen = new Set<string>();
    const roots: { scope: "team" | "club"; id: string }[] = [];
    for (const p of parts) {
      if (p.type === "vault-root" && p.rootScope && p.content) {
        const k = `${p.rootScope}:${p.content}`;
        if (!rootSeen.has(k)) {
          rootSeen.add(k);
          roots.push({ scope: p.rootScope, id: p.content });
        }
      }
    }

    for (const url of urls) {
      const videoId = extractYouTubeId(url);
      if (videoId) {
        youtube.push({ url, videoId });
      } else {
        other.push(url);
      }
    }

    return {
      youtubeUrls: youtube.slice(0, 2),
      otherUrls: other.slice(0, 2),
      eventIds: events.slice(0, 3),
      pollIds: polls.slice(0, 3),
      boardIds: boards.slice(0, 3),
      vaultFileIds: vaultFiles.slice(0, 5),
      vaultFolderIds: vaultFolders.slice(0, 5),
      vaultRoots: roots.slice(0, 3),
      galleryIds: galleries.slice(0, 2),
      newsIds: news.slice(0, 3),
    };
  }, [parts]);

  const [aspectRatio, setAspectRatio] = useState<number | null>(
    () => getCachedImageAspectRatio([effectiveImageUrl, imageUrl]),
  );

  useEffect(() => {
    setAspectRatio(getCachedImageAspectRatio([effectiveImageUrl, imageUrl]));
  }, [effectiveImageUrl, imageUrl]);

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement | HTMLVideoElement>) => {
    setImageLoaded(true);
    if (effectiveImageUrl) decodedImageUrls.add(effectiveImageUrl);
    if (imageUrl) decodedImageUrls.add(imageUrl);
    const target = e.currentTarget as HTMLImageElement & HTMLVideoElement;
    const naturalW = (target as HTMLImageElement).naturalWidth || (target as HTMLVideoElement).videoWidth || 0;
    const naturalH = (target as HTMLImageElement).naturalHeight || (target as HTMLVideoElement).videoHeight || 0;
    if (naturalW > 0 && naturalH > 0) {
      const ratio = clampAspectRatio(naturalW / naturalH);
      setCachedImageAspectRatio([effectiveImageUrl, imageUrl], ratio);
      // Do not resize an already-painted chat row after decode. Novel/legacy
      // images keep their reserved 4:3 box for this mount (object-cover crops
      // safely); the measured ratio is cached so future mounts and Virtuoso's
      // estimator agree before the row paints. Updating state here was the
      // remaining image-only source of post-skeleton row movement.
    }
  }, [effectiveImageUrl, imageUrl]);

  const handleImageError = useCallback(() => {
    setImageError(true);
    setImageLoaded(true); // Hide skeleton on error too
  }, []);

  const [showFullscreen, setShowFullscreen] = useState(false);
  // Always reserve the final card height for in-chat link previews. The
  // non-`previewsOnly` (inline) path previously passed false, so a resolved
  // preview INSERTED an 80px card into an already-mounted row — a real DOM
  // height change that forced a Virtuoso correction and read as flicker on
  // slow scroll-up. Composer previews are unaffected (they use LinkPreview
  // directly, not via MessageContent).
  const reservePreviewSpace = true;

  const handleImageClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (effectiveImageUrl) {
      setShowFullscreen(true);
    }
  }, [effectiveImageUrl]);

  // Stop ALL touch / pointer events from bubbling up to the chat bubble.
  // Without this, the parent's `handleLongPressStart` arms a 600ms timer
  // and `useSwipeToReply` starts tracking the gesture — both of which then
  // fire WHILE the user is mid-pinch inside the FullscreenImageViewer that
  // this tap just opened. The viewer itself is portalled and stops its own
  // propagation, but it can't retroactively cancel a setTimeout that was
  // armed by a touchstart that fired before it mounted. Stopping touch
  // bubbling at the image source is the only reliable cure.
  const stopMediaGesture = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
  }, []);

  const handleLinkClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  // If previewsOnly, skip image and text rendering
  if (previewsOnly) {
    return (
      <>
        {/* Poll cards */}
        {pollIds.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {pollIds.map((pollId) => (
              <PollCard key={pollId} pollId={pollId} />
            ))}
          </div>
        )}

        {/* Event link cards */}
        {eventIds.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {eventIds.map((eventId) => (
              <EventLinkCard key={eventId} eventId={eventId} />
            ))}
          </div>
        )}

        {/* Board link cards (live game boards) */}
        {boardIds.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {boardIds.map((boardId) => (
              <BoardLinkCard key={boardId} gameId={boardId} />
            ))}
          </div>
        )}

        {/* Club news link cards */}
        {newsIds.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {newsIds.map((nid) => (
              <NewsLinkCard key={nid} newsId={nid} />
            ))}
          </div>
        )}

        {/* Gallery link cards (team gallery upload notifications) */}
        {galleryIds.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {galleryIds.map((gid) => (
              <GalleryLinkCard key={gid} cardId={gid} isPromptHint={/\[galleryprompt:/i.test(text)} />
            ))}
          </div>
        )}


        {/* Vault file/folder/root cards */}
        {(vaultFileIds.length > 0 || vaultFolderIds.length > 0 || vaultRoots.length > 0) && (
          <div className="space-y-2 min-w-0 max-w-full">
            {vaultRoots.map((r) => (
              <VaultFileCard key={`vr-${r.scope}-${r.id}`} rootScope={r.scope} rootId={r.id} />
            ))}
            {vaultFileIds.map((id) => (
              <VaultFileCard key={`vf-${id}`} fileId={id} />
            ))}
            {vaultFolderIds.map((id) => (
              <VaultFileCard key={`vfo-${id}`} folderId={id} />
            ))}
          </div>
        )}

        {/* YouTube embeds */}
        {youtubeUrls.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {youtubeUrls.map(({ url, videoId }) => (
              <YouTubeEmbed key={url} videoId={videoId} compact />
            ))}
          </div>
        )}

        {/* Link previews for non-YouTube URLs */}
        {otherUrls.length > 0 && (
          <div className="space-y-2 min-w-0 max-w-full">
            {otherUrls.map((url) => (
              <LinkPreview key={url} url={url} compact reserveSpace={reservePreviewSpace} />
            ))}
          </div>
        )}
      </>
    );
  }

  return (
    <div className={`min-w-0 max-w-full ${imageUrl ? "" : "space-y-2"}`}>
            {/* Image / video attachment — full-bleed at the top of the bubble.
          The parent bubble switches to p-0 when imageUrl is present, so
          the image visually owns the top of the bubble (WhatsApp / iMessage
          pattern) and the caption text below sits in its own padded area.
          Width is set on this wrapper so the bubble has an intrinsic size
          to grow into; aspect-[4/3] reserves height before decode so the
            virtualised scroller doesn't shift.
            Avoid per-image paint containment / compositor promotion here:
            Android WebView can flash newly mounted paint-contained image layers
            during fast upward virtualized scrolls before the layer rasterises. */}
      {imageUrl && !imageError && (
        <div
          className="w-full"
          style={{ width: 300, maxWidth: '100%', touchAction: 'pan-y', overflowAnchor: 'none' }}
            data-media-pending={!imageLoaded || isLoadingSignedUrl ? "true" : undefined}
          onTouchStart={stopMediaGesture}
          onPointerDown={stopMediaGesture}
        >
          <div
            className="relative w-full bg-muted/40 overflow-hidden rounded-md"
            style={{ aspectRatio: String(aspectRatio ?? DEFAULT_ASPECT_RATIO), contain: 'layout' }}
          >
            {(!imageLoaded || isLoadingSignedUrl) && (
              <Skeleton className="absolute inset-0 w-full h-full pointer-events-none rounded-none animate-none" />
            )}
            {!isLoadingSignedUrl && effectiveImageUrl && (
              isVideoUrl(effectiveImageUrl) ? (
                <div
                  className="absolute inset-0 cursor-pointer"
                  style={{ touchAction: 'pan-y' }}
                  onClick={handleImageClick}
                  onTouchStart={stopMediaGesture}
                  onTouchMove={stopMediaGesture}
                  onTouchEnd={stopMediaGesture}
                  onPointerDown={stopMediaGesture}
                >
                  <video
                    src={effectiveImageUrl}
                    className="w-full h-full object-cover"
                    preload="metadata"
                    playsInline
                    muted
                    onLoadedData={handleImageLoad}
                    onError={handleImageError}
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                    <div className="rounded-full bg-black/60 p-3">
                      <Play className="h-6 w-6 fill-white text-white" />
                    </div>
                  </div>
                </div>
              ) : (
                <img
                  ref={imgRef}
                  src={effectiveImageUrl}
                  alt="Attachment"
                  width={300}
                  height={225}
                  decoding="async"
                  loading="eager"
                  draggable={false}
                  style={{ touchAction: 'pan-y' }}
                  className="absolute inset-0 w-full h-full object-cover cursor-pointer"
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                  onClick={handleImageClick}
                  onTouchStart={stopMediaGesture}
                  onTouchMove={stopMediaGesture}
                  onTouchEnd={stopMediaGesture}
                  onPointerDown={stopMediaGesture}
                />
              )
            )}
          </div>
        </div>
      )}

      {/* Fullscreen image viewer */}
      {showFullscreen && effectiveImageUrl && (
        <FullscreenImageViewer
          src={effectiveImageUrl}
          alt="Attachment"
          onClose={() => setShowFullscreen(false)}
          onReport={onReportImage}
          onBlockUser={onBlockImageAuthor}
          onForward={onForwardImage}
          showActions={showImageActions}
        />
      )}

      {/* Text content - render caption text; poll/event tokens render as empty spans inline */}
      {text && parts.some(p => (p.type === "text" || p.type === "link" || p.type === "markdown-link" || p.type === "mention") && p.content && p.content.trim()) && (
        <div
          className={`min-w-0 max-w-full whitespace-pre-wrap ${imageUrl ? "px-3.5 pt-2 pb-1.5 leading-relaxed" : ""}`}
          style={{
            overflowWrap: 'break-word',
            wordBreak: 'break-word',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
            WebkitTapHighlightColor: 'transparent',
          }}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >

          {parts.length === 0 ? (
            // Fallback: render text as-is if parsing fails
            text
          ) : (
            parts.map((part, index) => {
              if (part.type === "markdown-link") {
                // Markdown link: show linkText, href to content (URL)
                return (
                  <a
                    key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`}
                    href={part.content}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block max-w-full align-top break-words underline hover:opacity-80"
                    style={{
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                    onClick={(e) => { e.preventDefault(); if (preventIfReactionInteractionGuarded(e)) return; handleLinkClick(e); safeOpenUrl(part.content); }}
                  >
                    {part.linkText}
                  </a>
                );
               }
              if (part.type === "event-link") {
                // Event links are rendered as empty spans inline; the card is shown below
                return <span key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`} />;
              }
              if (part.type === "board-link") {
                // Board links render inline as empty; the card is shown below
                return <span key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`} />;
              }
              if (part.type === "news-link") {
                // News tokens render as empty spans; the card is shown below
                return <span key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`} />;
              }
              if (part.type === "poll-link") {
                // Poll tokens render as empty spans; the card is shown below
                return <span key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`} />;
              }
              if (part.type === "vault-file" || part.type === "vault-folder" || part.type === "vault-root") {
                // Vault tokens render as empty spans; the card is shown below
                return <span key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`} />;
              }
              if (part.type === "link") {
                const videoId = extractYouTubeId(part.content);
                if (videoId) {
                  return <span key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`} />;
                }
                return (
                  <a
                    key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`}
                    href={ensureProtocol(part.content)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block max-w-full align-top break-all underline hover:opacity-80"
                    style={{
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                    onClick={(e) => { e.preventDefault(); if (preventIfReactionInteractionGuarded(e)) return; handleLinkClick(e); safeOpenUrl(ensureProtocol(part.content)); }}
                  >
                    {truncateUrl(part.content)}
                  </a>
                );
              }
              if (part.type === "mention" && part.content) {
                return (
                  <span
                    key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`}
                    className="font-semibold"
                    style={{
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {searchQuery ? highlightText(part.content, searchQuery) : part.content}
                  </span>
                );
              }
              if (part.type === "text" && part.content) {
                return (
                  <span
                    key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`}
                    style={{
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                      WebkitTouchCallout: 'none',
                      WebkitTapHighlightColor: 'transparent',
                    }}
                  >
                    {searchQuery ? highlightText(part.content, searchQuery) : part.content}
                  </span>
                );
              }
              // Safety fallback for any part with content
              return part.content ? (
                <span
                  key={`${part.type}:${index}:${((part as any).content ?? (part as any).linkText ?? "").slice(0, 24)}`}
                  style={{
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitTouchCallout: 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {part.content}
                </span>
              ) : null;
            })
          )}
        </div>
      )}

      {/* Event link cards - only if showPreviews (otherwise rendered outside bubble via previewsOnly) */}
      {showPreviews && eventIds.length > 0 && (
        <div className="space-y-2 mt-1 min-w-0 max-w-full">
          {eventIds.map((eventId) => (
            <EventLinkCard key={eventId} eventId={eventId} />
          ))}
        </div>
      )}

      {/* Board link cards (live game boards) */}
      {showPreviews && boardIds.length > 0 && (
        <div className="space-y-2 mt-1 min-w-0 max-w-full">
          {boardIds.map((boardId) => (
            <BoardLinkCard key={boardId} gameId={boardId} />
          ))}
        </div>
      )}

      {/* Club news link cards */}
      {showPreviews && newsIds.length > 0 && (
        <div className="space-y-2 mt-1 min-w-0 max-w-full">
          {newsIds.map((nid) => (
            <NewsLinkCard key={nid} newsId={nid} />
          ))}
        </div>
      )}

      {/* Gallery link cards (team gallery upload notifications) */}
      {showPreviews && galleryIds.length > 0 && (
        <div className="space-y-2 mt-1 min-w-0 max-w-full">
          {galleryIds.map((gid) => (
            <GalleryLinkCard key={gid} cardId={gid} isPromptHint={/\[galleryprompt:/i.test(text)} />
          ))}
        </div>
      )}

      {/* Poll cards - only if showPreviews (otherwise rendered outside bubble via previewsOnly) */}
      {showPreviews && pollIds.length > 0 && (
        <div className="space-y-2 mt-1 min-w-0 max-w-full">
          {pollIds.map((pollId) => (
            <PollCard key={pollId} pollId={pollId} />
          ))}
        </div>
      )}

      {/* Vault file/folder/root cards */}
      {showPreviews && (vaultFileIds.length > 0 || vaultFolderIds.length > 0 || vaultRoots.length > 0) && (
        <div className="space-y-2 mt-1 min-w-0 max-w-full">
          {vaultRoots.map((r) => (
            <VaultFileCard key={`vr-${r.scope}-${r.id}`} rootScope={r.scope} rootId={r.id} />
          ))}
          {vaultFileIds.map((id) => (
            <VaultFileCard key={`vf-${id}`} fileId={id} />
          ))}
          {vaultFolderIds.map((id) => (
            <VaultFileCard key={`vfo-${id}`} folderId={id} />
          ))}
        </div>
      )}

      {/* YouTube embeds - only if showPreviews */}
      {showPreviews && youtubeUrls.length > 0 && (
        <div className="space-y-2 mt-2 min-w-0 max-w-full">
          {youtubeUrls.map(({ url, videoId }) => (
            <YouTubeEmbed key={url} videoId={videoId} compact />
          ))}
        </div>
      )}

      {/* Link previews for non-YouTube URLs - only if showPreviews */}
      {showPreviews && otherUrls.length > 0 && (
        <div className="space-y-2 mt-2 min-w-0 max-w-full">
          {otherUrls.map((url) => (
            <LinkPreview key={url} url={url} compact reserveSpace={reservePreviewSpace} />
          ))}
        </div>
      )}
    </div>
  );
});
