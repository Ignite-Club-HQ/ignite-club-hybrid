import { useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

import { Loader2, Search, MessageSquare, Forward } from "lucide-react";
import {
  useForwardDestinations,
  useForwardMessageMutation,
  type ForwardSourceMessage,
} from "@/hooks/useForwardMessage";
import { useAuth } from "@/hooks/useAuth";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { cn } from "@/lib/utils";

function ForwardThumbnail({ imageUrl }: { imageUrl: string }) {
  const { signedUrl } = useSignedPhotoUrl(imageUrl);
  return (
    <div className="h-10 w-10 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
      <img
        src={signedUrl || imageUrl}
        alt=""
        className="h-full w-full object-cover"
      />
    </div>
  );
}

const MAX_DESTINATIONS = 5;

interface ForwardMessageSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The source message being forwarded (text + optional image + original author). */
  source: ForwardSourceMessage | null;
  /** Group id of the source chat — excluded from destination list to avoid self-forwards. */
  excludeGroupId?: string | null;
}

export function ForwardMessageSheet({
  open,
  onOpenChange,
  source,
  excludeGroupId,
}: ForwardMessageSheetProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: destinations, isLoading } = useForwardDestinations(user?.id, open);
  const forwardMutation = useForwardMessageMutation(user?.id);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setSearch("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const list = (destinations ?? []).filter(
      (d) => !excludeGroupId || d.id !== excludeGroupId,
    );
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.club_name ?? "").toLowerCase().includes(q),
    );
  }, [destinations, excludeGroupId, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_DESTINATIONS) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const handleSend = async () => {
    if (!source || selected.size === 0) return;
    await forwardMutation.mutateAsync({
      source,
      destinationGroupIds: Array.from(selected),
    });
    onOpenChange(false);
  };

  const previewText = source?.text?.trim() || (source?.imageUrl ? "Photo" : "");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        enableDragToClose
        hideCloseButton
        className="rounded-t-3xl border-t border-border bg-background p-0 max-h-[85vh] flex flex-col"
      >
        <div className="px-5 pt-2 pb-3 shrink-0">
          <SheetHeader className="text-left pb-2">
            <SheetTitle className="text-xl">Forward message</SheetTitle>
            <SheetDescription className="text-xs">
              Send a copy to up to {MAX_DESTINATIONS} group chats
            </SheetDescription>
          </SheetHeader>

          {source ? (
            <div className="rounded-xl border border-border bg-muted/40 p-3 flex gap-2 items-start">
              {source.imageUrl ? (
                <ForwardThumbnail imageUrl={source.imageUrl} />
              ) : (
                <div className="h-10 w-10 shrink-0 rounded-md bg-muted flex items-center justify-center">
                  <MessageSquare className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Forwarded
                </p>
                <p className="text-sm line-clamp-2 break-words">{previewText}</p>
              </div>
            </div>
          ) : null}

          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              className="pl-9"
            />
          </div>
        </div>

        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No group chats available
            </div>
          ) : (
            <ul className="space-y-1 pb-2">
              {filtered.map((d) => {
                const isChecked = selected.has(d.id);
                const limitReached =
                  !isChecked && selected.size >= MAX_DESTINATIONS;
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      disabled={limitReached}
                      onClick={() => toggle(d.id)}
                      className={cn(
                        "w-full flex items-center gap-3 rounded-xl p-3 text-left touch-manipulation",
                        "border border-transparent",
                        isChecked && "bg-primary/10 border-primary/30",
                        !isChecked && "hover:bg-accent/40 active:bg-accent/60",
                        limitReached && "opacity-50",
                      )}
                    >
                      <Checkbox
                        checked={isChecked}
                        disabled={limitReached}
                        className="pointer-events-none"
                      />
                      <div className="h-9 w-9 shrink-0 rounded-full bg-violet-500/15 text-violet-400 flex items-center justify-center">
                        <MessageSquare className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-tight truncate">
                          {d.name}
                        </p>
                        {d.club_name && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {d.club_name}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border bg-background px-5 py-3 pb-safe shrink-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {selected.size} of {MAX_DESTINATIONS} selected
            </p>
            <Button
              onClick={handleSend}
              disabled={
                selected.size === 0 ||
                forwardMutation.isPending ||
                !source
              }
              className="gap-2"
            >
              {forwardMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Forward className="h-4 w-4" />
              )}
              Forward
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
