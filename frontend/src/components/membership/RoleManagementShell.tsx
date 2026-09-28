import type { ReactNode } from "react";
import { ArrowLeft, Shield, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function RoleManagementHeader({
  subtitle,
  onBack,
}: {
  subtitle: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={onBack}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div>
        <h1 className="text-xl font-bold">Manage Roles</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

export function RoleManagementTabs({
  requestCount,
  members,
  requests,
}: {
  requestCount: number;
  members: ReactNode;
  requests: ReactNode;
}) {
  return (
    <Tabs defaultValue="members">
      <TabsList className="w-full">
        <TabsTrigger value="members" className="flex-1">
          Members
        </TabsTrigger>
        <TabsTrigger value="requests" className="flex-1 relative">
          Requests
          {requestCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold flex items-center justify-center text-destructive-foreground">
              {requestCount}
            </span>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="members" className="mt-4 space-y-4">
        {members}
      </TabsContent>
      <TabsContent value="requests" className="mt-4 space-y-4">
        {requests}
      </TabsContent>
    </Tabs>
  );
}

export function RoleRosterLoading() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

export function RoleRosterEmpty({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="p-8 text-center">
        <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

export function RoleRequestsEmpty() {
  return (
    <Card className="border-dashed">
      <CardContent className="p-8 text-center">
        <UserPlus className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground">No pending requests</p>
      </CardContent>
    </Card>
  );
}

export function RolePageLoading() {
  return (
    <div className="py-6 space-y-4">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
