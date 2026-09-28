import { Shield } from "lucide-react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface ClubAppAdminSectionProps {
  isPro: boolean;
  isProFootball: boolean;
  isSoccerClub: boolean;
  isTogglePending: boolean;
  plan: string | null | undefined;
  teamLimit: number | null | undefined;
  onToggleClubPro: (checked: boolean) => void;
  onToggleClubProFootball: (checked: boolean) => void;
}

export function ClubAppAdminSection({
  isPro,
  isProFootball,
  isSoccerClub,
  isTogglePending,
  plan,
  teamLimit,
  onToggleClubPro,
  onToggleClubProFootball,
}: ClubAppAdminSectionProps) {
  return (
    <AccordionItem value="app-admin" className="border rounded-lg px-4 border-red-500/30">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-red-500" />
          <span className="text-lg font-semibold">App Admin</span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="font-medium">Club Pro</Label>
                <p className="text-xs text-muted-foreground">Enable Pro features for all teams</p>
              </div>
              <Switch
                checked={isPro}
                onCheckedChange={onToggleClubPro}
                disabled={isTogglePending}
              />
            </div>

            {isSoccerClub && (
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Club Pro Football</Label>
                  <p className="text-xs text-muted-foreground">Enable pitch board for all teams (includes Pro)</p>
                </div>
                <Switch
                  checked={isProFootball}
                  onCheckedChange={onToggleClubProFootball}
                  disabled={isTogglePending}
                />
              </div>
            )}

            {isPro && (
              <div className="text-xs text-muted-foreground pt-2 border-t">
                Plan: {plan?.charAt(0).toUpperCase()}{plan?.slice(1)} •
                Teams: {teamLimit ?? "Unlimited"}
              </div>
            )}
          </CardContent>
        </Card>
      </AccordionContent>
    </AccordionItem>
  );
}
