import { Suspense, type ComponentProps } from "react";
import { Building2, ClipboardCheck, CreditCard, Flame, LayoutGrid, Trophy } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ClassAttendanceSingle } from "@/components/ClassAttendanceSingle";
import MemberSubscriptionPaymentsManager from "@/components/MemberSubscriptionPaymentsManager";
import { TeamSponsorSelector } from "@/components/TeamSponsorSelector";
import TeamRewardsManager from "@/components/TeamRewardsManager";
import { DefaultPitchSettings } from "@/components/pitch/DefaultPitchSettings";
import { ProLockedAccordionSection } from "@/components/team/ProLockedAccordionSection";
import { TeamAdminAccordionSection, TeamAppAdminAccordionSection } from "@/components/team/TeamAdminAccordionSections";
import { TeamMembersSection } from "@/components/team/TeamMembersSection";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const TeamGameHistoryTab = lazyWithRetry(() => import("@/components/history/TeamGameHistoryTab"));

type MembersSectionProps = ComponentProps<typeof TeamMembersSection>;

interface TeamSubscription {
  admin_pro_override?: boolean;
  admin_pro_football_override?: boolean;
  disable_auto_subs?: boolean;
  disable_position_swaps?: boolean;
  formation?: string | null;
  is_pro?: boolean;
  is_pro_football?: boolean;
  minutes_per_half?: number;
  rotation_speed?: number;
  team_size?: number;
}

interface ClubSubscription {
  disable_team_pom_rewards?: boolean;
}

interface TeamDetailAccordionSectionsProps {
  teamId: string;
  teamName: string;
  clubId: string;
  teamType?: string | null;
  teamSponsorId?: string | null;
  isMember: boolean;
  isClubAdmin: boolean;
  isAdmin: boolean;
  isCoachOrAdmin: boolean;
  isAppAdmin: boolean;
  isClassMode: boolean;
  isSoccerClub: boolean;
  isBasketballClub: boolean;
  isNetballClub: boolean;
  isSubscriptionLoading: boolean;
  isTeamPro: boolean;
  hasProFootball: boolean;
  canManageCaptains: boolean;
  membersSectionProps: Omit<MembersSectionProps, "teamId">;
  teamSubscription?: TeamSubscription | null;
  clubSubscription?: ClubSubscription | null;
  onProOverrideChange: (checked: boolean) => void;
  onProFootballOverrideChange: (checked: boolean) => void;
  onSponsorUpdate: () => void;
  isSavingPitchSettings: boolean;
  defaultMinutesPerHalf: number;
  savePitchSetting: (
    values: Record<string, unknown>,
    errorMessage: string,
    successMessage: string,
  ) => Promise<void>;
  refetchMembers: () => void;
  refetchChildren: () => void;
}

