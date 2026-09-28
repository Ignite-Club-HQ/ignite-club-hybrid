import { ClubSponsorSection } from "@/components/ClubSponsorSection";
import { MultiClubSponsorCarousel } from "@/components/MultiClubSponsorCarousel";
import { SponsorOrAdCarousel } from "@/components/SponsorOrAdCarousel";
import { readHomeSponsorHint } from "@/lib/homeSponsorHint";

interface HomeSponsorSectionsProps {
  userId?: string;
  activeClubFilter: string | null;
  clubs: Array<{ id: string; class_mode_enabled: boolean }> | undefined;
}

export function HomeSponsorSections({
  userId,
  activeClubFilter,
  clubs,
}: HomeSponsorSectionsProps) {
  const sponsorHint = readHomeSponsorHint(userId, activeClubFilter);
  const inClassMode = !!(
    activeClubFilter &&
    clubs?.find((club) => club.id === activeClubFilter)?.class_mode_enabled
  );

  return (
    <>
      <div style={{ minHeight: sponsorHint === "none" ? 0 : 120 }}>
        {activeClubFilter ? (
          !inClassMode && <ClubSponsorSection clubId={activeClubFilter} />
        ) : (
          <MultiClubSponsorCarousel />
        )}
      </div>
      {!inClassMode && (
        <div style={{ minHeight: 112 }}>
          <SponsorOrAdCarousel
            location="home"
            activeClubFilter={activeClubFilter}
          />
        </div>
      )}
    </>
  );
}
