import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Image } from "lucide-react";
import { SecureImage } from "@/components/SecureImage";

interface TeamLatestPhotosProps {
  teamId: string;
  clubId: string;
}

export function TeamLatestPhotos({ teamId, clubId }: TeamLatestPhotosProps) {
  const navigate = useNavigate();

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ["team-latest-photos", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("photos")
        .select("id, file_url, image_url, title")
        .eq("team_id", teamId)
        .eq("show_in_feed", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(6);
      return data || [];
    },
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Latest Photos</h3>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {[1, 2, 3].map(i => (
            <div key={i} className="shrink-0 w-20 h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (photos.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Latest Photos</h3>
        <button
          onClick={() => navigate(`/media?team=${teamId}`)}
          className="text-xs text-primary hover:underline"
        >
          View all
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
        {photos.map((photo) => {
          const imgSrc = photo.image_url || photo.file_url;
          return (
            <button
              key={photo.id}
              onClick={() => navigate(`/media?photo=${photo.id}`)}
              className="shrink-0 w-20 h-20 rounded-lg overflow-hidden border bg-card hover:border-primary/50 transition-colors active:scale-[0.97]"
            >
              {imgSrc ? (
                <SecureImage
                  src={imgSrc}
                  alt={photo.title || "Photo"}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <Image className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
