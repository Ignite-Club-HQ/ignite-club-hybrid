import { Activity, Building2, CreditCard, Lock, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface ClubSubscriptionSummary {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
  plan?: string | null;
}

interface ClubAdminNavigationSectionProps {
  clubId: string;
  isAppAdmin: boolean;
  subscription?: ClubSubscriptionSummary | null;
}

function AdminLinkCard({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: typeof Settings;
  children: ReactNode;
}) {
  return (
    <Link to={to}>
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          {children}
        </CardContent>
      </Card>
    </Link>
  );
}

export function ClubAdminNavigationSection({
  clubId,
  isAppAdmin,
  subscription,
}: ClubAdminNavigationSectionProps) {
  const hasPro = !!(
    subscription?.is_pro
    || subscription?.is_pro_football
    || subscription?.admin_pro_override
    || subscription?.admin_pro_football_override
  );

  return (
    <AccordionItem value="admin" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          <span className="text-lg font-semibold">Admin</span>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 pt-2">
          <AdminLinkCard to={`/clubs/${clubId}/roles`} icon={Settings}>
            <span className="font-medium">Manage Roles</span>
          </AdminLinkCard>
          <AdminLinkCard to={`/clubs/${clubId}/stripe`} icon={CreditCard}>
            <span className="font-medium">Payment Settings</span>
          </AdminLinkCard>
          <Link to={`/clubs/${clubId}/upgrade`}>
            <Card className={`hover:border-primary/50 transition-colors ${subscription?.is_pro ? "border-yellow-500/30 bg-yellow-500/5" : ""}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${subscription?.is_pro ? "bg-yellow-500/20" : "bg-muted"}`}>
                  <Building2 className={`h-5 w-5 ${subscription?.is_pro ? "text-yellow-500" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1">
                  <span className="font-medium">Club Pro Plans</span>
                  {subscription?.is_pro && (
                    <p className="text-xs text-muted-foreground">
                      {subscription.is_pro_football ? "Pro Football" : "Pro"} • {subscription.plan?.charAt(0).toUpperCase()}{subscription.plan?.slice(1)}
                    </p>
                  )}
                </div>
                {subscription?.is_pro && <Badge className="bg-yellow-500 text-yellow-950">Active</Badge>}
              </CardContent>
            </Card>
          </Link>
          <AdminLinkCard to={`/clubs/${clubId}/engagement`} icon={Activity}>
            <div className="flex-1">
              <div className="font-medium">Engagement Analytics</div>
              <div className="text-xs text-muted-foreground">Health, adoption, communication & more</div>
            </div>
            {!isAppAdmin && !hasPro && (
              <div className="flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <Badge variant="outline" className="text-xs font-normal">Pro</Badge>
              </div>
            )}
          </AdminLinkCard>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
