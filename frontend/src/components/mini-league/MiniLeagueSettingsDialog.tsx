import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, Loader2, Camera, ImageIcon, Plus, Check, Copy, Wand2, ChevronDown, Minus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { compressImage } from "@/lib/imageCompression";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { toast } from "sonner";

const BIB_COLOR_PRESETS = [
  { name: "Red", value: "#ef4444" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Green", value: "#22c55e" },
  { name: "Yellow", value: "#eab308" },
  { name: "Orange", value: "#f97316" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "White", value: "#ffffff" },
  { name: "Black", value: "#171717" },
];

interface MiniLeagueSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  league: {
    id: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    club_id: string;
    team_size: number | null;
    min_players_per_side: number | null;
    minutes_per_half: number | null;
    bib_colors: string[] | null;
    show_matches_to_members?: boolean | null;
  };
  /** Only club admins, league admins (club-wide or scoped) and app admins may delete. */
  canDelete?: boolean;
}

export function MiniLeagueSettingsDialog({ open, onOpenChange, league, canDelete = false }: MiniLeagueSettingsDialogProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [editName, setEditName] = useState(league.name);
  const [editDescription, setEditDescription] = useState(league.description || "");
  const [editLogoUrl, setEditLogoUrl] = useState<string | null>(league.logo_url || null);
  const [editTeamSize, setEditTeamSize] = useState(league.team_size || 4);
  const [editMinPlayersPerSide, setEditMinPlayersPerSide] = useState(league.min_players_per_side || 3);
  const [editMinutesPerHalf, setEditMinutesPerHalf] = useState(league.minutes_per_half || 10);
  const [editBibColors, setEditBibColors] = useState<string[]>(
    league.bib_colors || ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#a855f7"]
  );
  const [editShowMatchesToMembers, setEditShowMatchesToMembers] = useState<boolean>(!!league.show_matches_to_members);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [mockPlayerCount, setMockPlayerCount] = useState(20);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleteAcknowledged, setDeleteAcknowledged] = useState(false);

  const MOCK_FIRST_NAMES = [
    "Oliver", "Jack", "Sophie", "Charlie", "Emily", "Noah", "Amelia", "George", "Isla", "Harry",
    "Mia", "Leo", "Ava", "Oscar", "Lily", "Freddie", "Ella", "Alfie", "Grace", "Archie",
    "Ruby", "Max", "Chloe", "Ethan", "Zoe", "Liam", "Hannah", "Lucas", "Daisy", "James",
    "Poppy", "Finn", "Lucy", "Sebastian", "Millie", "Henry", "Eva", "Thomas", "Willow", "Arthur",
    "Phoebe", "Daniel", "Ivy", "Samuel", "Ellie", "Theo", "Sienna", "Alexander", "Maisie", "William",
    "Scarlett", "Benjamin", "Jessica", "Jake", "Layla", "Edward", "Rosie", "Isaac", "Bella", "Ryan",
  ];
  const MOCK_LAST_NAMES = [
    "Smith", "Williams", "Taylor", "Brown", "Davies", "Wilson", "Evans", "Thomas", "Johnson", "Roberts",
    "Walker", "White", "Harris", "Clark", "Lewis", "Young", "Hall", "King", "Wright", "Green",
    "Hill", "Scott", "Adams", "Mitchell", "Phillips", "Campbell", "Parker", "Morris", "Cook", "Murphy",
  ];

  const generateMockPlayersMutation = useMutation({
    mutationFn: async () => {
      const players = [];
      const usedNames = new Set<string>();
      for (let i = 0; i < mockPlayerCount; i++) {
        let name: string;
        do {
          const first = MOCK_FIRST_NAMES[Math.floor(Math.random() * MOCK_FIRST_NAMES.length)];
          const last = MOCK_LAST_NAMES[Math.floor(Math.random() * MOCK_LAST_NAMES.length)];
          name = `${first} ${last}`;
        } while (usedNames.has(name));
        usedNames.add(name);
        players.push({
          mini_league_id: league.id,
          name,
          ability_rating: Math.floor(Math.random() * 5) + 1,
        });
      }
      const { error } = await supabase.from("mini_league_players").insert(players);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", league.id] });
      toast.success(`${mockPlayerCount} test players added`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const clearMockPlayersMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("mini_league_players")
        .delete()
        .eq("mini_league_id", league.id)
        .is("child_id", null)
        .is("parent_user_id", null)
        .select("id");
      if (error) throw error;
      return data?.length ?? 0;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["mini-league-players", league.id] });
      if (count === 0) {
        toast.info("No test players to clear");
      } else {
        toast.success(`${count} test player${count === 1 ? "" : "s"} cleared`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const handleOpenChange = (o: boolean) => {
    if (o) {
      setEditName(league.name);
      setEditDescription(league.description || "");
      setEditLogoUrl(league.logo_url || null);
      setEditTeamSize(league.team_size || 4);
      setEditMinPlayersPerSide(league.min_players_per_side || 3);
      setEditMinutesPerHalf(league.minutes_per_half || 10);
      setEditBibColors(league.bib_colors || ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#f97316", "#a855f7"]);
      setEditShowMatchesToMembers(!!league.show_matches_to_members);
      setAdvancedOpen(false);
    }
    onOpenChange(o);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    try {
      const { file: compressedFile } = await compressImage(file);
      const fileName = `mini-league-${league.id}-${Date.now()}.jpg`;
      const filePath = `${league.club_id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("club-logos")
        .upload(filePath, compressedFile, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("club-logos").getPublicUrl(filePath);
      setEditLogoUrl(urlData.publicUrl);
      toast.success("Logo uploaded");
    } catch (error: any) {
      toast.error(error.message || "Failed to upload logo");
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const updateLeagueMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("mini_leagues")
        .update({
          name: editName.trim(),
          description: editDescription.trim() || null,
          logo_url: editLogoUrl,
          team_size: editTeamSize,
          min_players_per_side: editMinPlayersPerSide,
          minutes_per_half: editMinutesPerHalf,
          bib_colors: editBibColors.length > 0 ? editBibColors : null,
          show_matches_to_members: editShowMatchesToMembers,
        })
        .eq("id", league.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mini-league", league.id] });
      onOpenChange(false);
      toast.success("Settings saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteLeagueMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("mini_leagues").delete().eq("id", league.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Mini League deleted");
      navigate("/mini-leagues");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicateLeagueMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("You must be logged in to duplicate a league");

      const { data: newLeague, error: createError } = await supabase
        .from("mini_leagues")
        .insert({
          name: `${editName.trim() || league.name} (Copy)`,
          description: editDescription.trim() || league.description,
          club_id: league.club_id,
          team_size: editTeamSize,
          min_players_per_side: editMinPlayersPerSide,
          minutes_per_half: editMinutesPerHalf,
          bib_colors: editBibColors.length > 0 ? editBibColors : league.bib_colors,
          logo_url: editLogoUrl ?? league.logo_url,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (createError) throw createError;

      const { data: existingPlayers } = await supabase
        .from("mini_league_players")
        .select("name, ability_rating, notes, parent_user_id, child_id")
        .eq("mini_league_id", league.id);

      if (existingPlayers && existingPlayers.length > 0) {
        const { error: playersError } = await supabase
          .from("mini_league_players")
          .insert(existingPlayers.map(p => ({
            ...p,
            mini_league_id: newLeague.id,
          })));
        if (playersError) throw playersError;
      }

      return newLeague.id;
    },
    onSuccess: (newId) => {
      queryClient.invalidateQueries({ queryKey: ["mini-leagues"] });
      onOpenChange(false);
      toast.success("League duplicated with all players!");
      navigate(`/mini-leagues/${newId}`);
    },
    onError: (error: Error) => toast.error(`Failed to duplicate: ${error.message}`),
  });

  const getColorName = (hex: string) => {
    const preset = BIB_COLOR_PRESETS.find(p => p.value.toLowerCase() === hex.toLowerCase());
    return preset?.name || hex;
  };

  const toggleBibColor = (colorValue: string) => {
    if (editBibColors.includes(colorValue)) {
      setEditBibColors(editBibColors.filter(c => c !== colorValue));
    } else {
      setEditBibColors([...editBibColors, colorValue]);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-lg" fullScreen>
        <ResponsiveDialogHeader className="pb-0">
          <ResponsiveDialogTitle>League Settings</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {/* League Identity */}
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative cursor-pointer group shrink-0" onClick={() => logoInputRef.current?.click()}>
                <Avatar className="h-16 w-16 border-2 border-dashed border-muted-foreground/30 group-hover:border-primary transition-colors">
                  {editLogoUrl ? <AvatarImage src={editLogoUrl} alt="League logo" /> : null}
                  <AvatarFallback className="bg-muted">
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                  {uploadingLogo ? (
                    <Loader2 className="h-4 w-4 text-white animate-spin" />
                  ) : (
                    <Camera className="h-4 w-4 text-white" />
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="League name" className="text-base font-medium" />
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoUpload}
                disabled={uploadingLogo}
              />
            </div>
            <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="Optional description" rows={2} className="text-sm" />
          </div>

          {/* Section A: Game Setup */}
          <div className="space-y-5">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Game Setup</h3>

            {/* Default Players Per Side */}
            <div className="space-y-2">
              <Label className="text-sm">Default players per team</Label>
              <div className="flex items-center gap-2">
                {[4, 5, 6, 7, 8].map((size) => (
                  <Button
                    key={size}
                    type="button"
                    variant={editTeamSize === size ? "default" : "outline"}
                    size="sm"
                    className="w-10 h-10"
                    onClick={() => {
                      setEditTeamSize(size);
                      if (editMinPlayersPerSide > size) setEditMinPlayersPerSide(size);
                    }}
                  >
                    {size}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Target team size for auto-generating balanced teams</p>
            </div>

            {/* Minimum Players Per Side — stepper */}
            <div className="space-y-2">
              <Label className="text-sm">Minimum players per team</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  disabled={editMinPlayersPerSide <= 2}
                  onClick={() => setEditMinPlayersPerSide(Math.max(2, editMinPlayersPerSide - 1))}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="text-2xl font-semibold w-10 text-center tabular-nums">{editMinPlayersPerSide}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  disabled={editMinPlayersPerSide >= editTeamSize}
                  onClick={() => setEditMinPlayersPerSide(Math.min(editTeamSize, editMinPlayersPerSide + 1))}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Teams cannot have fewer than this number</p>
            </div>

            {/* Game length */}
            <div className="space-y-2">
              <Label className="text-sm">Game length (minutes per half)</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {[5, 7, 10, 12, 15, 20, 25, 30].map((mins) => (
                  <Button
                    key={mins}
                    type="button"
                    variant={editMinutesPerHalf === mins ? "default" : "outline"}
                    size="sm"
                    className="w-12 h-10"
                    onClick={() => setEditMinutesPerHalf(mins)}
                  >
                    {mins}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Default game timer duration per half</p>
            </div>
          </div>

          {/* Section B: Match Options */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Match Options</h3>

            {/* Show matches to members toggle (off by default) */}
            <label className="flex items-start justify-between gap-3 cursor-pointer">
              <div className="space-y-0.5 min-w-0">
                <span className="text-sm font-medium block">Show matches to members</span>
                <p className="text-xs text-muted-foreground">
                  When off, only league admins can see generated match line-ups. Members will not see the Matches section on event pages.
                </p>
              </div>
              <input
                type="checkbox"
                role="switch"
                checked={editShowMatchesToMembers}
                onChange={(e) => setEditShowMatchesToMembers(e.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-primary cursor-pointer"
              />
            </label>

            <div className="space-y-2.5">
              <Label className="text-sm">Bib colours</Label>
              <p className="text-xs text-muted-foreground">Select which bib colours can be used during matches</p>
              <div className="flex flex-wrap gap-2">
                {BIB_COLOR_PRESETS.map((preset) => {
                  const isSelected = editBibColors.includes(preset.value);
                  const isLight = preset.value === "#ffffff" || preset.value === "#eab308";
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => toggleBibColor(preset.value)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition-all ${
                        isSelected
                          ? "border-2 border-primary bg-primary/5 font-medium"
                          : "border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-muted-foreground/50"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full shrink-0 flex items-center justify-center ${isLight ? "border border-border" : ""}`}
                        style={{ backgroundColor: preset.value }}
                      >
                        {isSelected && (
                          <Check className={`h-2.5 w-2.5 ${isLight ? "text-foreground" : "text-white"}`} />
                        )}
                      </div>
                      {preset.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Section C: Advanced */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full py-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Advanced</h3>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              <div className="flex-1 border-t border-border ml-2" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-3">
              {/* Mock Players */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Add test players</p>
                <p className="text-xs text-muted-foreground">Generate fake players for testing (no parent accounts linked)</p>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={5}
                    max={60}
                    value={mockPlayerCount}
                    onChange={(e) => setMockPlayerCount(Math.min(60, Math.max(5, parseInt(e.target.value) || 20)))}
                    className="w-20 h-9 text-center"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => generateMockPlayersMutation.mutate()}
                    disabled={generateMockPlayersMutation.isPending}
                  >
                    {generateMockPlayersMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <Wand2 className="h-4 w-4 mr-1.5" />
                        Generate
                      </>
                    )}
                  </Button>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 -ml-2"
                      disabled={clearMockPlayersMutation.isPending}
                    >
                      {clearMockPlayersMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      Clear test players
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear test players?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes all generated test players (those with no linked parent or child) from this league. Real players linked to accounts won't be affected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => clearMockPlayersMutation.mutate()}
                      >
                        Clear
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              {/* Duplicate & Delete */}
              <div className="space-y-3 pt-2 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => duplicateLeagueMutation.mutate()}
                  disabled={duplicateLeagueMutation.isPending}
                >
                  {duplicateLeagueMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Copy className="h-4 w-4 mr-2" />
                  )}
                  Duplicate league with players
                </Button>

                {canDelete && (
                  <AlertDialog
                    open={deleteOpen}
                    onOpenChange={(o) => {
                      setDeleteOpen(o);
                      if (!o) {
                        setDeleteConfirmText("");
                        setDeleteAcknowledged(false);
                      }
                    }}
                  >
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete league
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle className="text-destructive">Permanently delete this mini league?</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                          <div className="space-y-3 text-sm">
                            <p>
                              This will <strong>permanently delete</strong> "{league.name}", along with all its players, sessions, groups and history.
                              This cannot be undone and parents will lose access to anything stored against the league.
                            </p>
                            <p>
                              To continue, type the league name exactly:
                              <span className="block mt-1 font-mono font-semibold text-foreground">{league.name}</span>
                            </p>
                            <Input
                              autoFocus
                              value={deleteConfirmText}
                              onChange={(e) => setDeleteConfirmText(e.target.value)}
                              placeholder="Type the league name"
                            />
                            <label className="flex items-start gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={deleteAcknowledged}
                                onChange={(e) => setDeleteAcknowledged(e.target.checked)}
                              />
                              <span>I understand this permanently deletes the league and all its data.</span>
                            </label>
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            if (
                              deleteConfirmText.trim() !== league.name.trim() ||
                              !deleteAcknowledged ||
                              deleteLeagueMutation.isPending
                            ) {
                              e.preventDefault();
                              return;
                            }
                            deleteLeagueMutation.mutate();
                          }}
                          disabled={
                            deleteConfirmText.trim() !== league.name.trim() ||
                            !deleteAcknowledged ||
                            deleteLeagueMutation.isPending
                          }
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {deleteLeagueMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Delete league permanently"
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        <ResponsiveDialogFooter className="px-4 pb-safe border-t border-border pt-3">
          <div className="flex gap-2 w-full">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1 sm:flex-none">
              Cancel
            </Button>
            <Button
              onClick={() => updateLeagueMutation.mutate()}
              disabled={!editName.trim() || updateLeagueMutation.isPending}
              className="flex-[2] sm:flex-1"
            >
              {updateLeagueMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
