import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, X, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

interface OpponentInputProps {
  value: string;
  onChange: (value: string) => void;
  clubId?: string;
  teamId?: string;
  placeholder?: string;
}

interface FavoriteOpponent {
  id: string;
  opponent_name: string;
  club_id: string | null;
  team_id: string | null;
}

export function OpponentInput({
  value,
  onChange,
  clubId,
  teamId,
  placeholder = "e.g., Eagles FC",
}: OpponentInputProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  // Fetch favorite opponents
  const { data: favorites } = useQuery({
    queryKey: ["favorite-opponents", user?.id, clubId, teamId],
    queryFn: async () => {
      let query = supabase
        .from("favorite_opponents")
        .select("*")
        .order("opponent_name");

      // Get favorites for this user, club, or team
      if (teamId) {
        query = query.or(`user_id.eq.${user!.id},team_id.eq.${teamId}`);
      } else if (clubId) {
        query = query.or(`user_id.eq.${user!.id},club_id.eq.${clubId}`);
      } else {
        query = query.eq("user_id", user!.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Deduplicate by opponent name
      const seen = new Set<string>();
      return (data as FavoriteOpponent[]).filter(f => {
        const key = f.opponent_name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
    enabled: !!user,
  });

  // Save favorite mutation
  const saveFavorite = useMutation({
    mutationFn: async (opponentName: string) => {
      const { error } = await supabase
        .from("favorite_opponents")
        .insert({
          user_id: user!.id,
          opponent_name: opponentName.trim(),
          club_id: clubId || null,
          team_id: teamId || null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorite-opponents"] });
      toast({ title: "Opponent saved to favorites" });
    },
    onError: () => {
      toast({ title: "Failed to save favorite", variant: "destructive" });
    },
  });

  // Delete favorite mutation
  const deleteFavorite = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("favorite_opponents")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["favorite-opponents"] });
    },
  });

  const handleSaveFavorite = () => {
    if (value.trim()) {
      saveFavorite.mutate(value.trim());
    }
  };

  const isFavorite = favorites?.some(
    (f) => f.opponent_name.toLowerCase() === value.trim().toLowerCase()
  );

  const filteredFavorites = favorites?.filter((f) =>
    f.opponent_name.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Opponent</Label>
        {value.trim() && !isFavorite && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={handleSaveFavorite}
            disabled={saveFavorite.isPending}
          >
            <Star className="h-3 w-3" />
            Save
          </Button>
        )}
        {isFavorite && (
          <Badge variant="secondary" className="text-xs gap-1">
            <Star className="h-3 w-3 fill-current" />
            Saved
          </Badge>
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              onFocus={() => setOpen(true)}
              className={value ? "pr-8" : ""}
            />
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </PopoverTrigger>

        {favorites && favorites.length > 0 && (
          <PopoverContent 
            className="w-[var(--radix-popover-trigger-width)] p-0" 
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="p-2 border-b border-border">
              <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Star className="h-3 w-3" />
                Favorite Opponents
              </p>
            </div>
            <ScrollArea className="max-h-[200px]">
              <div className="p-1">
                {(filteredFavorites && filteredFavorites.length > 0 ? filteredFavorites : favorites).map((fav) => (
                  <button
                    key={fav.id}
                    type="button"
                    className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-muted text-left text-sm"
                    onClick={() => {
                      onChange(fav.opponent_name);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{fav.opponent_name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {value.toLowerCase() === fav.opponent_name.toLowerCase() && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteFavorite.mutate(fav.id);
                        }}
                      >
                        <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}
