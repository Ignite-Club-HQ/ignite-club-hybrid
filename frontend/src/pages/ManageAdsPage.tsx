import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Plus, Trash2, ExternalLink, BarChart3, Eye, MousePointer, Settings, ArrowLeft, Pencil, Upload, Loader2 } from "lucide-react";
import { subDays } from "date-fns";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

type AdType = "image" | "logo_text";

interface AppAd {
  id: string;
  name: string;
  image_url: string | null;
  link_url: string | null;
  description: string | null;
  is_active: boolean;
  display_order: number;
  ad_type: AdType;
  logo_url: string | null;
  headline: string | null;
  subtext: string | null;
  cta_label: string | null;
  bg_color: string | null;
  text_color: string | null;
}

interface AdSetting {
  id: string;
  location: string;
  is_enabled: boolean;
  override_sponsors: boolean;
  show_only_when_no_sponsors: boolean;
}

const EMPTY_NEW_AD = {
  name: "",
  ad_type: "image" as AdType,
  image_url: "",
  logo_url: "",
  headline: "",
  subtext: "",
  cta_label: "",
  bg_color: "",
  text_color: "",
  link_url: "",
  description: "",
};

async function uploadAdImage(file: File): Promise<string> {
  const fileExt = file.name.split(".").pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
  const filePath = `ads/${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from("app-ads")
    .upload(filePath, file, { cacheControl: "31536000" });
  if (uploadError) throw uploadError;
  const { data: { publicUrl } } = supabase.storage.from("app-ads").getPublicUrl(filePath);
  return publicUrl;
}

// Live preview of a logo+text ad, shown in the drawers
function LogoTextPreview({
  logoUrl,
  headline,
  subtext,
  ctaLabel,
  bgColor,
  textColor,
  name,
}: {
  logoUrl: string;
  headline: string;
  subtext: string;
  ctaLabel: string;
  bgColor: string;
  textColor: string;
  name: string;
}) {
  return (
    <div
      className="w-full h-28 rounded-lg overflow-hidden flex items-center gap-3 px-4 border"
      style={{
        backgroundColor: bgColor || "hsl(var(--card))",
        color: textColor || "hsl(var(--card-foreground))",
      }}
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" className="h-16 w-16 rounded-md object-contain bg-white/10 shrink-0" />
      ) : (
        <div className="h-16 w-16 rounded-md bg-white/10 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-base leading-tight truncate">{headline || name || "Headline"}</div>
        {subtext && <div className="text-sm opacity-80 line-clamp-2 mt-0.5">{subtext}</div>}
      </div>
      {ctaLabel && (
        <span className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full bg-white/20">{ctaLabel}</span>
      )}
    </div>
  );
}

export default function ManageAdsPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-3xl mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <BarChart3 className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Advertising management is unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Ad configuration, media uploads, targeting, and analytics remain an external provider boundary.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseManageAdsPage />;
}

function SupabaseManageAdsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<AppAd | null>(null);
  const [newAd, setNewAd] = useState({ ...EMPTY_NEW_AD });

  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isEditUploadingImage, setIsEditUploadingImage] = useState(false);
  const [isEditUploadingLogo, setIsEditUploadingLogo] = useState(false);

  const newImageRef = useRef<HTMLInputElement>(null);
  const newLogoRef = useRef<HTMLInputElement>(null);
  const editImageRef = useRef<HTMLInputElement>(null);
  const editLogoRef = useRef<HTMLInputElement>(null);

  const handleFile = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setUploading: (v: boolean) => void,
    onUploaded: (url: string) => void,
    resetRef: React.RefObject<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be less than 5MB");
      return;
    }
    setUploading(true);
    try {
      const url = await uploadAdImage(file);
      onUploaded(url);
      toast.success("Image uploaded");
    } catch (err) {
      console.error(err);
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
      if (resetRef.current) resetRef.current.value = "";
    }
  };

  // Check if user is app admin
  const { data: isAppAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  const { data: ads, isLoading: adsLoading } = useQuery({
    queryKey: ["app-ads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ads")
        .select("*")
        .order("display_order", { ascending: true });
      if (error) throw error;
      return data as unknown as AppAd[];
    },
    enabled: isAppAdmin,
  });

  const { data: settings } = useQuery({
    queryKey: ["app-ad-settings-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_ad_settings")
        .select("*")
        .order("location");
      if (error) throw error;
      return data as AdSetting[];
    },
    enabled: isAppAdmin,
  });

  const { data: analytics } = useQuery({
    queryKey: ["app-ad-analytics-summary"],
    queryFn: async () => {
      const thirtyDaysAgo = subDays(new Date(), 30).toISOString();
      const { data, error } = await supabase
        .from("app_ad_analytics")
        .select("ad_id, event_type, context, created_at")
        .gte("created_at", thirtyDaysAgo);
      if (error) throw error;
      return data;
    },
    enabled: isAppAdmin,
  });

  const createAdMutation = useMutation({
    mutationFn: async (ad: typeof newAd) => {
      const payload: Record<string, unknown> = {
        name: ad.name,
        ad_type: ad.ad_type,
        link_url: ad.link_url || null,
        description: ad.description || null,
      };
      if (ad.ad_type === "image") {
        payload.image_url = ad.image_url;
        payload.logo_url = null;
        payload.headline = null;
        payload.subtext = null;
        payload.cta_label = null;
        payload.bg_color = null;
        payload.text_color = null;
      } else {
        payload.image_url = null;
        payload.logo_url = ad.logo_url || null;
        payload.headline = ad.headline;
        payload.subtext = ad.subtext || null;
        payload.cta_label = ad.cta_label || null;
        payload.bg_color = ad.bg_color || null;
        payload.text_color = ad.text_color || null;
      }
      const { error } = await supabase.from("app_ads").insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ads"] });
      setIsDrawerOpen(false);
      setNewAd({ ...EMPTY_NEW_AD });
      toast.success("Ad created successfully");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to create ad"),
  });

  const toggleAdMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("app_ads").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ads"] });
      toast.success("Ad updated");
    },
  });

  const updateAdMutation = useMutation({
    mutationFn: async (ad: AppAd) => {
      const payload: Record<string, unknown> = {
        name: ad.name,
        ad_type: ad.ad_type,
        link_url: ad.link_url || null,
        description: ad.description || null,
      };
      if (ad.ad_type === "image") {
        payload.image_url = ad.image_url;
        payload.logo_url = null;
        payload.headline = null;
        payload.subtext = null;
        payload.cta_label = null;
        payload.bg_color = null;
        payload.text_color = null;
      } else {
        payload.image_url = null;
        payload.logo_url = ad.logo_url || null;
        payload.headline = ad.headline;
        payload.subtext = ad.subtext || null;
        payload.cta_label = ad.cta_label || null;
        payload.bg_color = ad.bg_color || null;
        payload.text_color = ad.text_color || null;
      }
      const { error } = await supabase.from("app_ads").update(payload as never).eq("id", ad.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ads"] });
      setEditingAd(null);
      toast.success("Ad updated successfully");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to update ad"),
  });

  const deleteAdMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("app_ads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ads"] });
      toast.success("Ad deleted");
    },
  });

  const updateSettingMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: string; field: string; value: boolean }) => {
      const { error } = await supabase.from("app_ad_settings").update({ [field]: value } as never).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-ad-settings-all"] });
      queryClient.invalidateQueries({ queryKey: ["app-ad-settings"] });
      toast.success("Settings updated");
    },
  });

  const getAdStats = (adId: string) => {
    if (!analytics) return { views: 0, clicks: 0 };
    const adEvents = analytics.filter(a => a.ad_id === adId);
    return {
      views: adEvents.filter(e => e.event_type === "view").length,
      clicks: adEvents.filter(e => e.event_type === "click").length,
    };
  };

  const getContextStats = (context: string) => {
    if (!analytics) return { views: 0, clicks: 0 };
    const contextEvents = analytics.filter(a => a.context === context);
    return {
      views: contextEvents.filter(e => e.event_type === "view").length,
      clicks: contextEvents.filter(e => e.event_type === "click").length,
    };
  };

  if (!isAppAdmin) {
    return (
      <div className="py-6">
        <div className="p-4 text-center text-muted-foreground">
          You don't have permission to access this page.
        </div>
      </div>
    );
  }

  const locationLabels: Record<string, string> = {
    home: "Home Page",
    events: "Events Page (list)",
    "event-detail": "Event Detail Page",
    messages: "Messages Page",
    "chat-thread": "Chat Threads (inside conversations)",
    "media-header": "Media Page (top strip)",
  };

  const newAdSaveDisabled =
    !newAd.name ||
    (newAd.ad_type === "image" && !newAd.image_url) ||
    (newAd.ad_type === "logo_text" && !newAd.headline) ||
    createAdMutation.isPending;

  const editSaveDisabled =
    !editingAd?.name ||
    (editingAd?.ad_type === "image" && !editingAd?.image_url) ||
    (editingAd?.ad_type === "logo_text" && !editingAd?.headline) ||
    updateAdMutation.isPending;

  return (
    <div className="py-6 space-y-6 pb-24">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Manage Ads</h1>
      </div>

      <Tabs defaultValue="ads">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="ads">Ads</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="ads" className="space-y-4 mt-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Advertisements</h2>
            <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
              <DrawerTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Ad
                </Button>
              </DrawerTrigger>
              <DrawerContent>
                <div className="mx-auto w-full max-w-lg">
                  <DrawerHeader>
                    <DrawerTitle>Create New Ad</DrawerTitle>
                    <DrawerDescription>Add a new app-level advertisement</DrawerDescription>
                  </DrawerHeader>
                  <div className="px-4 space-y-4 max-h-[65vh] overflow-y-auto">
                    {/* Ad format tabs */}
                    <Tabs
                      value={newAd.ad_type}
                      onValueChange={(v) => setNewAd({ ...newAd, ad_type: v as AdType })}
                    >
                      <TabsList className="grid grid-cols-2 w-full">
                        <TabsTrigger value="image">Upload Image</TabsTrigger>
                        <TabsTrigger value="logo_text">Logo + Text</TabsTrigger>
                      </TabsList>

                      {/* IMAGE FORMAT */}
                      <TabsContent value="image" className="space-y-4 mt-4">
                        {newAd.image_url && (
                          <div className="relative w-full aspect-[3/1] rounded-lg overflow-hidden bg-muted border">
                            <img src={newAd.image_url} alt="" className="w-full h-full object-cover" />
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label>Ad Image *</Label>
                          <div className="flex gap-2">
                            <Input
                              value={newAd.image_url}
                              onChange={(e) => setNewAd({ ...newAd, image_url: e.target.value })}
                              placeholder="https://reference.invalid"
                              className="h-11 flex-1"
                            />
                            <input
                              type="file"
                              ref={newImageRef}
                              accept="image/*"
                              onChange={(e) => handleFile(e, setIsUploadingImage, (url) => setNewAd((p) => ({ ...p, image_url: url })), newImageRef)}
                              className="hidden"
                            />
                            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0"
                              onClick={() => newImageRef.current?.click()} disabled={isUploadingImage}>
                              {isUploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">Recommended size: 1200x400px (3:1 ratio)</p>
                        </div>
                      </TabsContent>

                      {/* LOGO + TEXT FORMAT */}
                      <TabsContent value="logo_text" className="space-y-4 mt-4">
                        <LogoTextPreview
                          logoUrl={newAd.logo_url}
                          headline={newAd.headline}
                          subtext={newAd.subtext}
                          ctaLabel={newAd.cta_label}
                          bgColor={newAd.bg_color}
                          textColor={newAd.text_color}
                          name={newAd.name}
                        />
                        <div className="space-y-2">
                          <Label>Logo</Label>
                          <div className="flex gap-2">
                            <Input
                              value={newAd.logo_url}
                              onChange={(e) => setNewAd({ ...newAd, logo_url: e.target.value })}
                              placeholder="https://reference.invalid"
                              className="h-11 flex-1"
                            />
                            <input
                              type="file"
                              ref={newLogoRef}
                              accept="image/*"
                              onChange={(e) => handleFile(e, setIsUploadingLogo, (url) => setNewAd((p) => ({ ...p, logo_url: url })), newLogoRef)}
                              className="hidden"
                            />
                            <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0"
                              onClick={() => newLogoRef.current?.click()} disabled={isUploadingLogo}>
                              {isUploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">Square logo works best (e.g. 256×256)</p>
                        </div>
                        <div className="space-y-2">
                          <Label>Headline *</Label>
                          <Input
                            value={newAd.headline}
                            onChange={(e) => setNewAd({ ...newAd, headline: e.target.value })}
                            placeholder="e.g. 20% off all kit"
                            className="h-11"
                            maxLength={60}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Subtext</Label>
                          <Textarea
                            value={newAd.subtext}
                            onChange={(e) => setNewAd({ ...newAd, subtext: e.target.value })}
                            placeholder="Short tagline (optional)"
                            rows={2}
                            maxLength={120}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Call-to-action label</Label>
                          <Input
                            value={newAd.cta_label}
                            onChange={(e) => setNewAd({ ...newAd, cta_label: e.target.value })}
                            placeholder="e.g. Shop now"
                            className="h-11"
                            maxLength={20}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label>Background</Label>
                            <Input type="color" value={newAd.bg_color || "#0f172a"}
                              onChange={(e) => setNewAd({ ...newAd, bg_color: e.target.value })}
                              className="h-11 p-1" />
                          </div>
                          <div className="space-y-2">
                            <Label>Text color</Label>
                            <Input type="color" value={newAd.text_color || "#ffffff"}
                              onChange={(e) => setNewAd({ ...newAd, text_color: e.target.value })}
                              className="h-11 p-1" />
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>

                    {/* Shared fields */}
                    <div className="space-y-2 pt-2 border-t">
                      <Label>Ad Name * (internal)</Label>
                      <Input
                        value={newAd.name}
                        onChange={(e) => setNewAd({ ...newAd, name: e.target.value })}
                        placeholder="Enter a name for this ad"
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Link URL</Label>
                      <Input
                        value={newAd.link_url}
                        onChange={(e) => setNewAd({ ...newAd, link_url: e.target.value })}
                        placeholder="https://reference.invalid (optional)"
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        value={newAd.description}
                        onChange={(e) => setNewAd({ ...newAd, description: e.target.value })}
                        placeholder="Internal description (optional)"
                        rows={2}
                      />
                    </div>
                  </div>
                  <DrawerFooter>
                    <Button
                      onClick={() => createAdMutation.mutate(newAd)}
                      disabled={newAdSaveDisabled}
                      className="w-full"
                    >
                      {createAdMutation.isPending ? "Creating..." : "Create Ad"}
                    </Button>
                    <DrawerClose asChild>
                      <Button variant="outline" className="w-full">Cancel</Button>
                    </DrawerClose>
                  </DrawerFooter>
                </div>
              </DrawerContent>
            </Drawer>
          </div>

          {adsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : ads && ads.length > 0 ? (
            <div className="space-y-3">
              {ads.map((ad) => {
                const stats = getAdStats(ad.id);
                const thumbSrc = ad.ad_type === "logo_text" ? ad.logo_url : ad.image_url;
                return (
                  <Card key={ad.id}>
                    <CardContent className="p-4">
                      <div className="flex gap-3">
                        <Avatar className="h-16 w-16 rounded-lg">
                          <AvatarImage src={thumbSrc || undefined} className="object-cover" />
                          <AvatarFallback className="rounded-lg">{ad.name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium truncate">{ad.name}</h3>
                            {ad.link_url && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {ad.ad_type === "logo_text" ? "Logo+Text" : "Image"}
                            </span>
                          </div>
                          {ad.ad_type === "logo_text" && ad.headline && (
                            <p className="text-sm text-muted-foreground line-clamp-1">{ad.headline}</p>
                          )}
                          {ad.description && (
                            <p className="text-xs text-muted-foreground line-clamp-1">{ad.description}</p>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{stats.views} views</span>
                            <span className="flex items-center gap-1"><MousePointer className="h-3 w-3" />{stats.clicks} clicks</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Switch
                            checked={ad.is_active}
                            onCheckedChange={(checked) => toggleAdMutation.mutate({ id: ad.id, is_active: checked })}
                          />
                          <Button variant="ghost" size="icon" onClick={() => setEditingAd(ad)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteAdMutation.mutate(ad.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No ads created yet. Click "Add Ad" to create one.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Edit Ad Drawer */}
        <Drawer open={!!editingAd} onOpenChange={(open) => !open && setEditingAd(null)}>
          <DrawerContent>
            <div className="mx-auto w-full max-w-lg">
              <DrawerHeader>
                <DrawerTitle>Edit Ad</DrawerTitle>
                <DrawerDescription>Update advertisement details</DrawerDescription>
              </DrawerHeader>
              {editingAd && (
                <div className="px-4 space-y-4 max-h-[65vh] overflow-y-auto">
                  <Tabs
                    value={editingAd.ad_type}
                    onValueChange={(v) => setEditingAd({ ...editingAd, ad_type: v as AdType })}
                  >
                    <TabsList className="grid grid-cols-2 w-full">
                      <TabsTrigger value="image">Upload Image</TabsTrigger>
                      <TabsTrigger value="logo_text">Logo + Text</TabsTrigger>
                    </TabsList>

                    <TabsContent value="image" className="space-y-4 mt-4">
                      {editingAd.image_url && (
                        <div className="relative w-full aspect-[3/1] rounded-lg overflow-hidden bg-muted border">
                          <img src={editingAd.image_url} alt="" className="w-full h-full object-cover" />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label>Ad Image *</Label>
                        <div className="flex gap-2">
                          <Input
                            value={editingAd.image_url || ""}
                            onChange={(e) => setEditingAd({ ...editingAd, image_url: e.target.value })}
                            placeholder="https://reference.invalid"
                            className="h-11 flex-1"
                          />
                          <input
                            type="file"
                            ref={editImageRef}
                            accept="image/*"
                            onChange={(e) => handleFile(e, setIsEditUploadingImage, (url) => setEditingAd((p) => p ? { ...p, image_url: url } : null), editImageRef)}
                            className="hidden"
                          />
                          <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0"
                            onClick={() => editImageRef.current?.click()} disabled={isEditUploadingImage}>
                            {isEditUploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="logo_text" className="space-y-4 mt-4">
                      <LogoTextPreview
                        logoUrl={editingAd.logo_url || ""}
                        headline={editingAd.headline || ""}
                        subtext={editingAd.subtext || ""}
                        ctaLabel={editingAd.cta_label || ""}
                        bgColor={editingAd.bg_color || ""}
                        textColor={editingAd.text_color || ""}
                        name={editingAd.name}
                      />
                      <div className="space-y-2">
                        <Label>Logo</Label>
                        <div className="flex gap-2">
                          <Input
                            value={editingAd.logo_url || ""}
                            onChange={(e) => setEditingAd({ ...editingAd, logo_url: e.target.value })}
                            placeholder="https://reference.invalid"
                            className="h-11 flex-1"
                          />
                          <input
                            type="file"
                            ref={editLogoRef}
                            accept="image/*"
                            onChange={(e) => handleFile(e, setIsEditUploadingLogo, (url) => setEditingAd((p) => p ? { ...p, logo_url: url } : null), editLogoRef)}
                            className="hidden"
                          />
                          <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0"
                            onClick={() => editLogoRef.current?.click()} disabled={isEditUploadingLogo}>
                            {isEditUploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>Headline *</Label>
                        <Input
                          value={editingAd.headline || ""}
                          onChange={(e) => setEditingAd({ ...editingAd, headline: e.target.value })}
                          className="h-11"
                          maxLength={60}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Subtext</Label>
                        <Textarea
                          value={editingAd.subtext || ""}
                          onChange={(e) => setEditingAd({ ...editingAd, subtext: e.target.value })}
                          rows={2}
                          maxLength={120}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Call-to-action label</Label>
                        <Input
                          value={editingAd.cta_label || ""}
                          onChange={(e) => setEditingAd({ ...editingAd, cta_label: e.target.value })}
                          className="h-11"
                          maxLength={20}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                          <Label>Background</Label>
                          <Input type="color" value={editingAd.bg_color || "#0f172a"}
                            onChange={(e) => setEditingAd({ ...editingAd, bg_color: e.target.value })}
                            className="h-11 p-1" />
                        </div>
                        <div className="space-y-2">
                          <Label>Text color</Label>
                          <Input type="color" value={editingAd.text_color || "#ffffff"}
                            onChange={(e) => setEditingAd({ ...editingAd, text_color: e.target.value })}
                            className="h-11 p-1" />
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>

                  <div className="space-y-2 pt-2 border-t">
                    <Label>Ad Name * (internal)</Label>
                    <Input
                      value={editingAd.name}
                      onChange={(e) => setEditingAd({ ...editingAd, name: e.target.value })}
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Link URL</Label>
                    <Input
                      value={editingAd.link_url || ""}
                      onChange={(e) => setEditingAd({ ...editingAd, link_url: e.target.value })}
                      placeholder="https://reference.invalid (optional)"
                      className="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={editingAd.description || ""}
                      onChange={(e) => setEditingAd({ ...editingAd, description: e.target.value })}
                      rows={2}
                    />
                  </div>
                </div>
              )}
              <DrawerFooter>
                <Button
                  onClick={() => editingAd && updateAdMutation.mutate(editingAd)}
                  disabled={editSaveDisabled}
                  className="w-full"
                >
                  {updateAdMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <DrawerClose asChild>
                  <Button variant="outline" className="w-full">Cancel</Button>
                </DrawerClose>
              </DrawerFooter>
            </div>
          </DrawerContent>
        </Drawer>

        <TabsContent value="settings" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Display Settings
              </CardTitle>
              <CardDescription>Configure where and when ads appear in the app</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {settings?.map((setting) => (
                <div key={setting.id} className="space-y-3 pb-4 border-b last:border-0">
                  <h3 className="font-medium">{locationLabels[setting.location] || setting.location}</h3>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Enable Ads</Label>
                      <p className="text-xs text-muted-foreground">Show ads on this page</p>
                    </div>
                    <Switch
                      checked={setting.is_enabled}
                      onCheckedChange={(checked) =>
                        updateSettingMutation.mutate({ id: setting.id, field: "is_enabled", value: checked })
                      }
                    />
                  </div>
                  {setting.is_enabled && (
                    <>
                      <div className="flex items-center justify-between">
                        <div>
                          <Label>Override Sponsor Ads</Label>
                          <p className="text-xs text-muted-foreground">Always show app ads instead of sponsor ads</p>
                        </div>
                        <Switch
                          checked={setting.override_sponsors}
                          onCheckedChange={(checked) =>
                            updateSettingMutation.mutate({ id: setting.id, field: "override_sponsors", value: checked })
                          }
                        />
                      </div>
                      {!setting.override_sponsors && (
                        <div className="flex items-center justify-between">
                          <div>
                            <Label>Show Only When No Sponsors</Label>
                            <p className="text-xs text-muted-foreground">Only show ads if user has no club sponsors</p>
                          </div>
                          <Switch
                            checked={setting.show_only_when_no_sponsors}
                            onCheckedChange={(checked) =>
                              updateSettingMutation.mutate({ id: setting.id, field: "show_only_when_no_sponsors", value: checked })
                            }
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Analytics (Last 30 Days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <h3 className="font-medium mb-3">By Page</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Page</TableHead>
                        <TableHead className="text-right">Views</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {["home_page", "events_page", "messages_page"].map((context) => {
                        const stats = getContextStats(context);
                        const ctr = stats.views > 0 ? ((stats.clicks / stats.views) * 100).toFixed(1) : "0.0";
                        return (
                          <TableRow key={context}>
                            <TableCell className="capitalize">{context.replace("_page", "").replace("_", " ")}</TableCell>
                            <TableCell className="text-right">{stats.views}</TableCell>
                            <TableCell className="text-right">{stats.clicks}</TableCell>
                            <TableCell className="text-right">{ctr}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div>
                  <h3 className="font-medium mb-3">By Ad</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Ad</TableHead>
                        <TableHead className="text-right">Views</TableHead>
                        <TableHead className="text-right">Clicks</TableHead>
                        <TableHead className="text-right">CTR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ads?.map((ad) => {
                        const stats = getAdStats(ad.id);
                        const ctr = stats.views > 0 ? ((stats.clicks / stats.views) * 100).toFixed(1) : "0.0";
                        return (
                          <TableRow key={ad.id}>
                            <TableCell>{ad.name}</TableCell>
                            <TableCell className="text-right">{stats.views}</TableCell>
                            <TableCell className="text-right">{stats.clicks}</TableCell>
                            <TableCell className="text-right">{ctr}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
