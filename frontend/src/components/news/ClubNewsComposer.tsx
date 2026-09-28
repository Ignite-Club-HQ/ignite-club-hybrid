import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, ImagePlus, Loader2, Paperclip, X } from "lucide-react";

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { MobileCardSelect } from "@/components/MobileCardSelect";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/use-toast";
import { useClubTeamsForNews, useNewsPublishableClubs } from "@/features/news/useClubNews";
import {
  attachmentToken,
  formatFileSize,
  NEWS_ATTACHMENT_MAX_BYTES,
  NEWS_MAX_FILES,
  NEWS_MAX_IMAGES,
  type NewsAttachment,
} from "@/features/news/newsAttachments";



const TITLE_MAX = 120;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Preferred club (usually the active club filter). */
  defaultClubId?: string | null;
}

type Audience = "club" | "teams";

/**
 * Club News composer. Reuses the existing club-admin role model for
 * permissions, the existing `club-logos` public bucket for images, and the
 * existing notifications pipeline (`notify_club_news`) for the optional push —
 * no new notification infrastructure.
 */
export default function ClubNewsComposer({ open, onOpenChange, defaultClubId }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: clubs = [] } = useNewsPublishableClubs();

  const initialClub = useMemo(() => {
    if (defaultClubId && clubs.some((c) => c.id === defaultClubId)) return defaultClubId;
    return clubs[0]?.id ?? "";
  }, [defaultClubId, clubs]);

  const [clubId, setClubId] = useState(initialClub);
  const effectiveClubId = clubId || initialClub;
  const { data: teams = [] } = useClubTeamsForNews(effectiveClubId || null);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [audience, setAudience] = useState<Audience>("club");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [important, setImportant] = useState(false);
  const [sendPush, setSendPush] = useState(true);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extraImages, setExtraImages] = useState<Array<{ id: string; file: File; preview: string }>>(
    [],
  );
  const [docFiles, setDocFiles] = useState<Array<{ id: string; file: File }>>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extraImagesInputRef = useRef<HTMLInputElement>(null);
  const docsInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  /** Caret position in the body, so "Insert here" lands where the author was typing. */
  const caretRef = useRef<number | null>(null);

  const rememberCaret = () => {
    const el = contentRef.current;
    if (el) caretRef.current = el.selectionStart ?? el.value.length;
  };

  /**
   * Places an inline token for this item at the last known caret position.
   * The token is what makes the image/file render inside that section of the
   * article body rather than in the trailing list.
   */
  const insertAtCaret = (id: string, label: string) => {
    const token = attachmentToken(id);
    setContent((prev) => {
      if (prev.includes(token)) return prev;
      const at = Math.min(caretRef.current ?? prev.length, prev.length);
      const before = prev.slice(0, at).replace(/\s+$/, "");
      const after = prev.slice(at).replace(/^\s+/, "");
      const next = `${before}${before ? "\n\n" : ""}${token}${after ? `\n\n${after}` : "\n"}`;
      caretRef.current = next.indexOf(token) + token.length;
      return next;
    });
    toast({ title: "Placed in article", description: `${label} will appear at that point.` });
  };

  const removeToken = (id: string) =>
    setContent((prev) =>
      prev.replace(attachmentToken(id), "").replace(/\n{3,}/g, "\n\n"),
    );

  const reset = () => {
    setTitle("");
    setContent("");
    setAudience("club");
    setTeamIds([]);
    setImportant(false);
    setSendPush(true);
    setImageFile(null);
    setImagePreview(null);
    setExtraImages([]);
    setDocFiles([]);
    caretRef.current = null;
  };

  const tooBig = (file: File) => {
    if (file.size <= NEWS_ATTACHMENT_MAX_BYTES) return false;
    toast({
      title: "File too large",
      description: `${file.name} is over ${formatFileSize(NEWS_ATTACHMENT_MAX_BYTES)}.`,
      variant: "destructive",
    });
    return true;
  };

  const pickImage = (file: File | null) => {
    if (file && tooBig(file)) return;
    setImageFile(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const addExtraImages = (files: File[]) => {
    const accepted = files.filter((f) => !tooBig(f));
    setExtraImages((prev) =>
      [
        ...prev,
        ...accepted.map((file) => ({
          id: crypto.randomUUID(),
          file,
          preview: URL.createObjectURL(file),
        })),
      ].slice(0, NEWS_MAX_IMAGES),
    );
  };

  const addDocFiles = (files: File[]) => {
    const accepted = files.filter((f) => !tooBig(f));
    setDocFiles((prev) =>
      [...prev, ...accepted.map((file) => ({ id: crypto.randomUUID(), file }))].slice(
        0,
        NEWS_MAX_FILES,
      ),
    );
  };


  const uploadToBucket = async (file: File, clubIdForPath: string) => {
    const ext = file.name.split(".").pop() || "bin";
    const path = `news/${clubIdForPath}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("club-logos")
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (upErr) throw upErr;
    return supabase.storage.from("club-logos").getPublicUrl(path).data.publicUrl;
  };


  const publish = useMutation({
    mutationFn: async () => {
      if (!effectiveClubId) throw new Error("Select a club");
      if (!title.trim()) throw new Error("Add a title");
      if (audience === "teams" && teamIds.length === 0) {
        throw new Error("Select at least one team");
      }

      let imageUrl: string | null = null;
      if (imageFile) {
        imageUrl = await uploadToBucket(imageFile, effectiveClubId);
      }

      const body = content.trim();
      const attachments: NewsAttachment[] = [];
      for (const item of extraImages) {
        attachments.push({
          kind: "image",
          url: await uploadToBucket(item.file, effectiveClubId),
          name: item.file.name,
          size: item.file.size,
          mimeType: item.file.type || null,
          anchor: body.includes(attachmentToken(item.id)) ? item.id : null,
        });
      }
      for (const item of docFiles) {
        attachments.push({
          kind: "file",
          url: await uploadToBucket(item.file, effectiveClubId),
          name: item.file.name,
          size: item.file.size,
          mimeType: item.file.type || null,
          anchor: body.includes(attachmentToken(item.id)) ? item.id : null,
        });
      }


      const { data, error } = await supabase
        .from("club_news")
        .insert({
          club_id: effectiveClubId,
          title: title.trim().slice(0, TITLE_MAX),
          content: content.trim(),
          image_url: imageUrl,
          author_id: user?.id ?? null,
          target_team_ids: audience === "teams" ? teamIds : null,
          is_important: important,
          attachments: attachments as unknown as never,
        })
        .select("id")

        .single();
      if (error) throw error;

      const { error: notifyErr } = await supabase.rpc("notify_club_news", {
        _news_id: data.id,
        _send_push: sendPush,
      });
      if (notifyErr) {
        // The post is published; notification failure must not lose the post.
        console.warn("[ClubNews] notify failed", notifyErr.message);
      }

      // Share the post in the relevant chat: club chat for whole-club news,
      // each targeted team's chat for team-specific news. Idempotent server
      // side, and a failure here must never lose the published post.
      try {
        const { error: chatErr } = await supabase.functions.invoke(
          "auto-post-news-to-chat",
          { body: { newsId: data.id } },
        );
        if (chatErr) console.warn("[ClubNews] chat post failed", chatErr.message);
      } catch (chatErr) {
        console.warn("[ClubNews] chat post failed", chatErr);
      }

      return data.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-news"] });
      toast({ title: "News published", description: "Members can see it now." });
      reset();
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      toast({
        title: "Couldn't publish",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>New club news</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="space-y-4 overflow-y-auto px-1 pb-2">
          {clubs.length > 1 && (
            <MobileCardSelect
              label="Club"
              value={effectiveClubId}
              onValueChange={setClubId}
              options={clubs.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="Select club"
            />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="news-title">Title</Label>
            <Input
              id="news-title"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Wicket Keeping 2026–27"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="news-content">Content</Label>
            <Textarea
              ref={contentRef}
              id="news-content"
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                caretRef.current = e.target.selectionStart;
              }}
              onSelect={rememberCaret}
              onKeyUp={rememberCaret}
              onClick={rememberCaret}
              onBlur={rememberCaret}
              rows={6}
              placeholder="What do members need to know?"
            />
            <p className="text-xs text-muted-foreground">
              Add images or files below, then tap their <span className="font-medium text-foreground">Insert here</span> button to place them where your cursor is in the content.
            </p>
          </div>


          <div className="space-y-1.5">
            <Label>Header image (optional)</Label>
            {imagePreview ? (
              <div className="relative w-full overflow-hidden rounded-lg border">
                <img src={imagePreview} alt="News image preview" className="h-32 w-full object-cover" />
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-2 top-2 h-7 w-7"
                  onClick={() => pickImage(null)}
                  aria-label="Remove image"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus className="mr-2 h-4 w-4" /> Add image
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>More images (optional)</Label>
            {extraImages.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {extraImages.map((item, i) => {
                  const placed = content.includes(attachmentToken(item.id));
                  return (
                    <div key={item.id} className="space-y-1">
                      <div className="relative overflow-hidden rounded-lg border">
                        <img src={item.preview} alt="" className="h-20 w-full object-cover" />
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="absolute right-1 top-1 h-6 w-6"
                          onClick={() => {
                            removeToken(item.id);
                            setExtraImages((prev) => prev.filter((_, idx) => idx !== i));
                          }}
                          aria-label={`Remove ${item.file.name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={placed ? "secondary" : "outline"}
                        className="h-7 w-full px-1 text-[11px]"
                        onClick={() =>
                          placed ? removeToken(item.id) : insertAtCaret(item.id, item.file.name)
                        }
                      >
                        {placed ? "Unplace" : "Insert here"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={extraImages.length >= NEWS_MAX_IMAGES}
              onClick={() => extraImagesInputRef.current?.click()}
            >
              <ImagePlus className="mr-2 h-4 w-4" />
              {extraImages.length >= NEWS_MAX_IMAGES ? "Image limit reached" : "Add more images"}
            </Button>
            {extraImages.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Uploaded images will show an <span className="font-medium text-foreground">Insert here</span> option.
              </p>
            )}
            <input
              ref={extraImagesInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addExtraImages(Array.from(e.target.files ?? []));
                e.currentTarget.value = "";
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Attachments (optional)</Label>
            {docFiles.length > 0 && (
              <div className="space-y-2">
                {docFiles.map((item, i) => {
                  const placed = content.includes(attachmentToken(item.id));
                  return (
                    <div key={item.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{item.file.name}</p>
                        {formatFileSize(item.file.size) && (
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(item.file.size)}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={placed ? "secondary" : "outline"}
                        className="h-7 px-2 text-[11px]"
                        onClick={() =>
                          placed ? removeToken(item.id) : insertAtCaret(item.id, item.file.name)
                        }
                      >
                        {placed ? "Unplace" : "Insert here"}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => {
                          removeToken(item.id);
                          setDocFiles((prev) => prev.filter((_, idx) => idx !== i));
                        }}
                        aria-label={`Remove ${item.file.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={docFiles.length >= NEWS_MAX_FILES}
              onClick={() => docsInputRef.current?.click()}
            >
              <Paperclip className="mr-2 h-4 w-4" />
              {docFiles.length >= NEWS_MAX_FILES ? "File limit reached" : "Attach files"}
            </Button>
            <p className="text-xs text-muted-foreground">
              PDFs, documents or spreadsheets up to {formatFileSize(NEWS_ATTACHMENT_MAX_BYTES)} each.
            </p>
            {docFiles.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Uploaded files will show an <span className="font-medium text-foreground">Insert here</span> option.
              </p>
            )}
            <input
              ref={docsInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addDocFiles(Array.from(e.target.files ?? []));
                e.currentTarget.value = "";
              }}
            />
          </div>


          <div className="space-y-2">
            <Label>Who's this for?</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: "club" as Audience, label: "Entire club" },
                  { key: "teams" as Audience, label: "Selected teams" },
                ]
              ).map((o) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setAudience(o.key)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    audience === o.key
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/40"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {audience === "teams" && (
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                {teams.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No teams in this club.</p>
                ) : (
                  teams.map((t) => (
                    <label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={teamIds.includes(t.id)}
                        onCheckedChange={() =>
                          setTeamIds((prev) =>
                            prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                          )
                        }
                      />
                      <span>{t.name}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Mark as important</p>
              <p className="text-xs text-muted-foreground">Shows an Important badge</p>
            </div>
            <Switch checked={important} onCheckedChange={setImportant} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Send push notification</p>
              <p className="text-xs text-muted-foreground">Notify the selected audience</p>
            </div>
            <Switch checked={sendPush} onCheckedChange={setSendPush} />
          </div>
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publish.isPending}>
            Cancel
          </Button>
          <Button onClick={() => publish.mutate()} disabled={publish.isPending || !title.trim()}>
            {publish.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Publish
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
