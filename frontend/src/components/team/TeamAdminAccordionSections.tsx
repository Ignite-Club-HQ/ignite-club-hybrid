import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Crown, FileText, Settings } from "lucide-react";
import { TeamAddAdminCard } from "@/components/team/TeamAddAdminCard";
import { TeamAdminLinkCard } from "@/components/team/TeamAdminLinkCard";
import { TeamAppAdminProToggleCard } from "@/components/team/TeamAppAdminProToggleCard";
import TeamCaptainCard from "@/components/TeamCaptainCard";
import { PlayHQTeamLinkCard } from "@/components/PlayHQTeamLinkCard";

interface TeamAdminAccordionSectionProps {
  teamId: string;
  teamName: string;
  clubId: string;
  teamType: string | null | undefined;
  members: React.ComponentProps<typeof TeamAddAdminCard>["members"];
  canManageCaptains: boolean;
  isTeamPro: boolean;
  hasProFootball: boolean;
}

/**
 * The "Admin" accordion section: team admin/captain management, PlayHQ
 * linking, and quick links to roles/attendance/player-stats (the latter two
 * gated on Pro/Pro Football). TeamDetailPage retains all query ownership;
 * this component is purely presentational.
 */
export function TeamAdminAccordionSection({
  teamId,
  teamName,
  clubId,
  teamType,
  members,
  canManageCaptains,
  isTeamPro,
  hasProFootball,
}: TeamAdminAccordionSectionProps) {
  return (
    <AccordionItem value="admin" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Admin</h2>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 pt-2">
          {/* Quick Action: Add Team Admin */}
          <TeamAddAdminCard teamId={teamId} teamName={teamName} clubId={clubId} members={members} />

          {/* Captain (senior / mixed teams only) — same management rights as a team admin */}
          {["senior", "mixed"].includes(String(teamType || "mixed").toLowerCase()) && (
            <TeamCaptainCard teamId={teamId} teamName={teamName} members={members} canManage={canManageCaptains} />
          )}

          {/* PlayHQ Link */}
          <PlayHQTeamLinkCard teamId={teamId} clubId={clubId} />

          <TeamAdminLinkCard to={`/teams/${teamId}/roles`} icon={Settings} label="Manage Roles" />

          <TeamAdminLinkCard
            to={`/teams/${teamId}/attendance`}
            lockedTo={`/teams/${teamId}/upgrade`}
            unlocked={isTeamPro}
            lockedBadgeLabel="Pro"
            icon={BarChart3}
            iconClassName="text-emerald-500"
            iconBgClassName="bg-emerald-500/10"
            label="Attendance Stats"
          />

          <TeamAdminLinkCard
            to={`/reports/player-stats?teamId=${teamId}`}
            lockedTo={`/teams/${teamId}/upgrade`}
            unlocked={hasProFootball}
            lockedBadgeLabel="Pro Football"
            icon={FileText}
            iconClassName="text-emerald-500"
            iconBgClassName="bg-emerald-500/10"
            label="Player Stats Reports"
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

interface TeamAppAdminAccordionSectionProps {
  isSoccerClub: boolean;
  isProOverride: boolean;
  isProFootballOverride: boolean;
  onProOverrideChange: (checked: boolean) => void | Promise<void>;
  onProFootballOverrideChange: (checked: boolean) => void | Promise<void>;
}

/**
 * The "App Admin" accordion section: free Pro / Pro Football access
 * override toggles, visible only to app admins. The upsert calls stay in
 * TeamDetailPage and are passed in as callbacks.
 */
export function TeamAppAdminAccordionSection({
  isSoccerClub,
  isProOverride,
  isProFootballOverride,
  onProOverrideChange,
  onProFootballOverrideChange,
}: TeamAppAdminAccordionSectionProps) {
  return (
    <AccordionItem value="app-admin" className="border rounded-lg px-4 border-yellow-500/30 bg-yellow-500/5">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-yellow-500" />
          <h2 className="text-lg font-semibold">App Admin</h2>
          <Badge className="bg-yellow-500 text-yellow-950 text-xs">Admin Only</Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <div className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground mb-3">
            Grant free Pro access. These toggles are for admin-granted access only — they won't reflect promo code or paid subscription status.
          </p>
          <TeamAppAdminProToggleCard
            isProOverride={isProOverride}
            onProOverrideChange={onProOverrideChange}
            isSoccerClub={isSoccerClub}
            isProFootballOverride={isProFootballOverride}
            onProFootballOverrideChange={onProFootballOverrideChange}
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
