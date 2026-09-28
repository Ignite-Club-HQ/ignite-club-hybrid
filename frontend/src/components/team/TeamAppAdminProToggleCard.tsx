import { Crown, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface TeamAppAdminProToggleCardProps {
  isProOverride: boolean;
  onProOverrideChange: (checked: boolean) => void;
  isSoccerClub: boolean;
  isProFootballOverride: boolean;
  onProFootballOverrideChange: (checked: boolean) => void;
}

export function TeamAppAdminProToggleCard({
  isProOverride,
  onProOverrideChange,
  isSoccerClub,
  isProFootballOverride,
  onProFootballOverrideChange,
}: TeamAppAdminProToggleCardProps) {
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Pro Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Crown className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-sm">Free Pro Access</p>
              <p className="text-xs text-muted-foreground">Grant free Pro features</p>
            </div>
          </div>
          <Switch checked={isProOverride} onCheckedChange={onProOverrideChange} />
        </div>

        {/* Pro Football Toggle - Only for Soccer Teams */}
        {isSoccerClub && (
          <div className="flex items-center justify-between pt-2 border-t">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Free Pro Football Access</p>
                <p className="text-xs text-muted-foreground">Grant free Pro Football features</p>
              </div>
            </div>
            <Switch checked={isProFootballOverride} onCheckedChange={onProFootballOverrideChange} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
