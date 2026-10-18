import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Image as ImageIcon, Check } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { publishChatImageToGallery } from "@/lib/publishChatImageToGallery";
import { toast } from "sonner";

interface ChatImage {
  message_id: string;
  image_url: string;
  created_at: string;
}

import { getLocalLabPublishableChatPhotos } from "@/lab/fixtureDataLayer";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveLatestMessagesPage, getLiveGroupMetadata, ensureLiveClubConversations } from "@/live/features/messaging";
import { getCurrentInternetIdentity } from "@/live/internetIdentityAuth";
import { listLiveAssets } from "@/live/features/media";
import { parseIcpBlobUrl } from "@/live/mediaStorage";
import { SecureImage } from "@/components/SecureImage";

export default function PublishChatPhotosPage() {
  const useIcpLab = resolveLocalAuthMode(window.location.search, true);
  if (useIcpLab) {
    return <IcpLabPublishChatPhotosPage />;
  }
  if (resolveAuthBackend() === "icp") {
    return <IcpPublishChatPhotosPage />;
  }
  return <SupabasePublishChatPhotosPage />;
}

/** Read-only synthetic chat-photo list; publishing to the gallery remains unavailable until media_metadata is wired here. */
function IcpLabPublishChatPhotosPage() {
  const navigate = useNavigate();
  const { teamId } = useParams<{ teamId: string }>();
  const photos = getLocalLabPublishableChatPhotos("club-icp-001");

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Publish Chat Photos</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing synthetic ICP lab chat photos for team {teamId ?? "team-icp-001"}. Publishing to the gallery is
        disabled.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {photos.map((photo) => (
          <div key={photo.id} className="flex aspect-square items-center justify-center rounded-md border bg-muted">
            <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
  );
}


const ICP_CHAT_PHOTO_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

interface IcpChatImage {
  message_id: string;
  image_url: string;
  created_at: string;
}

/**
 * Live ICP branch: lists the signed-in member's own image attachments from
 * this team's conversation (team id doubles as the messaging-canister
 * conversation id, same convention as TeamChatPage) over the last 14 days,
 * drops ones already registered as a media_metadata asset for the club
 * (idempotency, mirroring the Supabase "already published" filter), and
 * publishes selections via publishChatImageToGallery's ICP branch, which
 * registers the same blob_ref as a gallery asset without re-uploading bytes.
 */
function IcpPublishChatPhotosPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());

  const queryKey = ["icp-publishable-chat-photos", teamId];

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: async (): Promise<{ clubId: string | null; teamName: string | null; images: IcpChatImage[] }> => {
      if (!teamId) return { clubId: null, teamName: null, images: [] };
      const identity = await getCurrentInternetIdentity();
      if (!identity) return { clubId: null, teamName: null, images: [] };
      const selfText = identity.getPrincipal().toText();

      return withFeatureBackend("messaging", {
        supabase: async () => ({ clubId: null, teamName: null, images: [] }),
        icp: async (ctx) => {
          const group = await getLiveGroupMetadata(ctx, teamId).catch(() => null);
          const clubId = group?.clubId ?? null;
          if (clubId) {
            try {
              await ensureLiveClubConversations(ctx, clubId);
            } catch {
              /* best-effort self-heal, matches TeamChatPage */
            }
          }

          const since = Date.now() - ICP_CHAT_PHOTO_WINDOW_MS;
          const page = await listLiveLatestMessagesPage(ctx, teamId, null, 200);

          const alreadyPublished = new Set<string>();
          if (clubId) {
            try {
              const assets = await listLiveAssets(ctx, clubId);
              for (const asset of assets as Array<{ blob_ref?: Array<{ path: string; canister: string }> }>) {
                const ref = asset.blob_ref?.[0];
                if (ref) alreadyPublished.add(`${ref.canister}:${ref.path}`);
              }
            } catch {
              /* best-effort — worst case a duplicate shows up and publish reports alreadyPublished */
            }
          }

          const images: IcpChatImage[] = [];
          for (const m of page.messages as Array<{
            id: string;
            sender: { toText(): string };
            created_at_ms: bigint;
            attachment?: Array<{ kind: string; url?: Array<string>; ref_id: string }>;
          }>) {
            if (m.sender.toText() !== selfText) continue;
            const createdAtMs = Number(m.created_at_ms);
            if (createdAtMs < since) continue;
            const attachment = m.attachment?.[0];
            if (!attachment || attachment.kind !== "image") continue;
            const imageUrl = attachment.url?.[0] ?? attachment.ref_id;
            if (!imageUrl) continue;
            const blobLocation = parseIcpBlobUrl(imageUrl);
            if (blobLocation && alreadyPublished.has(`${blobLocation.canisterId}:${blobLocation.path}`)) continue;
            images.push({
              message_id: m.id,
              image_url: imageUrl,
              created_at: new Date(createdAtMs).toISOString(),
            });
          }
          images.sort((a, b) => b.created_at.localeCompare(a.created_at));
          return { clubId, teamName: group?.name ?? null, images };
        },
      }, { teamId: teamId });
    },
    enabled: !!teamId,
  });

  const images = data?.images ?? [];
  const clubId = data?.clubId ?? null;
  const remaining = useMemo(() => images.filter((c) => !done.has(c.image_url)), [images, done]);

  const handlePublishOne = async (img: IcpChatImage) => {
    const identity = await getCurrentInternetIdentity();
    if (!identity || !teamId) return;
    setPublishing((s) => new Set(s).add(img.image_url));
    try {
      await publishChatImageToGallery({
        imageUrl: img.image_url,
        uploaderId: identity.getPrincipal().toText(),
        teamId,
        clubId,
      });
      setDone((s) => new Set(s).add(img.image_url));
    } catch (err: any) {
      toast.error(err?.message || "Could not publish");
    } finally {
      setPublishing((s) => {
        const next = new Set(s);
        next.delete(img.image_url);
        return next;
      });
    }
  };

  const handlePublishAll = async () => {
    if (!remaining.length) return;
    // No ICP counterpart to the Supabase create_photo_album RPC yet, so a
    // batch publishes as separate gallery assets rather than one grouped card.
    let ok = 0;
    let failed = 0;
    for (const img of remaining) {
      try {
        await handlePublishOne(img);
        ok++;
      } catch {
        failed++;
      }
    }
    toast.success(`Published ${ok} photo${ok === 1 ? "" : "s"} to the gallery${failed ? ` (${failed} failed)` : ""}`);
    qc.invalidateQueries({ queryKey });
  };

  if (isLoading) return <PageLoading />;

  return (
    <div className="py-6 space-y-6 max-w-3xl mx-auto px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">Add to gallery</h1>
          <p className="text-xs text-muted-foreground truncate">
            {data?.teamName ? `${data.teamName} · ` : ""}Your recent chat photos
          </p>
        </div>
      </div>

      {error ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-sm text-muted-foreground">Could not load chat photos.</p>
        </div>
      ) : images.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No unpublished chat photos found in the last 14 days.
          </p>
        </div>
      ) : (
        <>
          {remaining.length > 0 && (
            <Button onClick={handlePublishAll} className="w-full" size="lg">
              Publish all {remaining.length} to gallery
            </Button>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {images.map((img) => {
              const isDone = done.has(img.image_url);
              const isBusy = publishing.has(img.image_url);
              return (
                <div key={img.message_id} className="relative rounded-lg overflow-hidden bg-muted">
                  <SecureImage
                    src={img.image_url}
                    alt="Chat photo"
                    className="w-full aspect-square object-cover"
                  />
                  {isDone ? (
                    <div className="absolute inset-0 bg-primary/70 flex items-center justify-center">
                      <Check className="h-10 w-10 text-primary-foreground" />
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handlePublishOne(img)}
                      disabled={isBusy}
                      className="absolute bottom-2 left-2 right-2"
                    >
                      {isBusy ? "Publishing…" : "Add to gallery"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SupabasePublishChatPhotosPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());

  const { data: team } = useQuery({
    queryKey: ["team-club-for-publish", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("teams")
        .select("id, name, club_id")
        .eq("id", teamId!)
        .maybeSingle();
      return data;
    },
    enabled: !!teamId && resolveAuthBackend() !== "icp",
  });

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["my-unpublished-chat-photos", teamId, user?.id],
    queryFn: async (): Promise<ChatImage[]> => {
      if (!teamId || !user?.id) return [];
      // Last 14 days of my chat photos in this team.
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: msgs } = await supabase
        .from("team_messages")
        .select("id, image_url, created_at")
        .eq("team_id", teamId)
        .eq("author_id", user.id)
        .not("image_url", "is", null)
        .is("deleted_at", null)
        .eq("is_system_message", false)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);

      const list = (msgs ?? []).filter((m) => !!m.image_url);
      if (list.length === 0) return [];

      const urls = Array.from(new Set(list.map((m) => m.image_url as string)));
      const published = new Set<string>();
      for (let i = 0; i < urls.length; i += 100) {
        const chunk = urls.slice(i, i + 100);
        const { data: pubs } = await supabase
          .from("photos")
          .select("image_url")
          .eq("uploader_id", user.id)
          .in("image_url", chunk)
          .is("deleted_at", null);
        (pubs ?? []).forEach((p) => p.image_url && published.add(p.image_url));
      }

      return list
        .filter((m) => !published.has(m.image_url as string))
        .map((m) => ({
          message_id: m.id as string,
          image_url: m.image_url as string,
          created_at: m.created_at as string,
        }));
    },
    enabled: !!teamId && !!user?.id && resolveAuthBackend() !== "icp",
  });

  const remaining = useMemo(
    () => (candidates ?? []).filter((c) => !done.has(c.image_url)),
    [candidates, done],
  );

  const handlePublishOne = async (img: ChatImage, albumId?: string | null) => {
    if (!user?.id || !team) return;
    setPublishing((s) => new Set(s).add(img.image_url));
    try {
      await publishChatImageToGallery({
        imageUrl: img.image_url,
        uploaderId: user.id,
        teamId: team.id,
        clubId: team.club_id ?? null,
        albumId: albumId ?? null,
      });
      setDone((s) => new Set(s).add(img.image_url));
    } catch (err: any) {
      toast.error(err?.message || "Could not publish");
    } finally {
      setPublishing((s) => {
        const next = new Set(s);
        next.delete(img.image_url);
        return next;
      });
    }
  };

  const handlePublishAll = async () => {
    if (!remaining.length) return;

    // Create a single album so the batch renders as ONE gallery card with
    // a +N badge instead of N separate cards. Only when publishing 2+.
    // If album creation fails, fall back to per-photo publish (ungrouped)
    // rather than blocking the user — better to publish than not.
    let batchAlbumId: string | null = null;
    if (remaining.length > 1) {
      try {
        const { data, error } = await supabase.rpc("create_photo_album", {
          _club_id: team?.club_id ?? null,
          _team_id: team?.id ?? null,
          _mini_league_id: null,
          _event_id: null,
          _caption: null,
        });
        if (error) throw error;
        batchAlbumId = (data as string) ?? null;
      } catch (err) {
        console.warn("[PublishChatPhotos] album creation failed, publishing ungrouped", err);
      }
    }

    let ok = 0;
    let failed = 0;
    for (const img of remaining) {
      try {
        await handlePublishOne(img, batchAlbumId);
        ok++;
      } catch {
        failed++;
      }
    }
    toast.success(`Published ${ok} photo${ok === 1 ? "" : "s"} to the gallery${failed ? ` (${failed} failed)` : ""}`);
    qc.invalidateQueries({ queryKey: ["my-unpublished-chat-photos", teamId, user?.id] });
  };

  if (isLoading) return <PageLoading />;

  return (
    <div className="py-6 space-y-6 max-w-3xl mx-auto px-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">Add to gallery</h1>
          <p className="text-xs text-muted-foreground truncate">
            {team?.name ? `${team.name} · ` : ""}Your recent chat photos
          </p>
        </div>
      </div>

      {(!candidates || candidates.length === 0) ? (
        <div className="text-center py-12 space-y-3">
          <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No unpublished chat photos found in the last 14 days.
          </p>
        </div>
      ) : (
        <>
          {remaining.length > 0 && (
            <Button onClick={handlePublishAll} className="w-full" size="lg">
              Publish all {remaining.length} to gallery
            </Button>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(candidates ?? []).map((img) => {
              const isDone = done.has(img.image_url);
              const isBusy = publishing.has(img.image_url);
              return (
                <div key={img.message_id} className="relative rounded-lg overflow-hidden bg-muted">
                  <img
                    src={img.image_url}
                    alt="Chat photo"
                    className="w-full aspect-square object-cover"
                    loading="lazy"
                  />
                  {isDone ? (
                    <div className="absolute inset-0 bg-primary/70 flex items-center justify-center">
                      <Check className="h-10 w-10 text-primary-foreground" />
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handlePublishOne(img)}
                      disabled={isBusy}
                      className="absolute bottom-2 left-2 right-2"
                    >
                      {isBusy ? "Publishing…" : "Add to gallery"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
