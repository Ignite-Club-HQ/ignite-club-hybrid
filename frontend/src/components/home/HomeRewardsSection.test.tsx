import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  HomeRewardsSection,
  type HomeReward,
} from "./HomeRewardsSection";

const reward: HomeReward = {
  id: "reward-1",
  name: "Free drink",
  points_required: 50,
};

function renderSection(overrides: Partial<Parameters<typeof HomeRewardsSection>[0]> = {}) {
  const props: Parameters<typeof HomeRewardsSection>[0] = {
    isRewardsProLocked: false,
    latestPendingRedemption: undefined,
    minRewardThreshold: 50,
    myPoints: 100,
    myPointsLoading: false,
    showProBadge: false,
    pointsDisplayName: "Reward Points",
    rewardQROpen: false,
    rewardsDialogOpen: false,
    selectedRewardClubId: null,
    rewardsLoading: false,
    availableRewards: [reward],
    rewardClubs: [{ id: "club-1", name: "Ignite FC", hasPro: true }],
    isAppAdmin: false,
    userChildren: [],
    selectedReward: null,
    confirmRedeemDialogOpen: false,
    selectedRedeemFor: "myself",
    redeemPending: false,
    hasProAccess: true,
    userRoles: [],
    userClubs: [{ id: "club-1", name: "Ignite FC", sport: "soccer" }],
    upgradeDialogOpen: false,
    selectedUpgradeClub: "",
    claimDialogOpen: false,
    claimPending: false,
    user: { id: "user-1" },
    userName: "Alex",
    redeemAttemptKeyRef: createRef<string | null>(),
    childPointsFor: (child) => child.ignite_points || 0,
    onOpenPointsHistory: vi.fn(),
    onUpgrade: vi.fn(),
    onBrowseRewards: vi.fn(),
    onRewardQROpenChange: vi.fn(),
    onClaimDialogOpenChange: vi.fn(),
    onRewardsDialogOpenChange: vi.fn(),
    onSelectedRewardClubIdChange: vi.fn(),
    onSelectReward: vi.fn(),
    onConfirmRedeemDialogOpenChange: vi.fn(),
    onClearSelectedReward: vi.fn(),
    onSelectedRedeemForChange: vi.fn(),
    onRedeem: vi.fn(),
    onUpgradeDialogOpenChange: vi.fn(),
    onSelectedUpgradeClubChange: vi.fn(),
    onContinueUpgrade: vi.fn(),
    onClaim: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<HomeRewardsSection {...props} />) };
}

describe("HomeRewardsSection", () => {
  it("opens points history from the unlocked summary card", () => {
    const { props } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "View points and rewards" }));
    expect(props.onOpenPointsHistory).toHaveBeenCalledOnce();
  });

  it("routes locked rewards to the upgrade action", () => {
    const { props } = renderSection({ isRewardsProLocked: true });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Upgrade to Pro to unlock club rewards",
      }),
    );
    expect(props.onUpgrade).toHaveBeenCalledOnce();
    expect(props.onOpenPointsHistory).not.toHaveBeenCalled();
  });

  it("forwards affordable reward selection but disables unaffordable rewards", () => {
    const onSelectReward = vi.fn();
    const { rerender, props } = renderSection({
      rewardsDialogOpen: true,
      selectedRewardClubId: "club-1",
      onSelectReward,
    });
    fireEvent.click(screen.getByRole("button", { name: /Free drink/ }));
    expect(onSelectReward).toHaveBeenCalledWith(reward);

    rerender(
      <HomeRewardsSection
        {...props}
        myPoints={0}
        userChildren={[]}
      />,
    );
    expect(screen.getByRole("button", { name: /Free drink/ })).toBeDisabled();
  });

  it("creates one idempotency key per redemption attempt", () => {
    const redeemAttemptKeyRef = createRef<string | null>();
    const onRedeem = vi.fn();
    renderSection({
      selectedReward: reward,
      confirmRedeemDialogOpen: true,
      redeemAttemptKeyRef,
      onRedeem,
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const firstKey = redeemAttemptKeyRef.current;
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(firstKey).toBeTruthy();
    expect(onRedeem).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ reward, idempotencyKey: firstKey }),
    );
    expect(onRedeem).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: firstKey }),
    );
  });
});
