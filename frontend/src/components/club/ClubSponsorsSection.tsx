import { Building2 } from "lucide-react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { SponsorsManager } from "@/components/SponsorsManager";
import { ClubTeamSponsorAllocator } from "@/components/ClubTeamSponsorAllocator";

export type ClubSponsorToggleField =
  | "media_sponsors_enabled"
  | "media_header_sponsors_enabled"
  | "chat_thread_ads_enabled"
  | "events_sponsor_strip_enabled";

interface SponsorToggleConfig {
  field: ClubSponsorToggleField;
  label: string;
  description: string;
}

const SPONSOR_TOGGLES: SponsorToggleConfig[] = [
  {
    field: "media_sponsors_enabled",
    label: "Show sponsors in Media feed",
    description: "Interleaves a club sponsor tile every 8 photos in the Media feed. Tier-weighted (Gold > Silver > Bronze). Off by default.",
  },
  {
    field: "media_header_sponsors_enabled",
    label: "Show sponsor strip at top of Media",
    description: "Shows a slim, dismissible club sponsor bar above the Media feed. Tier-weighted rotation. Off by default.",
  },
  {
    field: "chat_thread_ads_enabled",
    label: "Show sponsor strip in chat threads",
    description: "Shows a slim, dismissible club sponsor bar at the top of every chat thread. Tier-weighted rotation. Off by default.",
  },
  {
    field: "events_sponsor_strip_enabled",
    label: "Show sponsor strip on Events",
    description: "Shows a rotating sponsor or ad strip above the events list and on each event detail page. Off by default.",
  },
];

interface ClubSponsorsSectionProps {
  hasProAccess: boolean;
  useIcpLab: boolean;
  toggleValues: Record<ClubSponsorToggleField, boolean>;
  onToggle: (field: ClubSponsorToggleField, checked: boolean) => void;
  clubId: string;
  currentPrimarySponsorId: string | null;
  onPrimaryChange: () => void;
}

export function ClubSponsorsSection({
  hasProAccess,
  useIcpLab,
  toggleValues,
  onToggle,
  clubId,
  currentPrimarySponsorId,
  onPrimaryChange,
}: ClubSponsorsSectionProps) {
  return (
    <AccordionItem value="sponsors" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">Sponsors</span>
          {!hasProAccess && (
            <Badge variant="outline" className="text-xs font-normal ml-2">Configure now, activates on Pro</Badge>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="pt-2 space-y-4">
          {!hasProAccess && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              You can add sponsors and assign them to teams now — they'll appear across the app (club page, media, chat, events) automatically once your club is on the <strong>Pro</strong> plan.
            </div>
          )}
          {/* Display-surface toggles — only functional on Pro */}
          <fieldset disabled={!hasProAccess || useIcpLab} className={cn("space-y-4", (!hasProAccess || useIcpLab) && "opacity-60")}>
            {SPONSOR_TOGGLES.map(({ field, label, description }) => (
              <div key={field} className="flex items-start justify-between gap-3 rounded-md border p-3">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">{label}</Label>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <Switch
                  checked={!!toggleValues[field]}
                  onCheckedChange={(checked) => onToggle(field, checked)}
                />
              </div>
            ))}
          </fieldset>
          {useIcpLab ? (
            <p className="text-sm text-muted-foreground">
              Sponsor management is unavailable in ICP lab mode.
            </p>
          ) : (
            <>
              <SponsorsManager
                clubId={clubId}
                currentPrimarySponsorId={currentPrimarySponsorId}
                onPrimaryChange={onPrimaryChange}
              />
              <ClubTeamSponsorAllocator clubId={clubId} />
            </>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
