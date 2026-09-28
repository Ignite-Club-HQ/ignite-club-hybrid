import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Lock } from "lucide-react";

interface TeamAdminLinkCardProps {
  to: string;
  icon: LucideIcon;
  label: string;
  /** When false, the card renders locked and links to the upgrade path instead. */
  unlocked?: boolean;
  lockedTo?: string;
  lockedBadgeLabel?: string;
  /** Tailwind classes for the unlocked icon and its background chip. */
  iconClassName?: string;
  iconBgClassName?: string;
}

/** A single quick-action link card used in the Team Admin accordion, with an
 * optional Pro/Pro-Football locked variant. */
export function TeamAdminLinkCard({
  to,
  icon: Icon,
  label,
  unlocked = true,
  lockedTo,
  lockedBadgeLabel,
  iconClassName = "text-primary",
  iconBgClassName = "bg-primary/10",
}: TeamAdminLinkCardProps) {
  if (!unlocked) {
    return (
      <Link to={lockedTo ?? to}>
        <Card className="hover:border-primary/50 transition-colors opacity-75">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Icon className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="font-medium text-muted-foreground">{label}</span>
            <Badge variant="secondary" className="ml-auto text-xs">
              <Lock className="h-3 w-3 mr-1" />
              {lockedBadgeLabel}
            </Badge>
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <Link to={to}>
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="p-4 flex items-center gap-3">
          <div className={`p-2 rounded-lg ${iconBgClassName}`}>
            <Icon className={`h-5 w-5 ${iconClassName}`} />
          </div>
          <span className="font-medium">{label}</span>
        </CardContent>
      </Card>
    </Link>
  );
}
