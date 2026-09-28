import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PrimarySponsorDisplay, type PrimarySponsorContext } from "@/components/PrimarySponsorDisplay";
import { Button } from "@/components/ui/button";

export interface SponsorCarouselItem {
  id: string;
  sponsorId: string;
  entityName: string;
}

type SelectionEvent = "initial" | "select" | "reInit";

export interface SponsorCarouselPlacement {
  sectionClassName: string;
  selectionEvents: readonly SelectionEvent[];
}

export const CLUB_SPONSOR_CAROUSEL_PLACEMENT: SponsorCarouselPlacement = {
  sectionClassName: "space-y-3",
  selectionEvents: ["initial", "select", "reInit"],
};

export const MESSAGES_SPONSOR_CAROUSEL_PLACEMENT: SponsorCarouselPlacement = {
  sectionClassName: "space-y-3 mt-6",
  selectionEvents: ["select"],
};

export const MULTI_CLUB_SPONSOR_CAROUSEL_PLACEMENT: SponsorCarouselPlacement = {
  sectionClassName: "space-y-3",
  selectionEvents: ["select"],
};

interface SponsorCarouselPresentationProps {
  sponsors: readonly SponsorCarouselItem[];
  context: PrimarySponsorContext;
  placement: SponsorCarouselPlacement;
}

export function SponsorCarouselPresentation({
  sponsors,
  context,
  placement,
}: SponsorCarouselPresentationProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: true,
    dragFree: false,
    watchDrag: true,
  });

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCurrentIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    const subscribedEvents = placement.selectionEvents.filter(event => event !== "initial");
    subscribedEvents.forEach(event => emblaApi.on(event, onSelect));
    if (placement.selectionEvents.includes("initial")) onSelect();
    return () => {
      subscribedEvents.forEach(event => emblaApi.off(event, onSelect));
    };
  }, [emblaApi, onSelect, placement]);

  useEffect(() => {
    if (sponsors.length <= 1 || !emblaApi) return;
    const interval = setInterval(() => emblaApi.scrollNext(), 8000);
    return () => clearInterval(interval);
  }, [sponsors.length, emblaApi]);

  if (sponsors.length === 0) return null;

  if (sponsors.length === 1) {
    return (
      <section className={placement.sectionClassName}>
        <PrimarySponsorDisplay
          sponsorId={sponsors[0].sponsorId}
          variant="full"
          context={context}
          entityName={sponsors[0].entityName}
        />
      </section>
    );
  }

  return (
    <section className={placement.sectionClassName}>
      <div className="relative group">
        <div className="overflow-hidden cursor-grab active:cursor-grabbing touch-pan-y" ref={emblaRef}>
          <div className="flex">
            {sponsors.map(sponsor => (
              <div key={sponsor.id} className="flex-[0_0_100%] min-w-0">
                <PrimarySponsorDisplay
                  sponsorId={sponsor.sponsorId}
                  variant="full"
                  context={context}
                  entityName={sponsor.entityName}
                />
              </div>
            ))}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => emblaApi?.scrollPrev()}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => emblaApi?.scrollNext()}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex justify-center gap-1.5">
        {sponsors.map((_, index) => (
          <button
            key={index}
            onClick={() => emblaApi?.scrollTo(index)}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === currentIndex
                ? "w-4 bg-primary"
                : "w-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50"
            }`}
            aria-label={`View sponsor ${index + 1}`}
          />
        ))}
      </div>
    </section>
  );
}
