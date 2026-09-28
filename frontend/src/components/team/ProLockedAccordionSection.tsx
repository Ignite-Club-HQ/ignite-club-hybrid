import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Loader2, Lock } from "lucide-react";

interface ProLockedAccordionSectionProps {
  value: string;
  icon: LucideIcon;
  title: string;
  /** Whether the entitlement check (subscription/loading state) is still resolving. */
  isLoading: boolean;
  /** Whether the section's Pro/Pro Football entitlement is satisfied. */
  isUnlocked: boolean;
  /** Badge label shown next to the title while locked, e.g. "Pro" or "Pro Football". */
  lockBadgeLabel?: string;
  /** Message shown in place of the content while locked. */
  upgradeMessage?: string;
  /** The unlocked section content, rendered once `isUnlocked` is true. */
  children: ReactNode;
}

/**
 * Shared shell for the Pro/Pro Football-gated accordion sections (Fee
 * Payments, Team Sponsor, Team Rewards, Pitch Settings): a trigger with an
 * icon, title, and lock badge, and content that shows a loading spinner, the
 * unlocked feature, or an upgrade message depending on entitlement state.
 */
export function ProLockedAccordionSection({
  value,
  icon: Icon,
  title,
  isLoading,
  isUnlocked,
  lockBadgeLabel = "Pro",
  upgradeMessage = "Upgrade to Pro to access this feature.",
  children,
}: ProLockedAccordionSectionProps) {
  const isLocked = !isLoading && !isUnlocked;
  return (
    <AccordionItem value={value} className="border rounded-lg px-4" disabled={isLocked}>
      <AccordionTrigger className="hover:no-underline disabled:cursor-not-allowed disabled:opacity-70" disabled={isLocked}>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">{title}</h2>
          {isLocked && (
            <div className="flex items-center gap-1.5 ml-2">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <Badge variant="outline" className="text-xs font-normal">{lockBadgeLabel}</Badge>
            </div>
          )}
        </div>
      </AccordionTrigger>
      <AccordionContent>
        {isLoading ? (
          <div className="pt-2 flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isUnlocked ? (
          children
        ) : (
          <div className="pt-2 text-center text-muted-foreground py-4">{upgradeMessage}</div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
