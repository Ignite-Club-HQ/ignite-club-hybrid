import { lazy, Suspense, type ComponentProps } from "react";
import { ChevronRight, FolderOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ContactClubButton } from "@/components/ContactClubButton";
import { HomeQuickActionsFab } from "@/components/HomeQuickActionsFab";
import { MiniLeagueGameWidgets } from "@/components/MiniLeagueGameWidgets";
import { NextUpCarousel } from "@/components/NextUpCarousel";
import { UpcomingClassesWidget } from "@/components/UpcomingClassesWidget";
import { LazyMount } from "@/components/LazyMount";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { DesktopActionBar } from "./DesktopActionBar";
import ClubLinksSection from "./ClubLinksSection";
import ClubNewsSection from "./ClubNewsSection";
import { HomeInitialSkeleton, HomeMyTeamsSkeleton } from "./HomeLoadingSkeletons";
import { HomeWelcomeGetStarted } from "./HomeWelcomeGetStarted";
import { HomeGameTimerRuntime } from "./HomePitchBoardRuntime";

const AccountRecoveryBanner = lazyWithRetry(() =>
  import("@/components/AccountRecoveryBanner").then((module) => ({
    default: module.AccountRecoveryBanner,
  })),
);
const NativeAppDownloadBanner = lazyWithRetry(() =>
  import("@/components/NativeAppDownloadBanner").then((module) => ({
    default: module.NativeAppDownloadBanner,
  })),
);
const HomeInviteFlow = lazyWithRetry(
  () => import("@/components/HomeInviteFlow"),
);
const myTeamsCarouselImport = () =>
  import("@/components/MyTeamsPremiumCarousel").then((module) => ({
    default: module.MyTeamsPremiumCarousel,
  }));
myTeamsCarouselImport();
const MyTeamsPremiumCarousel = lazy(myTeamsCarouselImport);

interface HomeDashboardRole {
  role: string;
  club_id?: string | null;
  team_id?: string | null;
}

interface HomeDashboardOverviewProps {
  firstName: string;
  email?: string;
  activeClubName: string | null;
  activeClubFilter: string | null;
  isNewUserEmptyState: boolean;
  userRoles: HomeDashboardRole[] | undefined;
  canAccessVault: boolean;
  isAppAdmin: boolean;
  hasProContext: boolean;
  showContent: boolean;
  events: ComponentProps<typeof NextUpCarousel>["events"];
  eventsLoading: boolean;
  onNextUpReadyChange: (ready: boolean) => void;
  onMyTeamsReadyChange: (ready: boolean) => void;
  onInvite: () => void;
  onJoinTeam: () => void;
  onOpenVault: () => void;
  editableTeams: Array<{ id: string; name: string; club_id: string }> | undefined;
  readOnlyTeams: Array<{ id: string; name: string; club_id: string }> | undefined;
  onOpenPitchBoard: (
    teamId: string,
    teamName: string,
    readOnly: boolean,
  ) => void;
  userId?: string;
  onAccountRecovered: () => void;
  memberInviteOpen: boolean;
  onMemberInviteOpenChange: (open: boolean) => void;
}