export function TeamDetailAccordionSections({
  teamId,
  teamName,
  clubId,
  teamType,
  teamSponsorId,
  isMember,
  isClubAdmin,
  isAdmin,
  isCoachOrAdmin,
  isAppAdmin,
  isClassMode,
  isSoccerClub,
  isBasketballClub,
  isNetballClub,
  isSubscriptionLoading,
  isTeamPro,
  hasProFootball,
  canManageCaptains,
  membersSectionProps,
  teamSubscription,
  clubSubscription,
  onProOverrideChange,
  onProFootballOverrideChange,
  onSponsorUpdate,
  isSavingPitchSettings,
  defaultMinutesPerHalf,
  savePitchSetting,
  refetchMembers,
  refetchChildren,
}: TeamDetailAccordionSectionsProps) {
  return (
    <Accordion
      type="multiple"
      defaultValue={["members"]}
      className="space-y-4"
      onValueChange={(value) => {
        if (
          value.includes("members") &&
          Object.keys(membersSectionProps.members).length === 0 &&
          membersSectionProps.teamChildren.length === 0 &&
          !membersSectionProps.isMembersLoading &&
          !membersSectionProps.isMembersFetching &&
          !membersSectionProps.isChildrenLoading &&
          !membersSectionProps.isChildrenFetching
        ) {
          refetchMembers();
          refetchChildren();
        }
      }}
    >
      <TeamMembersSection teamId={teamId} {...membersSectionProps} />

      {isClassMode && (isCoachOrAdmin || isClubAdmin) && (
        <AccordionItem value="class-attendance" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Attendance</h2>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-2"><ClassAttendanceSingle teamId={teamId} clubId={clubId} /></div>
          </AccordionContent>
        </AccordionItem>
      )}

      {isMember && (isBasketballClub || isNetballClub) && isAppAdmin && (
        <AccordionItem value="game-history" className="border rounded-lg px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Game History</h2>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="pt-2">
              <Suspense fallback={<div className="text-xs text-muted-foreground py-4">Loading…</div>}>
                <TeamGameHistoryTab teamId={teamId} teamName={teamName} canManage={isAdmin || isCoachOrAdmin || isClubAdmin} />
              </Suspense>
            </div>
          </AccordionContent>
        </AccordionItem>
      )}

      {(isAdmin || isClubAdmin) && (
        <TeamAdminAccordionSection
          teamId={teamId}
          teamName={teamName}
          clubId={clubId}
          teamType={teamType}
          members={membersSectionProps.members}
          canManageCaptains={canManageCaptains}
          isTeamPro={isTeamPro}
          hasProFootball={hasProFootball}
        />
      )}

      {isAppAdmin && (
        <TeamAppAdminAccordionSection
          isSoccerClub={isSoccerClub}
          isProOverride={teamSubscription?.admin_pro_override || false}
          isProFootballOverride={teamSubscription?.admin_pro_football_override || false}
          onProOverrideChange={onProOverrideChange}
          onProFootballOverrideChange={onProFootballOverrideChange}
        />
      )}

      {(isCoachOrAdmin || isClubAdmin) && (
        <ProLockedAccordionSection value="subscription-payments" icon={CreditCard} title="Fee Payments" isLoading={isSubscriptionLoading} isUnlocked={isTeamPro || isAppAdmin}>
          <div className="pt-2">
            <MemberSubscriptionPaymentsManager clubId={clubId} teamId={teamId} members={membersSectionProps.members} isAdmin={isCoachOrAdmin || isClubAdmin} />
          </div>
        </ProLockedAccordionSection>
      )}

      {isAdmin && clubId && !isClassMode && (
        <ProLockedAccordionSection value="team-sponsor" icon={Building2} title="Team Sponsor" isLoading={isSubscriptionLoading} isUnlocked={isTeamPro || isAppAdmin}>
          <div className="pt-2">
            <TeamSponsorSelector teamId={teamId} currentSponsorId={teamSponsorId || null} onUpdate={onSponsorUpdate} />
          </div>
        </ProLockedAccordionSection>
      )}

      {isAdmin && clubId && !isClassMode && (
        <ProLockedAccordionSection value="team-rewards" icon={Flame} title="Team Rewards" isLoading={isSubscriptionLoading} isUnlocked={isTeamPro || isAppAdmin}>
          <div className="pt-2">
            <TeamRewardsManager teamId={teamId} clubId={clubId} disableTeamOverrides={clubSubscription?.disable_team_pom_rewards || false} />
          </div>
        </ProLockedAccordionSection>
      )}

      {isAdmin && isSoccerClub && (
        <ProLockedAccordionSection value="pitch-settings" icon={LayoutGrid} title="Pitch Settings" isLoading={isSubscriptionLoading} isUnlocked={hasProFootball || isAppAdmin} lockBadgeLabel="Pro Football" upgradeMessage="Upgrade to Pro Football to access this feature.">
          <div className="pt-2 space-y-4">
            <DefaultPitchSettings
              teamSize={teamSubscription?.team_size || 7}
              formation={teamSubscription?.formation || null}
              minutesPerHalf={teamSubscription?.minutes_per_half || defaultMinutesPerHalf}
              rotationSpeed={teamSubscription?.rotation_speed || 1}
              disableAutoSubs={teamSubscription?.disable_auto_subs || false}
              disablePositionSwaps={teamSubscription?.disable_position_swaps || false}
              isSaving={isSavingPitchSettings}
              onTeamSizeChange={async () => {}}
              onFormationChange={async (formation, newTeamSize) => savePitchSetting({ formation, team_size: newTeamSize }, "Failed to update settings", newTeamSize ? "Team size updated" : "Formation updated")}
              onMinutesPerHalfChange={async (minutes) => savePitchSetting({ minutes_per_half: minutes }, "Failed to update minutes per half", "Minutes per half updated")}
              onRotationSpeedChange={async (speed) => savePitchSetting({ rotation_speed: speed }, "Failed to update rotation speed", "Rotation speed updated")}
              onDisableAutoSubsChange={async (disabled) => savePitchSetting({ disable_auto_subs: disabled }, "Failed to update auto subs setting", disabled ? "Auto subs disabled" : "Auto subs enabled")}
              onDisablePositionSwapsChange={async (disabled) => savePitchSetting({ disable_position_swaps: disabled }, "Failed to update position swaps setting", disabled ? "Position swaps disabled" : "Position swaps enabled")}
            />
          </div>
        </ProLockedAccordionSection>
      )}
    </Accordion>
  );
}
