import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Camera, Loader2, UserPlus } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { SPORT_EMOJIS, getSportEmoji, isClassModeSport, isTeamOnlySport } from "@/lib/sportEmojis";
import { shouldUseNativePicker, pickNativePhoto } from "@/lib/nativePhotoPicker";
import { isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import { mimeToExtension } from "@/lib/binaryUtils";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClubDetail } from "@/lab/fixtureDataLayer";


const SPORTS = Object.keys(SPORT_EMOJIS);

export default function EditClubPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [sport, setSport] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [classModeEnabled, setClassModeEnabled] = useState(false);
  const [allowGuestsDefault, setAllowGuestsDefault] = useState(false);
  const [maxGuestsDefault, setMaxGuestsDefault] = useState(2);
  const [eventsSponsorStripEnabled, setEventsSponsorStripEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const EVENTS_STRIP_PILOT_CLUB_ID = "36231b76-5313-478e-b8d5-23ac4f5e8b10"; // Riverside FC
  const showEventsStripToggle = id === EVENTS_STRIP_PILOT_CLUB_ID;

  const { data: club, isLoading } = useQuery({
    queryKey: ["club", id, useIcpLab],
    queryFn: async () => {
      if (useIcpLab) {
        const localClub = getLocalLabClubDetail(id!);
        return localClub ? {
          ...localClub,
          description: "Synthetic lab club detail",
          contact_email: null,
          class_mode_enabled: false,
          allow_guests_default: false,
          max_guests_per_member_default: 2,
          events_sponsor_strip_enabled: false,
          club_subscriptions: null,
        } : null;
      }
      const { data, error } = await supabase
        .from("clubs")
        .select(`
          *,
          club_subscriptions(is_pro, is_pro_football, expires_at)
        `)
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  useEffect(() => {
    if (club) {
      setName(club.name || "");
      setDescription(club.description || "");
      setLogoUrl(club.logo_url || "");
      setSport(club.sport || "");
      setContactEmail(club.contact_email || "");
      setClassModeEnabled(club.class_mode_enabled || false);
      setAllowGuestsDefault(club.allow_guests_default || false);
      setMaxGuestsDefault(club.max_guests_per_member_default || 2);
      setEventsSponsorStripEnabled((club as any).events_sponsor_strip_enabled || false);
    }
  }, [club]);

  const [uploading, setUploading] = useState(false);
  const isNative = shouldUseNativePicker();

  const handleNativeLogoPick = async () => {
    if (!id) return;
    if (useIcpLab) {
      toast({
        title: "Logo uploads are unavailable in ICP lab mode",
        description: "No club data has been changed.",
      });
      return;
    }
    try {
      const result = await pickNativePhoto({ quality: 80 });
      setUploading(true);

      const ext = mimeToExtension(result.mimeType);
      const fileName = `${id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('club-logos')
        .upload(fileName, result.blob, { upsert: true, contentType: result.mimeType });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('club-logos').getPublicUrl(fileName);
      setLogoUrl(urlData.publicUrl);
      toast({ title: "Logo uploaded", description: "Your club logo has been uploaded successfully." });
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
    if (!file || !id) return;
    if (useIcpLab) {
      toast({
        title: "Logo uploads are unavailable in ICP lab mode",
        description: "No club data has been changed.",
      });
      e.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${id}/${Date.now()}.${fileExt}`;

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
        description: "Your club logo has been uploaded successfully.",
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
        description: "Please enter a club name.",
        variant: "destructive",
      });
      return;
    }

    if (useIcpLab) {
      toast({
        title: "Club editing is unavailable in ICP lab mode",
        description: "Your preview changes were not persisted.",
      });
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("clubs")
      .update({
        name: name.trim(),
        description: description.trim() || null,
        logo_url: logoUrl || null,
        sport: sport || null,
        contact_email: contactEmail.trim() || null,
        class_mode_enabled: classModeEnabled,
        allow_guests_default: allowGuestsDefault,
        max_guests_per_member_default: maxGuestsDefault,
        ...(showEventsStripToggle ? { events_sponsor_strip_enabled: eventsSponsorStripEnabled } : {}),
      } as any)
      .eq("id", id!);

    setSaving(false);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to update club. Please try again.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Club updated!",
      description: `${name} has been updated successfully.`,
    });

    navigate(`/clubs/${id}`);
  };

  if (isLoading) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!club) {
    return (
      <div className="py-6 text-center">
        <p className="text-muted-foreground">Club not found</p>
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
        <h1 className="text-xl font-bold">Edit {club?.class_mode_enabled ? "Organisation" : "Club"}</h1>
      </div>

      {useIcpLab && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground">
          Preview only: club settings and media changes are not persisted in ICP lab mode.
        </div>
      )}

      {/* Logo Upload Section */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Avatar className="h-28 w-28 border-4 border-primary/20">
                <AvatarImage src={logoUrl || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-3xl">
                  {name.charAt(0)?.toUpperCase() || "C"}
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
            <p className="text-sm text-muted-foreground">Tap to change club logo</p>
          </div>
        </CardContent>
      </Card>

      {/* Club Details */}
      <Card>
        <CardContent className="py-6 space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-base">Club Name *</Label>
            <Input
              id="name"
              placeholder="Enter club name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="h-12 text-base"
            />
          </div>

          {/* Sport */}
          <div className="space-y-2">
            <Label className="text-base">Sport</Label>
            <Select value={sport} onValueChange={(val) => {
              setSport(val);
              // Auto-toggle class mode when switching to/from a class-default sport
              if (isClassModeSport(val) && !classModeEnabled) {
                setClassModeEnabled(true);
              } else if (isTeamOnlySport(val) && classModeEnabled) {
                setClassModeEnabled(false);
              } else if (!isClassModeSport(val) && classModeEnabled && isClassModeSport(sport)) {
                // Only auto-disable if previous sport was class-default (user didn't manually enable)
                setClassModeEnabled(false);
              }
            }}>
              <SelectTrigger className="w-full h-12 text-base">
                <SelectValue placeholder="Select a sport">
                  {sport && (
                    <span className="flex items-center gap-2">
                      <span>{getSportEmoji(sport)}</span>
                      <span>{sport}</span>
                    </span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[40vh]" position="popper" sideOffset={4}>
                {SPORTS.map((s) => (
                  <SelectItem key={s} value={s} className="py-3 text-base">
                    <span className="flex items-center gap-2">
                      <span>{getSportEmoji(s)}</span>
                      <span>{s}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Class Mode - hidden for traditional team sports */}
          {!isTeamOnlySport(sport) && (
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Class Mode</Label>
              <p className="text-sm text-muted-foreground">Enable for academies & schools (swimming, dance, etc.)</p>
            </div>
            <Switch checked={classModeEnabled} onCheckedChange={setClassModeEnabled} />
          </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-base">Description</Label>
            <Textarea
              id="description"
              placeholder="Tell us about your club..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={4}
              className="text-base resize-none"
            />
          </div>

          {/* Contact Email */}
          <div className="space-y-2">
            <Label htmlFor="contact-email" className="text-base">Contact Email</Label>
            <Input
              id="contact-email"
              type="email"
              placeholder="redacted@example.invalid"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              maxLength={200}
              className="h-12 text-base"
            />
            <p className="text-sm text-muted-foreground">Used as the reply-to address on emails sent to members</p>
          </div>

          {/* Guest Settings */}
          <div className="space-y-3 pt-2 border-t">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Allow Guests at Social Events
                </Label>
                <p className="text-sm text-muted-foreground">Default setting for new social events</p>
              </div>
              <Switch checked={allowGuestsDefault} onCheckedChange={setAllowGuestsDefault} />
            </div>
            {allowGuestsDefault && (
              <div className="space-y-2 pl-6">
                <Label htmlFor="max-guests-default" className="text-sm">Default max guests per member</Label>
                <Input
                  id="max-guests-default"
                  type="number"
                  min={1}
                  max={20}
                  value={maxGuestsDefault}
                  onChange={(e) => setMaxGuestsDefault(parseInt(e.target.value) || 1)}
                  className="w-24 h-12"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Events sponsor strip toggle moved to ClubDetailPage → Sponsors accordion */}





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
