import { FolderOpen, Lock, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface ClubQuickActionsProps {
  clubId: string;
  classModeEnabled: boolean;
  hasProAccess: boolean;
}

function QuickAction({
  to,
  label,
  icon: Icon,
  hasProAccess,
}: {
  to: string;
  label: string;
  icon: typeof MessageCircle;
  hasProAccess: boolean;
}) {
  const content = (
    <Card className={hasProAccess ? "hover:border-primary/50 transition-colors" : "border-muted bg-muted/30 cursor-not-allowed"}>
      <CardContent className="p-4 flex flex-col items-center gap-2 relative">
        {!hasProAccess && (
          <div className="absolute top-2 right-2">
            <Badge variant="secondary" className="text-xs gap-1">
              <Lock className="h-3 w-3" />
              Pro
            </Badge>
          </div>
        )}
        <Icon className={`h-6 w-6 ${hasProAccess ? "text-primary" : "text-muted-foreground"}`} />
        <span className={`text-sm font-medium ${hasProAccess ? "" : "text-muted-foreground"}`}>{label}</span>
      </CardContent>
    </Card>
  );

  return hasProAccess ? <Link to={to}>{content}</Link> : content;
}

export function ClubQuickActions({ clubId, classModeEnabled, hasProAccess }: ClubQuickActionsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <QuickAction
        to={`/messages/club/${clubId}`}
        label={classModeEnabled ? "Group Chat" : "Club Chat"}
        icon={MessageCircle}
        hasProAccess={hasProAccess}
      />
      <QuickAction to={`/vault?club=${clubId}`} label="Vault" icon={FolderOpen} hasProAccess={hasProAccess} />
    </div>
  );
}
