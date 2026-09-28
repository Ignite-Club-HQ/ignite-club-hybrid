import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

type StatusTone = "error" | "success" | "warning";

const statusIcons = {
  error: <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />,
  success: <CheckCircle className="h-12 w-12 text-primary mx-auto mb-4" />,
  warning: <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-4" />,
} satisfies Record<StatusTone, ReactNode>;

export function JoinTeamStatusCard({
  tone,
  title,
  description,
  actions,
}: {
  tone: StatusTone;
  title: string;
  description: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center">
          {statusIcons[tone]}
          <h2 className="text-xl font-semibold mb-2">{title}</h2>
          <p className="text-muted-foreground mb-4">{description}</p>
          {actions}
        </CardContent>
      </Card>
    </div>
  );
}
