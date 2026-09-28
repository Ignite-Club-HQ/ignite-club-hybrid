import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2, Baby, UserCheck, Users } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import TeamTrainingPausesCard from "@/components/team/TeamTrainingPausesCard";

import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { ClassFieldsSection } from "@/components/ClassFieldsSection";
import { LevelAgeCombobox } from "@/components/LevelAgeCombobox";
import { RsvpAudienceSelect } from "@/components/event/RsvpAudienceSelect";
import { DEFAULT_TEAM_RSVP_AUDIENCE, type RsvpAudience } from "@/lib/rsvpAudience";
import { shouldUseNativePicker, pickNativePhoto } from "@/lib/nativePhotoPicker";
import { isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import { mimeToExtension } from "@/lib/binaryUtils";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClubDetail, getLocalLabTeamDetail } from "@/lab/fixtureDataLayer";

export default function EditTeamPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const providerKey = useIcpLab ? "icp" : "supabase";

  const [name, setName] = useState("");
  const [levelAge, setLevelAge] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [teamType, setTeamType] = useState<"junior" | "senior" | "mixed">("mixed");
  const [saving, setSaving] = useState(false);

  // Class mode fields
  const [classDay, setClassDay] = useState("");
  const [classTime, setClassTime] = useState("");
  const [classDuration, setClassDuration] = useState<number | null>(null);
  const [classCapacity, setClassCapacity] = useState<number | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [autoRsvpDm, setAutoRsvpDm] = useState(false);
  const [autoRsvpCadences, setAutoRsvpCadences] = useState<string[]>(["t72", "t24", "t3"]);
  const [autoRsvpEventTypes, setAutoRsvpEventTypes] = useState<string[]>(["match", "training", "game"]);
  const [defaultRsvpAudience, setDefaultRsvpAudience] = useState<RsvpAudience>(DEFAULT_TEAM_RSVP_AUDIENCE);

  const { data: team, isLoading, fetchStatus: teamFetchStatus } = useQuery({
    queryKey: ["team", id, "edit", providerKey],
    queryFn: async () => {
      if (useIcpLab) {
        const fixture = getLocalLabTeamDetail(id!);
        if (!fixture) return null;
        const club = getLocalLabClubDetail(fixture.club_id);
        return {
          ...fixture,
          level_age: null,
          description: null,
          logo_url: null,
          folder_id: null,
          team_type: "mixed",
          class_day: null,
          class_time: null,
          class_duration_minutes: null,
          class_capacity: null,
          is_archived: false,
          auto_rsvp_dm_enabled: false,
          auto_rsvp_dm_cadences: ["t72", "t24", "t3"],
          auto_rsvp_dm_event_types: ["match", "training", "game"],
          default_rsvp_audience: DEFAULT_TEAM_RSVP_AUDIENCE,
          clubs: {
            id: fixture.club_id,
            name: club?.name ?? "Synthetic club",
            sport: club?.sport ?? null,
            class_mode_enabled: false,
          },
        };
      }
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs!club_id (id, name, sport, class_mode_enabled)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Fetch available folders for this club
  const { data: folders = [] } = useQuery({
    queryKey: ["team-folders", team?.club_id, providerKey],
    queryFn: async () => {
      if (useIcpLab) return [];
      const { data, error } = await supabase
        .from("team_folders")
        .select("*")
        .eq("club_id", team!.club_id)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!team?.club_id,
  });

  useEffect(() => {
    if (team) {
      setName(team.name || "");
      setLevelAge(team.level_age || "");
      setDescription(team.description || "");
      setLogoUrl(team.logo_url || "");
      setFolderId(team.folder_id || null);
      setTeamType((team as any).team_type || "mixed");
      setClassDay((team as any).class_day || "");
      setClassTime((team as any).class_time || "");
      setClassDuration((team as any).class_duration_minutes ?? null);
      setClassCapacity((team as any).class_capacity ?? null);
      setIsActive(!team.is_archived);
      setAutoRsvpDm(!!(team as any).auto_rsvp_dm_enabled);
      const cad = (team as any).auto_rsvp_dm_cadences;
      if (Array.isArray(cad) && cad.length) setAutoRsvpCadences(cad);
      const types = (team as any).auto_rsvp_dm_event_types;
      if (Array.isArray(types) && types.length) setAutoRsvpEventTypes(types);
      const aud = (team as any).default_rsvp_audience;
      if (aud === "players_only" || aud === "players_and_parents" || aud === "parents_only") {
        setDefaultRsvpAudience(aud);
      }
    }
  }, [team]);

  const [uploading, setUploading] = useState(false);
  const isNative = shouldUseNativePicker();

  const handleNativeLogoPick = async () => {
    if (!id || !team?.club_id) return;
    if (useIcpLab) {
      toast({
        title: "Logo uploads are unavailable in ICP lab mode",
        description: "No team data has been changed.",
      });
      return;
    }
    try {
      const result = await pickNativePhoto({ quality: 80 });
      setUploading(true);

      const ext = mimeToExtension(result.mimeType);
      const fileName = `${team.club_id}/${id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('club-logos')
        .upload(fileName, result.blob, { upsert: true, contentType: result.mimeType });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('club-logos').getPublicUrl(fileName);
      setLogoUrl(urlData.publicUrl);
      toast({ title: "Logo uploaded", description: "Your team logo has been uploaded successfully." });
    } catch (error) {
      if (!isCancelledSelectionError(error)) {
        console.error('Logo upload error:', error);
        toast({ title: "Upload failed", description: "Failed to upload logo. Please try again.", variant: "destructive" });
      }
    } finally {
      setUploading(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id || !team?.club_id) return;
    if (useIcpLab) {
      toast({
        title: "Logo uploads are unavailable in ICP lab mode",
        description: "No team data has been changed.",
      });
      e.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${team.club_id}/${id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('club-logos')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('club-logos')
        .getPublicUrl(fileName);

      setLogoUrl(urlData.publicUrl);
      toast({
        title: "Logo uploaded",
        description: "Your team logo has been uploaded successfully.",
      });
    } catch (error) {
      console.error('Logo upload error:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload logo. Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        title: "Missing information",
        description: "Please enter a team name.",
        variant: "destructive",
      });
      return;
    }

    if (useIcpLab) {
      toast({
        title: "Team editing is unavailable in ICP lab mode",
        description: "Your preview changes were not persisted.",
      });
      return;
    }

    setSaving(true);

    const { error: teamError } = await supabase
      .from("teams")
      .update({
        name: name.trim(),
        level_age: levelAge.trim() || null,
        description: description.trim() || null,
        logo_url: logoUrl || null,
        folder_id: folderId || null,
        team_type: teamType,
        is_archived: !isActive,
        auto_rsvp_dm_enabled: autoRsvpDm,
        auto_rsvp_dm_cadences: autoRsvpCadences.length ? autoRsvpCadences : ["t72", "t24", "t3"],
        auto_rsvp_dm_event_types: autoRsvpEventTypes.length
          ? (autoRsvpEventTypes.includes("match") && !autoRsvpEventTypes.includes("game")
              ? [...autoRsvpEventTypes, "game"]
              : autoRsvpEventTypes)
          : ["match", "training", "game"],
        default_rsvp_audience: defaultRsvpAudience,
        ...((team?.clubs as any)?.class_mode_enabled ? {
          class_day: classDay || null,
          class_time: classTime || null,
          class_duration_minutes: classDuration,
          class_capacity: classCapacity,
        } : {}),
      })
      .eq("id", id!);

    setSaving(false);

    if (teamError) {
      toast({
        title: "Error",
        description: "Failed to update team. Please try again.",
        variant: "destructive",
      });
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["team", id] });
    queryClient.invalidateQueries({ queryKey: ["club-teams", team?.club_id] });

    toast({
      title: "Team updated!",
      description: `${name} has been updated successfully.`,
    });

    navigate(`/teams/${id}`);
  };

  if (isLoading || (teamFetchStatus === "paused" && !team)) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Team not found</p>
      </div>
    );
  }

  if (useIcpLab) {
    return (
      <div className="py-6 space-y-4">
        <Button variant="ghost" onClick={() => navigate(-1)}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <h1 className="text-lg font-semibold">Team editing is unavailable in ICP lab mode</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {team.name} is a synthetic fixture. Settings, training breaks, and logo changes are not persisted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-bold">Edit Team</h1>
          {team.clubs && <p className="text-sm text-muted-foreground">{team.clubs.name}</p>}
        </div>
      </div>

      {/* Logo Upload Section */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Avatar className="h-28 w-28 border-4 border-primary/20">
                <AvatarImage src={logoUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-3xl">
                  {name.charAt(0)?.toUpperCase() || "T"}
                </AvatarFallback>
              </Avatar>
              {isNative ? (
                <button
                  type="button"
                  className={`absolute bottom-0 right-0 p-2.5 rounded-full bg-primary cursor-pointer hover:bg-primary/90 transition-colors shadow-lg ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
                  onClick={handleNativeLogoPick}
                  disabled={uploading}
                >
                  {uploading ? (
                    <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5 text-primary-foreground" />
                  )}
                </button>
              ) : (
                <label className={`absolute bottom-0 right-0 p-2.5 rounded-full bg-primary cursor-pointer hover:bg-primary/90 transition-colors shadow-lg ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                  {uploading ? (
                    <Loader2 className="h-5 w-5 text-primary-foreground animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5 text-primary-foreground" />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                    disabled={uploading}
                  />
                </label>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Tap to change team logo</p>
          </div>
        </CardContent>
      </Card>

      {/* Team Details */}
      <Card>
        <CardContent className="py-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="name" className="text-base">Team Name *</Label>
            <Input
              id="name"
              placeholder="e.g., U12 Dragons"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="h-12 text-base"
            />
          </div>

          {/* Team Type — placed before Level / Age Group because it drives
              which levels the combobox offers. */}
          <div className="space-y-2">
            <Label className="text-base">Team Type</Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTeamType("junior")}
                className={`p-3 rounded-xl text-center transition-all border-2 ${
                  teamType === "junior"
                    ? "border-pink-500 bg-pink-500/10"
                    : "border-border hover:border-pink-500/50"
                }`}
              >
                <Baby className={`h-5 w-5 mx-auto mb-1 ${teamType === "junior" ? "text-pink-600" : "text-muted-foreground"}`} />
                <p className={`text-sm font-medium ${teamType === "junior" ? "text-pink-600" : ""}`}>Junior</p>
                <p className="text-[10px] text-muted-foreground">Kids only</p>
              </button>
              <button
                type="button"
                onClick={() => setTeamType("senior")}
                className={`p-3 rounded-xl text-center transition-all border-2 ${
                  teamType === "senior"
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-border hover:border-amber-500/50"
                }`}
              >
                <UserCheck className={`h-5 w-5 mx-auto mb-1 ${teamType === "senior" ? "text-amber-600" : "text-muted-foreground"}`} />
                <p className={`text-sm font-medium ${teamType === "senior" ? "text-amber-600" : ""}`}>Senior</p>
                <p className="text-[10px] text-muted-foreground">Adults only</p>
              </button>
              <button
                type="button"
                onClick={() => setTeamType("mixed")}
                className={`p-3 rounded-xl text-center transition-all border-2 ${
                  teamType === "mixed"
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <Users className={`h-5 w-5 mx-auto mb-1 ${teamType === "mixed" ? "text-primary" : "text-muted-foreground"}`} />
                <p className={`text-sm font-medium ${teamType === "mixed" ? "text-primary" : ""}`}>Mixed</p>
                <p className="text-[10px] text-muted-foreground">All ages</p>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {teamType === "junior" && "Only parents with child players can be added"}
              {teamType === "senior" && "Only adult players can be added (no parents/kids)"}
              {teamType === "mixed" && "All member types can be added"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="levelAge" className="text-base">Level / Age Group</Label>
            <LevelAgeCombobox
              value={levelAge}
              onChange={setLevelAge}
              teamType={teamType}
            />

          </div>

          <div className="space-y-2">
            <Label htmlFor="description" className="text-base">Description</Label>
            <Textarea
              id="description"
              placeholder="Optional team description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={4}
              className="text-base resize-none"
            />
          </div>


          {/* Folder Selection */}
          {folders.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="folder" className="text-base">{(team?.clubs as any)?.class_mode_enabled ? "Class Folder" : "Team Folder"}</Label>
              <Select
                value={folderId || "none"}
                onValueChange={(value) => setFolderId(value === "none" ? null : value)}
              >
                <SelectTrigger className="h-12 text-base">
                  <SelectValue placeholder="Select a folder (optional)" />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="none">No folder</SelectItem>
                  {folders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Organize this team into a folder (e.g., Junior Teams, Senior Teams)
              </p>
            </div>
          )}

          {/* Active Toggle (Class Mode) */}
          {(team?.clubs as any)?.class_mode_enabled && (
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="space-y-0.5">
                <Label className="text-base">Active</Label>
                <p className="text-sm text-muted-foreground">
                  Inactive classes are hidden from the enrolment page
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          )}

          {/* Auto RSVP DM Reminders */}
          <div className="pt-2 border-t space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-base">Auto RSVP reminders</Label>
                <p className="text-sm text-muted-foreground">
                  When on, the club bot DMs members who haven't responded. Off by default.
                </p>
              </div>
              <Switch checked={autoRsvpDm} onCheckedChange={setAutoRsvpDm} />
            </div>


            {autoRsvpDm && (
              <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-3">
                <div className="space-y-2">
                  <Label className="text-sm">When to send</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { v: "t72", label: "3 days before" },
                      { v: "t24", label: "1 day before" },
                      { v: "t3", label: "3h before" },
                    ].map((opt) => {
                      const active = autoRsvpCadences.includes(opt.v);
                      return (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() =>
                            setAutoRsvpCadences((prev) =>
                              active ? prev.filter((c) => c !== opt.v) : [...prev, opt.v]
                            )
                          }
                          className={`p-2 rounded-lg text-xs font-medium border-2 transition-all ${
                            active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {autoRsvpCadences.length === 0 && (
                    <p className="text-xs text-destructive">Pick at least one time, or nothing will be sent.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Send for</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { v: "match", label: "Matches" },
                      { v: "training", label: "Training" },
                    ].map((opt) => {
                      const active = autoRsvpEventTypes.includes(opt.v);
                      return (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() =>
                            setAutoRsvpEventTypes((prev) =>
                              active ? prev.filter((c) => c !== opt.v && c !== "game") :
                                opt.v === "match" ? [...prev, "match", "game"] : [...prev, opt.v]
                            )
                          }
                          className={`p-2 rounded-lg text-xs font-medium border-2 transition-all ${
                            active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {autoRsvpEventTypes.length === 0 && (
                    <p className="text-xs text-destructive">Pick at least one event type.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Default RSVP audience */}
          <div className="pt-4 border-t space-y-1">
            <RsvpAudienceSelect
              value={defaultRsvpAudience}
              onChange={(v) => setDefaultRsvpAudience(v ?? DEFAULT_TEAM_RSVP_AUDIENCE)}
            />
            <p className="text-xs text-muted-foreground">
              Default audience prompted to RSVP for this team's events. Individual events can override this.
            </p>
          </div>




          {(team?.clubs as any)?.class_mode_enabled && (
            <ClassFieldsSection
              classDay={classDay}
              setClassDay={setClassDay}
              classTime={classTime}
              setClassTime={setClassTime}
              classDuration={classDuration}
              setClassDuration={setClassDuration}
              classCapacity={classCapacity}
              setClassCapacity={setClassCapacity}
            />
          )}
        </CardContent>
      </Card>

      {id && <TeamTrainingPausesCard teamId={id} />}

      {/* Submit Button */}
      <Button
        className="w-full h-12 text-base font-medium"
        onClick={handleSubmit}
        disabled={saving || !name.trim()}
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save Changes"}
      </Button>
    </div>
  );
}
