import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, User, Camera, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { updateProfileCache } from "@/lib/profileCache";
import { Capacitor } from "@capacitor/core";
import { pickNativePhoto, shouldUseNativePicker } from "@/lib/nativePhotoPicker";
import { isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import { mimeToExtension } from "@/lib/binaryUtils";

export default function EditProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaderboardOptOut, setLeaderboardOptOut] = useState(false);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || "");
      setAvatarUrl(profile.avatar_url || "");
      setLeaderboardOptOut(((profile as any).leaderboard_opt_out as boolean) ?? false);
    }
  }, [profile]);

  const isNative = shouldUseNativePicker();

  const handleNativeAvatarPick = async () => {
    if (!user) return;
    if (useIcpLab) {
      toast({ title: "Profile photo upload is disabled in ICP lab mode" });
      return;
    }
    // CRITICAL: Do NOT set uploading state before Camera.getPhoto —
    // the re-render breaks the iOS gesture chain and the picker flashes/fails.
    try {
      const result = await pickNativePhoto({ quality: 80 });

      // NOW safe to set state — native picker has closed
      setUploadingAvatar(true);

      if (result.blob.size > 2 * 1024 * 1024) {
        toast({ title: "File too large", description: "Please select an image under 2MB", variant: "destructive" });
        setUploadingAvatar(false);
        return;
      }

      const ext = mimeToExtension(result.mimeType);
      const fileName = `${user.id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(fileName, result.blob, { upsert: true, contentType: result.mimeType });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(fileName);
      setAvatarUrl(publicUrlData.publicUrl);
      toast({ title: "Photo uploaded!" });
    } catch (error: any) {
      if (isCancelledSelectionError(error)) {
        // User cancelled picker - do nothing
      } else {
        toast({ title: "Upload failed", description: error instanceof Error ? error.message : "Could not upload photo", variant: "destructive" });
      }
    }
    setUploadingAvatar(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (useIcpLab) {
      toast({ title: "Profile photo upload is disabled in ICP lab mode" });
      return;
    }

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select an image under 2MB",
        variant: "destructive",
      });
      return;
    }

    setUploadingAvatar(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);
      
      const storageUrl = publicUrlData.publicUrl;
      setAvatarUrl(storageUrl);
      toast({ title: "Photo uploaded!" });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Could not upload photo",
        variant: "destructive",
      });
    }

    setUploadingAvatar(false);
  };

  const handleSave = async () => {
    if (!displayName.trim()) {
      toast({
        title: "Display name required",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);

    if (useIcpLab) {
      setSaving(false);
      toast({ title: "Profile changes are local to this lab session" });
      navigate(-1);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        avatar_url: avatarUrl.trim() || null,
        leaderboard_opt_out: leaderboardOptOut,
      } as any)
      .eq("id", user!.id);

    setSaving(false);

    if (error) {
      toast({
        title: "Failed to update profile",
        description: error.message,
        variant: "destructive",
      });
      return;
    }

    updateProfileCache({
      id: user!.id,
      display_name: displayName.trim(),
      avatar_url: avatarUrl.trim() || null,
    });

    await refreshProfile();
    toast({ title: "Profile updated!" });
    navigate("/profile");
  };

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Edit Profile</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar Preview */}
          <div className="flex flex-col items-center gap-4">
            <Avatar className="h-24 w-24 border-4 border-primary/20">
              <AvatarImage src={avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/20 text-primary text-3xl">
                {displayName.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
          </div>

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name *</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name"
              maxLength={50}
            />
          </div>

          {/* Avatar Upload */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Camera className="h-4 w-4" />
              Profile Photo
            </Label>
            <div className="flex items-center gap-3">
              {!isNative && (
                <input
                  type="file"
                  id="avatar-upload"
                  accept="image/*"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
              )}
              <Button
                type="button"
                variant="outline"
                onClick={isNative ? handleNativeAvatarPick : () => document.getElementById('avatar-upload')?.click()}
                disabled={uploadingAvatar}
                className="flex-1"
              >
                {uploadingAvatar ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 mr-2" />
                    {avatarUrl ? "Change Photo" : "Upload Photo"}
                  </>
                )}
              </Button>
              {avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setAvatarUrl("")}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Max 2MB. JPG, PNG, or GIF.
            </p>
          </div>

          {/* Email (read-only) */}
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user?.email || ""} disabled className="bg-muted" />
            <p className="text-xs text-muted-foreground">
              Email cannot be changed
            </p>
          </div>

          {/* Leaderboard privacy */}
          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="flex-1 min-w-0">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <Trophy className="h-4 w-4" />
                Hide me from the leaderboard
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                You'll still see your own rank, but other members won't see you on club or team ladders.
              </p>
            </div>
            <Switch checked={leaderboardOptOut} onCheckedChange={setLeaderboardOptOut} />
          </div>

          <Button
            className="w-full"
            onClick={handleSave}
            disabled={saving || !displayName.trim()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
