import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, User, Camera, Trash2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ISO_COUNTRY_CODES, countryName } from "@/lib/countries";
import { setProfileCountry } from "@/live/userCountry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { updateProfileCache } from "@/lib/profileCache";
import { Capacitor } from "@capacitor/core";
import { pickNativePhoto, shouldUseNativePicker } from "@/lib/nativePhotoPicker";
import { isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import { mimeToExtension } from "@/lib/binaryUtils";
import { compressImage } from "@/lib/imageCompression";

export default function EditProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const useIcpLab = isFeatureRoutedToIcp("membership");
  const isIcpLive = resolveAuthBackend() === "icp";
  const navigate = useNavigate();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [leaderboardOptOut, setLeaderboardOptOut] = useState(false);
  const [country, setCountry] = useState<string>("");

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || "");
      setAvatarUrl(profile.avatar_url || "");
      setLeaderboardOptOut(((profile as any).leaderboard_opt_out as boolean) ?? false);
      setCountry(((profile as any).country as string | null) ?? "");
    }
  }, [profile]);

  const isNative = shouldUseNativePicker();

  // ICP: save the new photo to the profile straight away (no need to tap
  // Save) and show it instantly from the local copy instead of waiting for
  // a download + decrypt.
  const persistIcpAvatar = async (url: string, localFile: Blob) => {
    const { localUploadPreviews } = await import("@/components/media/localUploadPreviews");
    localUploadPreviews.set(url, URL.createObjectURL(localFile));
    setAvatarUrl(url);
    if (!isIcpLive) return;
    const [{ getCurrentInternetIdentity }, { saveIcpIdentityProfile }] = await Promise.all([
      import("@/live/internetIdentityAuth"),
      import("@/live/identityProfile"),
    ]);
    const identity = await getCurrentInternetIdentity();
    if (!identity) throw new Error("You need to sign in again.");
    await saveIcpIdentityProfile(identity, user!.id, {
      displayName: (displayName.trim() || profile?.display_name || "").trim(),
      avatarRef: url,
    });
    void refreshProfile();
  };

  const handleNativeAvatarPick = async () => {
    if (!user) return;
    // CRITICAL: Do NOT set uploading state before Camera.getPhoto —
    // the re-render breaks the iOS gesture chain and the picker flashes/fails.
    try {
      const result = await pickNativePhoto({ quality: 80 });

      // NOW safe to set state — native picker has closed
      setUploadingAvatar(true);

      // Resize on-device so any camera photo fits the upload budget.
      let uploadBlob: Blob = result.blob;
      try {
        const asFile = new File([result.blob], `avatar.${mimeToExtension(result.mimeType) || "jpg"}`, { type: result.mimeType });
        const compressed = await compressImage(asFile);
        if (compressed.file.size < uploadBlob.size) uploadBlob = compressed.file;
      } catch {
        // keep original if compression fails
      }

      if (uploadBlob.size > 2 * 1024 * 1024) {
        toast({ title: "File too large", description: "Please select a smaller image", variant: "destructive" });
        setUploadingAvatar(false);
        return;
      }

      setAvatarPreview(URL.createObjectURL(uploadBlob));
      const ext = mimeToExtension(uploadBlob.type || result.mimeType) || "jpg";
      if (useIcpLab) {
        // ICP mode: encrypt + store on the blob-store canister, keep the
        // on-chain URL as the avatar reference.
        const { uploadIcpAvatar } = await import("@/live/avatarUpload");
        const url = await uploadIcpAvatar({ file: uploadBlob, mime: uploadBlob.type || result.mimeType, ext });
        await persistIcpAvatar(url, uploadBlob);
        toast({ title: "Photo saved!" });
      } else {
        const fileName = `${user.id}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(fileName, uploadBlob, { upsert: true, contentType: uploadBlob.type || result.mimeType });
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(fileName);
        setAvatarUrl(publicUrlData.publicUrl);
        toast({ title: "Photo uploaded!" });
      }
    } catch (error: any) {
      if (isCancelledSelectionError(error)) {
        // User cancelled picker - do nothing
      } else {
        setAvatarPreview("");
        toast({ title: "Upload failed", description: error instanceof Error ? error.message : "Could not upload photo", variant: "destructive" });
      }
    }
    setUploadingAvatar(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    // Resize on-device so any photo (even a 5MB camera shot) fits the budget.
    let uploadFile: File = file;
    try {
      const compressed = await compressImage(file);
      if (compressed.file.size < uploadFile.size) uploadFile = compressed.file;
    } catch {
      // keep original if compression fails
    }

    if (uploadFile.size > 2 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please select a smaller image",
        variant: "destructive",
      });
      return;
    }
    setAvatarPreview(URL.createObjectURL(uploadFile));

    setUploadingAvatar(true);

    if (useIcpLab) {
      // ICP mode: encrypt + store on the blob-store canister, keep the
      // on-chain URL as the avatar reference.
      try {
        const { uploadIcpAvatar } = await import("@/live/avatarUpload");
        const url = await uploadIcpAvatar({
          file: uploadFile,
          mime: uploadFile.type || "image/jpeg",
          ext: uploadFile.type === "image/jpeg" ? "jpg" : (uploadFile.name.split('.').pop() || "jpg"),
        });
        await persistIcpAvatar(url, uploadFile);
        toast({ title: "Photo saved!" });
      } catch (error) {
        setAvatarPreview("");
        toast({
          title: "Upload failed",
          description: error instanceof Error ? error.message : "Could not upload photo",
          variant: "destructive",
        });
      }
      setUploadingAvatar(false);
      return;
    }

    try {
      const fileExt = uploadFile.type === "image/jpeg" ? "jpg" : (uploadFile.name.split('.').pop() || "jpg");
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, uploadFile, { upsert: true, contentType: uploadFile.type || undefined });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);
      
      const storageUrl = publicUrlData.publicUrl;
      setAvatarUrl(storageUrl);
      toast({ title: "Photo uploaded!" });
    } catch (error) {
      setAvatarPreview("");
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

    if (useIcpLab && !isIcpLive) {
      setSaving(false);
      toast({ title: "Profile changes are local to this lab session" });
      navigate(-1);
      return;
    }

    if (isIcpLive) {
      try {
        const [{ getCurrentInternetIdentity }, { saveIcpIdentityProfile }] = await Promise.all([
          import("@/live/internetIdentityAuth"),
          import("@/live/identityProfile"),
        ]);
        const identity = await getCurrentInternetIdentity();
        if (!identity) throw new Error("You need to sign in again.");
        await saveIcpIdentityProfile(identity, user!.id, {
          displayName: displayName.trim(),
          avatarRef: avatarUrl.trim() || null,
        });
        // Mirror the display name into pii_access_control (pii_id = caller
        // principal text, field_id = "display_name", owner = the user).
        // Best effort — the profile save above already succeeded.
        const [{ getActiveIcpTarget }, { registerLivePiiText }] = await Promise.all([
          import("@/live/targetRegistry"),
          import("@/live/features/vault"),
        ]);
        await registerLivePiiText(
          { identity, target: getActiveIcpTarget() },
          identity.getPrincipal().toText(),
          "display_name",
          displayName.trim(),
        );
        // Re-sync avatar club grants — covers clubs joined after the photo
        // was uploaded. Best-effort (never throws).
        const { syncLiveAvatarClubGrants } = await import("@/live/avatarUpload");
        await syncLiveAvatarClubGrants({ identity, target: getActiveIcpTarget() });
      } catch (error) {
        setSaving(false);
        toast({
          title: "Failed to update profile",
          description: error instanceof Error ? error.message : "Could not update profile",
          variant: "destructive",
        });
        return;
      }

      setSaving(false);
      await refreshProfile();
      toast({ title: "Profile updated!" });
      navigate("/profile");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        avatar_url: avatarUrl.trim() || null,
        leaderboard_opt_out: leaderboardOptOut,
        country: country || null,
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

    setProfileCountry(country || null);
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
              <AvatarImage src={avatarPreview || avatarUrl || undefined} />
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
              JPG, PNG, or GIF. Large photos are resized automatically.
            </p>
          </div>

          {/* Email (read-only) — hidden in ICP mode, where no email is collected
              and user.email holds the Internet Identity principal */}
          {!isIcpLive && (
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={user?.email || ""} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed
              </p>
            </div>
          )}

          {/* Country */}
          {!isIcpLive && (
            <div className="space-y-2">
              <Label htmlFor="country">Country</Label>
              <Select value={country || "unset"} onValueChange={(v) => setCountry(v === "unset" ? "" : v)}>
                <SelectTrigger id="country">
                  <SelectValue placeholder="Not set" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not set</SelectItem>
                  {ISO_COUNTRY_CODES.map(code => (
                    <SelectItem key={code} value={code}>{countryName(code)} ({code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used to decide which backend serves app features for you. If not set, your
                country is estimated from your internet connection.
              </p>
            </div>
          )}

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
