import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe, Users2, Check, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

interface BroadcastAudienceSelectorProps {
  /** Selected club ids. Empty array = every user on the app. */
  value: string[];
  onChange: (clubIds: string[]) => void;
  disabled?: boolean;
}

/**
 * App-admin audience control for the Announcements broadcast thread.
 *
 * An empty selection keeps the historical behaviour (global announcement,
 * `target_club_ids` stored as NULL). Selecting clubs restricts visibility to
 * members of those clubs — enforced server side by the broadcast_messages
 * SELECT policy, this is only the composer affordance.
 */
export function BroadcastAudienceSelector({ value, onChange, disabled }: BroadcastAudienceSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: clubs, isLoading } = useQuery({
    queryKey: ["broadcast-audience-clubs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .is("deleted_at", null)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clubs ?? [];
    return (clubs ?? []).filter((c) => (c.name ?? "").toLowerCase().includes(q));
  }, [clubs, search]);

  const selected = new Set(value);
  const label =
    value.length === 0
      ? "Everyone"
      : value.length === 1
        ? (clubs?.find((c) => c.id === value[0])?.name ?? "1 club")
        : `${value.length} clubs`;

  const toggle = (id: string) => {
    onChange(selected.has(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <>
      <div className="flex items-center gap-2 px-1 pb-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          {value.length === 0 ? <Globe className="h-3.5 w-3.5 mr-1" /> : <Users2 className="h-3.5 w-3.5 mr-1" />}
          Audience: <span className="font-medium text-foreground ml-1">{label}</span>
        </Button>
        {value.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onChange([])}
          >
            Send to everyone
          </Button>
        )}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="h-[70vh] flex flex-col p-0">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle>Announcement audience</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clubs"
                className="pl-8"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              No clubs selected sends to every user on Ignite.
            </p>
          </div>
          <ScrollArea className="flex-1">
            <div className="px-2 pb-6">
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full flex items-center justify-between rounded-lg px-3 py-3 text-sm hover:bg-muted/60"
              >
                <span className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  Everyone
                </span>
                {value.length === 0 && <Check className="h-4 w-4 text-primary" />}
              </button>
              {isLoading && <p className="px-3 py-3 text-sm text-muted-foreground">Loading clubs…</p>}
              {filtered.map((club) => (
                <button
                  key={club.id}
                  type="button"
                  onClick={() => toggle(club.id)}
                  className="w-full flex items-center justify-between rounded-lg px-3 py-3 text-sm hover:bg-muted/60"
                >
                  <span className="text-left">{club.name}</span>
                  {selected.has(club.id) && <Check className="h-4 w-4 text-primary" />}
                </button>
              ))}
              {!isLoading && filtered.length === 0 && (
                <p className="px-3 py-3 text-sm text-muted-foreground">No clubs found.</p>
              )}
            </div>
          </ScrollArea>
          <div className="p-4 border-t border-border">
            <Button className="w-full" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
