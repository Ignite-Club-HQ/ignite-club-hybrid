import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GripVertical, Plus, Trash2, Pencil, X } from "lucide-react";
import { clubLinksService } from "@/lab/clubLinksService.mjs";
import type { ClubLinksService } from "@/lab/ClubLinksService";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { CLUB_LINK_ICONS } from "@/lab/clubLinkIcons";

interface ClubLinkRecord {
  revision?: bigint;
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  icon: string;
  open_mode: string;
  sort_order: number;
  is_active: boolean;
}

interface DraftState {
  expectedRevision?: bigint;
  id?: string;
  title: string;
  subtitle: string;
  url: string;
  icon: string;
  open_mode: string;
  is_active: boolean;
}

const EMPTY_DRAFT: DraftState = {
  title: "",
  subtitle: "",
  url: "",
  icon: "link",
  open_mode: "browser",
  is_active: true,
};

function normalizeUrl(raw: string): string | null {
  // Strip all whitespace (mobile keyboards frequently insert stray spaces,
  // which would otherwise be percent-encoded into the hostname as %20).
  const trimmed = raw.replace(/\s+/g, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    // Hostname must look like a real domain: labels separated by dots, no encoded chars.
    if (!/^[a-z0-9.-]+$/i.test(parsed.hostname)) return null;
    if (!parsed.hostname.includes(".")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}


/**
 * Club-admin management for the home page "Club Info & Links" tiles.
 */
export default function ClubLinksManager({ clubId, service = clubLinksService }: { clubId: string; service?: ClubLinksService }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<DraftState | null>(null);

  const { data: links = [], isLoading, error, refetch } = useQuery<ClubLinkRecord[]>({
    queryKey: ["club-links-admin", clubId],
    queryFn: async () => {
      return service.listAdmin(clubId);
    },
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["club-links-admin", clubId] }),
      queryClient.invalidateQueries({ queryKey: ["club-quick-links"] }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async (value: DraftState) => {
      const url = normalizeUrl(value.url);
      if (!value.title.trim()) throw new Error("Please enter a title.");
      if (!url) throw new Error("Please enter a valid web address.");

      await service.save(clubId, { ...value, title: value.title.trim(), subtitle: value.subtitle.trim() || null, url });
    },
    onSuccess: async () => {
      setDraft(null);
      await invalidate();
      toast({ title: "Link saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't save link", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (link: ClubLinkRecord) => {
      await service.remove(link.id, link.revision);
    },
    onSuccess: async () => {
      await invalidate();
      toast({ title: "Link removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't remove link", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active, revision }: { id: string; is_active: boolean; revision?: bigint }) => {
      await service.setActive(id, is_active, revision);
    },
    onSuccess: invalidate,
    onError: (error: Error) => {
      toast({ title: "Couldn't update link", description: error.message, variant: "destructive" });
    },
  });

  const moveMutation = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: -1 | 1 }) => {
      const target = index + direction;
      if (target < 0 || target >= links.length) return;
      const a = links[index];
      const b = links[target];
      await service.reorder(clubId, a.id, b.id, a.revision);
    },
    onSuccess: invalidate,
    onError: (error: Error) => toast({ title: "Couldn't reorder links", description: error.message, variant: "destructive" }),
  });

  if (error) return <Card><CardContent className="space-y-4 p-4"><p role="alert">Could not load links: {error.message}</p><Button onClick={() => refetch()}>Retry loading links</Button></CardContent></Card>;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Club Info &amp; Links</h3>
            <p className="text-xs text-muted-foreground">
              Tiles shown on every member&apos;s home page — policies, registration, clothing and more.
            </p>
          </div>
          {!draft && (
            <Button size="sm" variant="outline" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          )}
        </div>

        {draft && (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {draft.id ? "Edit link" : "New link"}
              </span>
              <Button size="icon" variant="ghost" onClick={() => setDraft(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-1">
              <Label htmlFor="club-link-title">Title</Label>
              <Input
                id="club-link-title"
                value={draft.title}
                placeholder="Registration"
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="club-link-subtitle">Subtitle (optional)</Label>
              <Input
                id="club-link-subtitle"
                value={draft.subtitle}
                placeholder="Season 2026"
                onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="club-link-url">Web address</Label>
              <Input
                id="club-link-url"
                inputMode="url"
                autoCapitalize="none"
                value={draft.url}
                placeholder="https://reference.invalid"
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Icon</Label>
                <Select value={draft.icon} onValueChange={(v) => setDraft({ ...draft, icon: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.keys(CLUB_LINK_ICONS).map((key) => (
                      <SelectItem key={key} value={key} className="capitalize">
                        {key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Opens</Label>
                <Select
                  value={draft.open_mode}
                  onValueChange={(v) => setDraft({ ...draft, open_mode: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="browser">In-app browser</SelectItem>
                    <SelectItem value="embed">Embedded page</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="club-link-active" className="text-xs">
                Visible to members
              </Label>
              <Switch
                id="club-link-active"
                checked={draft.is_active}
                onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
              />
            </div>

            <Button
              className="w-full"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate(draft)}
            >
              {draft.id ? "Save changes" : "Add link"}
            </Button>
          </div>
        )}

        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading links…</p>
        ) : links.length === 0 ? (
          <p className="text-xs text-muted-foreground">No links yet.</p>
        ) : (
          <ul className="space-y-2">
            {links.map((link, index) => (
              <li
                key={link.id}
                className="flex items-center gap-2 rounded-lg border border-border p-2"
              >
                <div className="flex flex-col">
                  <button
                    type="button"
                    aria-label="Move up"
                    className="text-muted-foreground disabled:opacity-30"
                    disabled={index === 0}
                    onClick={() => moveMutation.mutate({ index, direction: -1 })}
                  >
                    <GripVertical className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    className="text-muted-foreground disabled:opacity-30"
                    disabled={index === links.length - 1}
                    onClick={() => moveMutation.mutate({ index, direction: 1 })}
                  >
                    <GripVertical className="h-3 w-3" />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{link.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{link.url}</p>
                </div>
                <Switch
                  checked={link.is_active}
                  aria-label="Visible to members"
                  onCheckedChange={(v) => toggleMutation.mutate({ id: link.id, is_active: v, revision: link.revision })}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Edit link"
                  onClick={() =>
                    setDraft({
                      expectedRevision: link.revision,
                      id: link.id,
                      title: link.title,
                      subtitle: link.subtitle || "",
                      url: link.url,
                      icon: link.icon,
                      open_mode: link.open_mode,
                      is_active: link.is_active,
                    })
                  }
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove link"
                  onClick={() => deleteMutation.mutate(link)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