export function HomeDashboardOverview({
  firstName,
  email,
  activeClubName,
  activeClubFilter,
  isNewUserEmptyState,
  userRoles,
  canAccessVault,
  isAppAdmin,
  hasProContext,
  showContent,
  events,
  eventsLoading,
  onNextUpReadyChange,
  onMyTeamsReadyChange,
  onInvite,
  onJoinTeam,
  onOpenVault,
  editableTeams,
  readOnlyTeams,
  onOpenPitchBoard,
  userId,
  onAccountRecovered,
  memberInviteOpen,
  onMemberInviteOpenChange,
}: HomeDashboardOverviewProps) {
  const hasTeams = !!userRoles?.some((role) => role.team_id);
  const canCreateTeam = !!userRoles?.some(
    (role) =>
      (role.role === "club_admin" &&
        (!activeClubFilter || role.club_id === activeClubFilter)) ||
      role.role === "app_admin",
  );
  const canCreateEvent = !!userRoles?.some((role) =>
    ["app_admin", "club_admin", "team_admin", "coach", "committee_member"].includes(
      role.role,
    ),
  );

  return (
    <>
      <div className="px-1 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            Welcome, {firstName}! 👋
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Here's what's coming up
            {activeClubName ? ` @ ${activeClubName}` : ""}
          </p>
        </div>
        {!isNewUserEmptyState && (
          <div className="lg:hidden">
            <HomeQuickActionsFab
              onInvite={onInvite}
              onJoinTeam={onJoinTeam}
              hasTeams={hasTeams}
              canCreateTeam={canCreateTeam}
              canCreateEvent={canCreateEvent}
              canAccessVault={canAccessVault}
              isAppAdmin={isAppAdmin}
              activeClubFilter={activeClubFilter}
              activeClubName={activeClubName}
              hasProContext={hasProContext}
            />
          </div>
        )}
      </div>

      {!isNewUserEmptyState && (
        <DesktopActionBar
          onInvite={onInvite}
          onJoinTeam={onJoinTeam}
          hasTeams={hasTeams}
          canCreateTeam={canCreateTeam}
          canCreateEvent={canCreateEvent}
          isAppAdmin={isAppAdmin}
          activeClubFilter={activeClubFilter}
        />
      )}

      {isNewUserEmptyState && (
        <HomeWelcomeGetStarted
          firstName={firstName}
          email={email}
          onFindOrJoin={onJoinTeam}
        />
      )}

      <div className="relative [overflow-anchor:none]">
        {!showContent && <HomeInitialSkeleton />}
        <div
          className={
            showContent
              ? "space-y-5 soft-reveal"
              : "absolute inset-x-0 top-0 space-y-5 opacity-0 pointer-events-none"
          }
          aria-hidden={!showContent}
        >
          <NextUpCarousel
            events={events}
            isLoading={eventsLoading}
            onReadyChange={onNextUpReadyChange}
          />
          <Suspense fallback={<HomeMyTeamsSkeleton />}>
            <MyTeamsPremiumCarousel
              onReadyChange={onMyTeamsReadyChange}
            />
          </Suspense>
          <Suspense fallback={null}>
            <ClubNewsSection />
          </Suspense>
          <Suspense fallback={null}>
            <ClubLinksSection />
          </Suspense>
          {canAccessVault && (
            <Card
              className="border overflow-hidden cursor-pointer bg-card"
              role="button"
              tabIndex={0}
              aria-label="Open club files"
              onClick={onOpenVault}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onOpenVault();
              }}
            >
              <CardContent className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary shrink-0">
                    <FolderOpen className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-foreground">
                      Club Files
                    </p>
                    <p className="text-[12px] text-muted-foreground truncate">
                      Forms, policies & documents
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {showContent && (
        <>
          <HomeGameTimerRuntime
            userRoles={userRoles}
            isAppAdmin={isAppAdmin}
            editableTeams={editableTeams}
            readOnlyTeams={readOnlyTeams}
            onOpenPitchBoard={onOpenPitchBoard}
          />
          <MiniLeagueGameWidgets activeClubFilter={activeClubFilter} />
          {userId && (
            <Suspense fallback={null}>
              <AccountRecoveryBanner
                userId={userId}
                onRecovered={onAccountRecovered}
              />
            </Suspense>
          )}
          <Suspense fallback={null}>
            <NativeAppDownloadBanner />
          </Suspense>
          {memberInviteOpen && (
            <Suspense fallback={null}>
              <HomeInviteFlow
                open={memberInviteOpen}
                onOpenChange={onMemberInviteOpenChange}
              />
            </Suspense>
          )}
          <LazyMount minHeight={60}>
            <UpcomingClassesWidget />
          </LazyMount>
          <LazyMount minHeight={48}>
            <ContactClubButton clubFilter={activeClubFilter} compact />
          </LazyMount>
        </>
      )}
    </>
  );
}
