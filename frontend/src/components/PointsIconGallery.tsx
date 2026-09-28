import { useState } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { compressImage } from "@/lib/imageCompression";

// Import all gallery icons
import wolfIcon from "@/assets/points-icons/wolf.png";
import starCoinIcon from "@/assets/points-icons/star-coin.png";
import lightningIcon from "@/assets/points-icons/lightning.png";
import flameIcon from "@/assets/points-icons/flame.png";
import trophyIcon from "@/assets/points-icons/trophy.png";
import shieldIcon from "@/assets/points-icons/shield.png";
import diamondIcon from "@/assets/points-icons/diamond.png";
import lionIcon from "@/assets/points-icons/lion.png";
import eagleIcon from "@/assets/points-icons/eagle.png";
import soccerIcon from "@/assets/points-icons/soccer.png";
import pawIcon from "@/assets/points-icons/paw.png";
import crownIcon from "@/assets/points-icons/crown.png";

const GALLERY_ICONS = [
  { src: wolfIcon, name: "Wolf" },
  { src: lionIcon, name: "Lion" },
  { src: eagleIcon, name: "Eagle" },
  { src: flameIcon, name: "Flame" },
  { src: lightningIcon, name: "Lightning" },
  { src: starCoinIcon, name: "Star" },
  { src: trophyIcon, name: "Trophy" },
  { src: crownIcon, name: "Crown" },
  { src: shieldIcon, name: "Shield" },
  { src: diamondIcon, name: "Diamond" },
  { src: soccerIcon, name: "Football" },
  { src: pawIcon, name: "Paw" },
];

interface PointsIconGalleryProps {
  clubId: string;
  currentIconUrl: string | null;
  onIconSelect: (url: string | null) => void;
}

export function PointsIconGallery({ clubId, currentIconUrl, onIconSelect }: PointsIconGalleryProps) {
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingGalleryIcon, setUploadingGalleryIcon] = useState<string | null>(null);
  const { toast } = useToast();

  const uploadGalleryIcon = async (icon: { src: string; name: string }) => {
    setUploadingGalleryIcon(icon.name);
    try {
      // Fetch the bundled image and upload to Supabase storage
      const response = await fetch(icon.src);
      const blob = await response.blob();
      const fileName = `${clubId}/points-icon/${icon.name.toLowerCase()}-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage
        .from("club-logos")
        .upload(fileName, blob, { contentType: "image/png", upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage
        .from("club-logos")
        .getPublicUrl(fileName);
      onIconSelect(urlData.publicUrl);
    } catch {
      toast({ title: "Failed to set icon", variant: "destructive" });
    } finally {
      setUploadingGalleryIcon(null);
    }
  };

  return (
    <div>
      <Label className="text-xs text-muted-foreground">Points Icon</Label>

      {/* Current selection */}
      {currentIconUrl && (
        <div className="flex items-center gap-2 mt-1 mb-2">
          <div className="relative">
            <img src={currentIconUrl} alt="Points icon" className="h-10 w-10 rounded-lg object-cover border border-border" />
            <button
              type="button"
              className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
              onClick={() => onIconSelect(null)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Current icon — pick a new one below or upload your own</p>
        </div>
      )}

      {/* Gallery grid */}
      <div className="grid grid-cols-6 gap-2 mt-1.5">
        {GALLERY_ICONS.map((icon) => {
          const isLoading = uploadingGalleryIcon === icon.name;
          return (
            <button
              key={icon.name}
              type="button"
              disabled={!!uploadingGalleryIcon}
              className="relative flex flex-col items-center gap-1 p-1.5 rounded-lg border border-border hover:border-primary hover:bg-accent/50 transition-colors disabled:opacity-50"
              onClick={() => uploadGalleryIcon(icon)}
              title={icon.name}
            >
              {isLoading ? (
                <div className="h-9 w-9 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <img src={icon.src} alt={icon.name} className="h-9 w-9 object-contain" />
              )}
              <span className="text-[10px] text-muted-foreground leading-tight">{icon.name}</span>
            </button>
          );
        })}

        {/* Custom upload */}
        <label className="flex flex-col items-center gap-1 p-1.5 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary cursor-pointer transition-colors">
          {uploadingIcon ? (
            <div className="h-9 w-9 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="h-9 w-9 flex items-center justify-center">
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <span className="text-[10px] text-muted-foreground leading-tight">Custom</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploadingIcon(true);
              try {
                const result = await compressImage(file);
                const fileName = `${clubId}/points-icon/${Date.now()}-${file.name}`;
                const { error: uploadError } = await supabase.storage
                  .from("club-logos")
                  .upload(fileName, result.file);
                if (uploadError) throw uploadError;
                const { data: urlData } = supabase.storage
                  .from("club-logos")
                  .getPublicUrl(fileName);
                onIconSelect(urlData.publicUrl);
              } catch {
                toast({ title: "Failed to upload icon", variant: "destructive" });
              } finally {
                setUploadingIcon(false);
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}
