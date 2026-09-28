import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ClubAdminConfirmBannerProps {
  teamName: string;
  action: "add members" | "import fixtures";
}

export function ClubAdminConfirmBanner({ teamName, action }: ClubAdminConfirmBannerProps) {
  return (
    <Alert className="border-warning/30 bg-warning/10">
      <ShieldAlert className="h-4 w-4 text-warning" />
      <AlertDescription className="text-sm">
        <span className="font-medium">Club Admin Action:</span> You're about to {action} for{" "}
        <span className="font-semibold">{teamName}</span> as a club admin. You are not a direct member of this team.
      </AlertDescription>
    </Alert>
  );
}
