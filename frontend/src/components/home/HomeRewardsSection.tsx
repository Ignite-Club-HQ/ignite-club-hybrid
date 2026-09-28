import { Suspense, type MutableRefObject } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Crown,
  Flame,
  Gift,
  Loader2,
  Lock,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { getSportEmoji } from "@/lib/sportEmojis";

const RewardClaimQRDialog = lazyWithRetry(() =>
  import("@/components/RewardClaimQRDialog").then((module) => ({
    default: module.RewardClaimQRDialog,
  })),
);

export interface HomeReward {
  id: string;
  name: string;
  description?: string | null;
  points_required: number;
  sponsors?: { name?: string | null } | null;
}

export interface HomeRewardChild {
  id: string;
  name: string;
  ignite_points?: number | null;
}

export interface HomeRewardClub {
  id: string;
  name: string;
  sport?: string | null;
  hasPro?: boolean;
}

export interface HomePendingRedemption {
  id: string;
  club_id: string;
  club_rewards?: {
    name?: string | null;
    qr_code_url?: string | null;
  } | null;
  clubs?: { name?: string | null } | null;
}

interface HomeRewardsSectionProps {
  isRewardsProLocked: boolean;
  latestPendingRedemption: HomePendingRedemption | undefined;
  minRewardThreshold: number | null;
  myPoints: number;
  myPointsLoading: boolean;
  showProBadge: boolean;
  pointsDisplayName: string;
  rewardQROpen: boolean;
  rewardsDialogOpen: boolean;
  selectedRewardClubId: string | null;
  rewardsLoading: boolean;
  availableRewards: HomeReward[];
  rewardClubs: HomeRewardClub[];
  isAppAdmin: boolean;
  userChildren: HomeRewardChild[];
  selectedReward: HomeReward | null;
  confirmRedeemDialogOpen: boolean;
  selectedRedeemFor: string;
  redeemPending: boolean;
  hasProAccess: boolean | undefined;
  userRoles: Array<{ role: string }> | undefined;
  userClubs: HomeRewardClub[];
  upgradeDialogOpen: boolean;
  selectedUpgradeClub: string;
  claimDialogOpen: boolean;
  claimPending: boolean;
  user?: { id: string } | null;
  userName?: string;
  redeemAttemptKeyRef: MutableRefObject<string | null>;
  childPointsFor: (child: HomeRewardChild) => number;
  onOpenPointsHistory: () => void;
  onUpgrade: () => void;
  onBrowseRewards: () => void;
  onRewardQROpenChange: (open: boolean) => void;
  onClaimDialogOpenChange: (open: boolean) => void;
  onRewardsDialogOpenChange: (open: boolean) => void;
  onSelectedRewardClubIdChange: (clubId: string | null) => void;
  onSelectReward: (reward: HomeReward) => void;
  onConfirmRedeemDialogOpenChange: (open: boolean) => void;
  onClearSelectedReward: () => void;
  onSelectedRedeemForChange: (value: string) => void;
  onRedeem: (input: {
    reward: HomeReward;
    forChildId: string | null;
    idempotencyKey: string;
  }) => void;
  onUpgradeDialogOpenChange: (open: boolean) => void;
  onSelectedUpgradeClubChange: (clubId: string) => void;
  onContinueUpgrade: () => void;
  onClaim: (redemption: {
    id: string;
    club_id: string;
    reward_name: string;
  }) => void;
}

