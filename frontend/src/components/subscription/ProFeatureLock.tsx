import { Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface ProFeatureLockProps {
  title?: string;
  description?: string;
  featureLabel?: string;
  clubId?: string | null;
  showUpgradeButton?: boolean;
}

/**
 * Standard empty/locked state shown when a user without active Pro access
 * lands on a Pro-only feature. Use INSIDE the page (after header) so users
 * still see chrome/navigation.
 */
export function ProFeatureLock({
  title = "Pro Feature",
  description,
  featureLabel = "This feature",
  clubId,
  showUpgradeButton = true,
}: ProFeatureLockProps) {
  const navigate = useNavigate();
  const body =
    description ||
    `${featureLabel} is available on Pro. Contact your club administrator to upgrade.`;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Crown className="h-8 w-8 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-muted-foreground text-sm max-w-xs mb-6">{body}</p>
      {showUpgradeButton && clubId && (
        <Button onClick={() => navigate(`/clubs/${clubId}/upgrade`)}>
          <Crown className="h-4 w-4 mr-2" />
          Upgrade to Pro
        </Button>
      )}
    </div>
  );
}
