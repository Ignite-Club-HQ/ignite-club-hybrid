import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { roleLabels, type AppRole } from "@/features/membership/rolePresentation";

export type IcpLabRoleRosterSource = "icp" | "fixture";

export interface IcpLabRoleRosterEntry {
  profile: { id: string; display_name: string };
  roles: { id: string; role: string }[];
}

export interface IcpLabRoleRosterViewProps {
  /** Page-local heading, e.g. "Club Roles" or "Team Roles". */
  title: string;
  /** Whether the roster came from the local canister or the synthetic fallback fixture. */
  source: IcpLabRoleRosterSource | undefined;
  isLoading: boolean;
  error: unknown;
  /** Page-local fallback text shown when `error` is not an `Error` instance. */
  errorFallbackMessage: string;
  roster: IcpLabRoleRosterEntry[];
  /** Page-local role -> badge className lookup (color palettes differ per roster). */
  roleBadgeClassName: (role: string) => string;
}

/**
 * Shared read-only presentation for the ICP/local-auth club and team role
 * rosters: identical layout, skeleton, error, card and badge rendering
 * sourced from synthetic identity_access fixtures. Roster selection, query
 * keys, and error/title text remain the caller's responsibility.
 */
export function IcpLabRoleRosterView({
  title,
  source,
  isLoading,
  error,
  errorFallbackMessage,
  roster,
  roleBadgeClassName,
}: IcpLabRoleRosterViewProps) {
  const navigate = useNavigate();

  return (
    <div className="container max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">{title}</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {source === "icp"
          ? "Loaded from the local identity_access canister. Inviting members and changing roles are disabled."
          : "The local identity_access canister is not configured. Showing a synthetic read-only preview; no Supabase request was made."}
      </p>
      {isLoading && <Skeleton className="h-10 w-full" />}
      {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : errorFallbackMessage}</p>}
      <div className="space-y-2">
        {roster.map((entry) => (
          <Card key={entry.profile.id}>
            <CardContent className="flex items-center gap-3 p-4">
              <Avatar>
                <AvatarFallback>{entry.profile.display_name.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{entry.profile.display_name}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {entry.roles.map((role) => (
                    <Badge key={role.id} variant="outline" className={roleBadgeClassName(role.role)}>
                      {roleLabels[role.role as AppRole]}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
