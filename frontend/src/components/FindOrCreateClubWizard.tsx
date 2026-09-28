import { useState, useEffect } from "react";
import { Search, Building2, Plus, MapPin, Loader2, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Camera } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { SPORT_EMOJIS, getSportEmoji } from "@/lib/sportEmojis";

const SPORTS = Object.keys(SPORT_EMOJIS);

const AUSTRALIAN_STATES = [
  "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"
];

type WizardMode = "search" | "create" | "request-sent";

interface ClubSearchResult {
  id: string;
  name: string;
  logo_url: string | null;
  city: string | null;
  state: string | null;
  sport: string | null;
}

interface FindOrCreateClubWizardProps {
  onClubCreated: (clubId: string) => void;
  onJoinRequestSent: (clubId: string, clubName: string) => void;
  defaultSport?: string;
}

export default function FindOrCreateClubWizard({
  onClubCreated,
  onJoinRequestSent,
  defaultSport,
}: FindOrCreateClubWizardProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<WizardMode>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [searchResults, setSearchResults] = useState<ClubSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Create mode fields
  const [clubName, setClubName] = useState("");
  const [clubDescription, setClubDescription] = useState("");
  const [clubLogoUrl, setClubLogoUrl] = useState("");
  const [clubLogoFile, setClubLogoFile] = useState<File | null>(null);
  const [clubSport, setClubSport] = useState(defaultSport || "");
  const [saving, setSaving] = useState(false);

  // Join request
  const [joinMessage, setJoinMessage] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [requestSentClub, setRequestSentClub] = useState<{ id: string; name: string } | null>(null);

  // Debounced search
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      setHasSearched(true);

      let query = supabase
        .from("clubs")
        .select("id, name, logo_url, city, state, sport")
        .eq("kind", "full")
        .ilike("name", `%${searchQuery.trim()}%`)
        .order("name")
        .limit(10);

      if (stateFilter) {
        query = query.eq("state", stateFilter);
      }

      const { data, error } = await query;

      if (!error && data) {
        setSearchResults(data);
      }
      setSearching(false);
    }, 400);

    return () => clearTimeout(timer);
  }, [searchQuery, stateFilter]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setClubLogoFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setClubLogoUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleCreateClub = async () => {
    if (!clubName.trim() || !user) return;

    setSaving(true);

    // Check for duplicate name
    const { data: existing } = await supabase
      .from("clubs")
      .select("id")
      .ilike("name", clubName.trim())
      .maybeSingle();

    if (existing) {
      setSaving(false);
      toast({ title: "Club name already exists", description: "Please choose a different name.", variant: "destructive" });
      return;
    }

    const { data: club, error: clubError } = await supabase
      .from("clubs")
      .insert({
        name: clubName.trim(),
        description: clubDescription.trim() || null,
        logo_url: null,
        sport: clubSport || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (clubError) {
      setSaving(false);
      toast({
        title: "Error",
        description: clubError.message.includes("idx_unique_club_name")
          ? "A club with this name already exists."
          : "Failed to create club. Please try again.",
        variant: "destructive",
      });
      return;
    }

    // Upload logo
    if (clubLogoFile) {
      try {
        const fileExt = clubLogoFile.name.split(".").pop();
        const fileName = `${club.id}/${Date.now()}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from("club-logos")
          .upload(fileName, clubLogoFile, { upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from("club-logos")
            .getPublicUrl(fileName);
          await supabase.from("clubs").update({ logo_url: urlData.publicUrl }).eq("id", club.id);
        }
      } catch (error) {
        console.error("Logo upload error:", error);
      }
    }

    // Assign creator as club_admin
    await supabase.from("user_roles").insert({
      user_id: user.id,
      role: "club_admin" as any,
      club_id: club.id,
    });

    setSaving(false);
    onClubCreated(club.id);
  };

  const handleSendJoinRequest = async (club: ClubSearchResult) => {
    if (!user) return;
    setSendingRequest(true);

    const { error } = await supabase.from("club_join_requests").insert({
      club_id: club.id,
      user_id: user.id,
      message: joinMessage.trim() || null,
    });

    setSendingRequest(false);

    if (error) {
      if (error.code === "23505") {
        toast({ title: "Already requested", description: "You've already sent a join request to this club.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Failed to send join request. Please try again.", variant: "destructive" });
      }
      return;
    }

    setRequestSentClub({ id: club.id, name: club.name });
    setMode("request-sent");
    toast({ title: "Request sent!", description: `Your join request has been sent to ${club.name}.` });
    onJoinRequestSent(club.id, club.name);
  };

  if (mode === "request-sent" && requestSentClub) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-3 py-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Check className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold">Request Sent!</h2>
          <p className="text-muted-foreground max-w-xs mx-auto">
            Your request to join <strong>{requestSentClub.name}</strong> has been sent to the club admin for approval.
          </p>
          <p className="text-sm text-muted-foreground">
            You'll be notified once your request is reviewed.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => { setMode("search"); setRequestSentClub(null); }}>
            Search for another club
          </Button>
          <Button variant="ghost" onClick={() => setMode("create")}>
            Or create a new club instead
          </Button>
        </div>
      </div>
    );
  }

  if (mode === "create") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Create New Club</h2>
          <Button variant="ghost" size="sm" onClick={() => setMode("search")}>
            <Search className="h-4 w-4 mr-1" />
            Search instead
          </Button>
        </div>

        {/* Logo Upload */}
        <Card>
          <CardContent className="py-6">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Avatar className="h-24 w-24 border-4 border-primary/20">
                  <AvatarImage src={clubLogoUrl || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-2xl">
                    {clubName.charAt(0)?.toUpperCase() || <Building2 className="h-8 w-8" />}
                  </AvatarFallback>
                </Avatar>
                <label className="absolute bottom-0 right-0 p-2 rounded-full bg-primary cursor-pointer hover:bg-primary/90 transition-colors shadow-lg">
                  <Camera className="h-4 w-4 text-primary-foreground" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                </label>
              </div>
              <p className="text-sm text-muted-foreground">Tap to add logo</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newClubName">Club Name *</Label>
              <Input
                id="newClubName"
                placeholder="Enter club name"
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                className="h-12"
              />
            </div>

            <div className="space-y-2">
              <Label>Sport</Label>
              <Select value={clubSport} onValueChange={setClubSport}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder="Select a sport">
                    {clubSport && (
                      <span className="flex items-center gap-2">
                        <span>{getSportEmoji(clubSport)}</span>
                        <span>{clubSport}</span>
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SPORTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className="flex items-center gap-2">
                        <span>{getSportEmoji(s)}</span>
                        <span>{s}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="newClubDescription">Description</Label>
              <Textarea
                id="newClubDescription"
                placeholder="Tell us about your club..."
                value={clubDescription}
                onChange={(e) => setClubDescription(e.target.value)}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        <Button className="w-full" size="lg" onClick={handleCreateClub} disabled={saving || !clubName.trim()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Club & Continue"}
        </Button>
      </div>
    );
  }

  // Search mode (default)
  return (
    <div className="space-y-5">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold">Find Your Club</h2>
        <p className="text-muted-foreground text-sm">
          Search for your club below, or create a new one
        </p>
      </div>

      {/* Search controls */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by club name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12"
          />
        </div>
        <Select value={stateFilter} onValueChange={(v) => setStateFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Filter by state (optional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {AUSTRALIAN_STATES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      <div className="space-y-2 min-h-[120px]">
        {searching && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!searching && hasSearched && searchResults.length === 0 && (
          <Card>
            <CardContent className="py-6 text-center space-y-3">
              <Building2 className="h-10 w-10 mx-auto text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">No clubs found matching "{searchQuery}"</p>
              <Button variant="default" size="sm" onClick={() => { setClubName(searchQuery); setMode("create"); }}>
                <Plus className="h-4 w-4 mr-1" />
                Create "{searchQuery}"
              </Button>
            </CardContent>
          </Card>
        )}

        {!searching && searchResults.map((club) => (
          <ClubSearchResultCard
            key={club.id}
            club={club}
            joinMessage={joinMessage}
            onJoinMessageChange={setJoinMessage}
            onJoinRequest={() => handleSendJoinRequest(club)}
            sendingRequest={sendingRequest}
          />
        ))}
      </div>

      {/* Create new */}
      <div className="pt-2 border-t border-border">
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setMode("create")}
        >
          <Plus className="h-4 w-4 mr-2" />
          Create a new club
        </Button>
      </div>
    </div>
  );
}

function ClubSearchResultCard({
  club,
  joinMessage,
  onJoinMessageChange,
  onJoinRequest,
  sendingRequest,
}: {
  club: ClubSearchResult;
  joinMessage: string;
  onJoinMessageChange: (v: string) => void;
  onJoinRequest: () => void;
  sendingRequest: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const location = [club.city, club.state].filter(Boolean).join(", ");

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-11 w-11 shrink-0 border border-border">
            <AvatarImage src={club.logo_url || undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
              {club.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate">{club.name}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {club.sport && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {getSportEmoji(club.sport)} {club.sport}
                </Badge>
              )}
              {location && (
                <span className="flex items-center gap-0.5">
                  <MapPin className="h-3 w-3" />
                  {location}
                </span>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant={expanded ? "secondary" : "default"}
            onClick={() => setExpanded(!expanded)}
            className="shrink-0"
          >
            {expanded ? "Cancel" : "Join"}
          </Button>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-border space-y-3">
            <Textarea
              placeholder="Add a message (optional) – e.g. 'I coach the U12s'"
              value={joinMessage}
              onChange={(e) => onJoinMessageChange(e.target.value)}
              rows={2}
              className="text-sm"
            />
            <Button
              size="sm"
              className="w-full"
              onClick={onJoinRequest}
              disabled={sendingRequest}
            >
              {sendingRequest ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" />
                  Send Join Request
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