export function HomeRewardsSection({
  isRewardsProLocked,
  latestPendingRedemption,
  minRewardThreshold,
  myPoints,
  myPointsLoading,
  showProBadge,
  pointsDisplayName,
  rewardQROpen,
  rewardsDialogOpen,
  selectedRewardClubId,
  rewardsLoading,
  availableRewards,
  rewardClubs,
  isAppAdmin,
  userChildren,
  selectedReward,
  confirmRedeemDialogOpen,
  selectedRedeemFor,
  redeemPending,
  hasProAccess,
  userRoles,
  userClubs,
  upgradeDialogOpen,
  selectedUpgradeClub,
  claimDialogOpen,
  claimPending,
  user,
  userName,
  redeemAttemptKeyRef,
  childPointsFor,
  onOpenPointsHistory,
  onUpgrade,
  onBrowseRewards,
  onRewardQROpenChange,
  onClaimDialogOpenChange,
  onRewardsDialogOpenChange,
  onSelectedRewardClubIdChange,
  onSelectReward,
  onConfirmRedeemDialogOpenChange,
  onClearSelectedReward,
  onSelectedRedeemForChange,
  onRedeem,
  onUpgradeDialogOpenChange,
  onSelectedUpgradeClubChange,
  onContinueUpgrade,
  onClaim,
}: HomeRewardsSectionProps) {
  const proRewardClubs = rewardClubs.filter(
    (club) => isAppAdmin || club.hasPro,
  );
  const eligibleChildren = userChildren.filter(
    (child) =>
      childPointsFor(child) >= (selectedReward?.points_required || 0),
  );

  const handleRewardsDialogChange = (open: boolean) => {
    onRewardsDialogOpenChange(open);
    if (!open) onSelectedRewardClubIdChange(null);
  };
  const handleConfirmRedeemDialogChange = (open: boolean) => {
    if (redeemPending) return;
    onConfirmRedeemDialogOpenChange(open);
    if (!open) {
      onClearSelectedReward();
      onSelectedRedeemForChange("myself");
      redeemAttemptKeyRef.current = null;
    }
  };
  const handleRedeem = () => {
    if (!selectedReward) return;
    if (!redeemAttemptKeyRef.current) {
      redeemAttemptKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    onRedeem({
      reward: selectedReward,
      forChildId: selectedRedeemFor === "myself" ? null : selectedRedeemFor,
      idempotencyKey: redeemAttemptKeyRef.current,
    });
  };

  return (
    <>
      <section aria-label="Points and rewards">
        <Card
          className={`border overflow-hidden cursor-pointer ${
            isRewardsProLocked
              ? "bg-muted/30 border-dashed"
              : "bg-primary/[0.06]"
          }`}
          role="button"
          tabIndex={0}
          aria-label={
            isRewardsProLocked
              ? "Upgrade to Pro to unlock club rewards"
              : "View points and rewards"
          }
          onClick={isRewardsProLocked ? onUpgrade : onOpenPointsHistory}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            isRewardsProLocked ? onUpgrade() : onOpenPointsHistory();
          }}
        >
          <CardContent className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div
                className={`p-1.5 rounded-lg shrink-0 ${
                  isRewardsProLocked ? "bg-muted" : "bg-primary/15"
                }`}
              >
                {isRewardsProLocked ? (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <Flame className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {latestPendingRedemption && !isRewardsProLocked ? (
                  <p className="text-sm font-semibold leading-tight text-primary truncate">
                    🎁 Ready to claim: {latestPendingRedemption.club_rewards?.name}
                  </p>
                ) : minRewardThreshold !== null &&
                  myPoints >= minRewardThreshold &&
                  !isRewardsProLocked ? (
                  <p className="text-sm font-semibold leading-tight text-primary">
                    🎉 Rewards Available
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold leading-tight">
                      {isRewardsProLocked ? "Member Rewards" : pointsDisplayName}
                    </p>
                    {isRewardsProLocked && (
                      <Badge
                        variant="outline"
                        className="text-[10px] h-4 px-1.5 shrink-0"
                      >
                        Pro Only
                      </Badge>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                  {isRewardsProLocked ? (
                    "Earn points for RSVPs, volunteering & participation"
                  ) : myPointsLoading ? (
                    <span
                      className="inline-block h-3 w-16 align-middle rounded bg-muted animate-pulse"
                      aria-label="Loading points"
                    />
                  ) : (
                    `${myPoints} Point${myPoints === 1 ? "" : "s"}${
                      showProBadge ? " · Pro" : ""
                    }`
                  )}
                </p>
              </div>
              {latestPendingRedemption && !isRewardsProLocked ? (
                <Button
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600 text-white gap-1.5 h-8 text-xs font-medium shrink-0"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClaimDialogOpenChange(true);
                  }}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Claim
                </Button>
              ) : isRewardsProLocked ? (
                <Button
                  size="sm"
                  className="gap-1 h-8 text-xs font-medium shrink-0 px-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUpgrade();
                  }}
                >
                  <Crown className="h-3.5 w-3.5" />
                  Upgrade
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-1 h-8 text-xs font-medium text-primary shrink-0 px-2"
                  onClick={(event) => {
                    event.stopPropagation();
                    onBrowseRewards();
                  }}
                >
                  View Rewards
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {latestPendingRedemption && user && rewardQROpen && (
        <Suspense fallback={null}>
          <RewardClaimQRDialog
            open={rewardQROpen}
            onOpenChange={onRewardQROpenChange}
            rewardName={latestPendingRedemption.club_rewards?.name || "Reward"}
            clubName={latestPendingRedemption.clubs?.name || "Club"}
            redemptionId={latestPendingRedemption.id}
            qrCodeUrl={
              latestPendingRedemption.club_rewards?.qr_code_url || null
            }
            userName={userName}
            userId={user.id}
          />
        </Suspense>
      )}

      <ResponsiveDialog
        open={rewardsDialogOpen}
        onOpenChange={handleRewardsDialogChange}
      >
        <ResponsiveDialogContent className="max-w-md sm:max-h-[85vh]">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5" />
              {selectedRewardClubId ? "Available Rewards" : "Select Club"}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              {selectedRewardClubId
                ? `You have ${myPoints} points${
                    userChildren.length > 0 ? " (+ children's points)" : ""
                  }`
                : "Choose a club to view rewards"}
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="flex-1 overflow-y-auto space-y-3 pt-2 pb-4">
            {!selectedRewardClubId ? (
              <div className="space-y-2">
                {proRewardClubs.map((club) => (
                  <button
                    key={club.id}
                    onClick={() => onSelectedRewardClubIdChange(club.id)}
                    className="flex items-center justify-between w-full p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left"
                  >
                    <span className="font-medium">{club.name}</span>
                    <Gift className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
                {proRewardClubs.length === 0 && (
                  <p className="text-center text-muted-foreground py-4">
                    No clubs with Pro subscription found.
                  </p>
                )}
              </div>
            ) : rewardsLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : availableRewards.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No rewards available yet. Check back later!
              </p>
            ) : (
              <div className="space-y-2">
                {availableRewards.map((reward) => {
                  const canAfford =
                    myPoints >= reward.points_required ||
                    userChildren.some(
                      (child) =>
                        childPointsFor(child) >= reward.points_required,
                    );
                  return (
                    <button
                      key={reward.id}
                      onClick={() => canAfford && onSelectReward(reward)}
                      disabled={!canAfford}
                      className={`flex items-center justify-between w-full p-3 rounded-lg text-left transition-colors ${
                        canAfford
                          ? "bg-muted/50 hover:bg-muted cursor-pointer"
                          : "bg-muted/20 opacity-60 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{reward.name}</span>
                          {reward.sponsors?.name && (
                            <Badge variant="outline" className="text-xs">
                              {reward.sponsors.name}
                            </Badge>
                          )}
                        </div>
                        {reward.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {reward.description}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={canAfford ? "default" : "secondary"}
                        className="ml-2 shrink-0"
                      >
                        {reward.points_required} pts
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <AlertDialog
        open={confirmRedeemDialogOpen}
        onOpenChange={handleConfirmRedeemDialogChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Redeem Reward?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm redemption of <strong>{selectedReward?.name}</strong> for{" "}
              <strong>{selectedReward?.points_required} points</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {eligibleChildren.length > 0 && (
            <div className="space-y-2 py-2">
              <Label>Redeem for</Label>
              <Select
                value={selectedRedeemFor}
                onValueChange={onSelectedRedeemForChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="myself">Myself ({myPoints} pts)</SelectItem>
                  {eligibleChildren.map((child) => (
                    <SelectItem key={child.id} value={child.id}>
                      {child.name} ({childPointsFor(child)} pts)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={redeemPending}>Cancel</AlertDialogCancel>
            <Button onClick={handleRedeem} disabled={redeemPending}>
              {redeemPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Gift className="h-4 w-4 mr-2" />
              )}
              {redeemPending ? "Redeeming..." : "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {hasProAccess === false &&
        userRoles &&
        userRoles.length > 0 &&
        userClubs.length > 0 && (
          <Card className="border-primary/30 bg-gradient-to-r from-primary/10 to-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-primary/20">
                    <Crown className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">
                      {userRoles.some(
                        ({ role }) =>
                          role === "club_admin" || role === "team_admin",
                      )
                        ? "Unlock Pro Features"
                        : "Pro Features Available"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {userRoles.some(
                        ({ role }) =>
                          role === "club_admin" || role === "team_admin",
                      )
                        ? "Get access to Vault, Media, Rewards & more"
                        : "Contact your club or team admin to unlock Pro features"}
                    </p>
                  </div>
                </div>
                {userRoles.some(
                  ({ role }) =>
                    role === "club_admin" || role === "team_admin",
                ) && (
                  <Button size="sm" className="shrink-0" onClick={onUpgrade}>
                    Upgrade
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

      <ResponsiveDialog
        open={upgradeDialogOpen}
        onOpenChange={onUpgradeDialogOpenChange}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Select Club to Upgrade</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Choose which club you'd like to upgrade to Pro.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Select Club</Label>
              <Select
                value={selectedUpgradeClub}
                onValueChange={onSelectedUpgradeClubChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a club..." />
                </SelectTrigger>
                <SelectContent>
                  {userClubs.map((club) => (
                    <SelectItem key={club.id} value={club.id}>
                      <span className="flex items-center gap-2">
                        <span>{getSportEmoji(club.sport || null)}</span>
                        {club.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              className="w-full sm:w-auto"
              onClick={onContinueUpgrade}
              disabled={!selectedUpgradeClub}
            >
              Continue to Upgrade
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <AlertDialog
        open={claimDialogOpen}
        onOpenChange={(open) => {
          if (!claimPending) onClaimDialogOpenChange(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Reward as Claimed?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm that{" "}
              <strong>{latestPendingRedemption?.club_rewards?.name}</strong> has
              been given to the member.
              <br />
              <br />
              This will mark the reward as fulfilled and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={claimPending}>Cancel</AlertDialogCancel>
            <Button
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!latestPendingRedemption) return;
                onClaim({
                  id: latestPendingRedemption.id,
                  club_id: latestPendingRedemption.club_id,
                  reward_name:
                    latestPendingRedemption.club_rewards?.name || "reward",
                });
              }}
              disabled={claimPending}
            >
              {claimPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              {claimPending ? "Confirming..." : "Confirm Claimed"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
