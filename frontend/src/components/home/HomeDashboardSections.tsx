import type { ComponentProps } from "react";
import { HomeJoinTeamDialog } from "./HomeJoinTeamDialog";
import { HomePitchBoardRuntime } from "./HomePitchBoardRuntime";
import { HomeRewardsSection } from "./HomeRewardsSection";
import { HomeSponsorSections } from "./HomeSponsorSections";

type JoinTeamDialogProps = ComponentProps<typeof HomeJoinTeamDialog>;
type RewardsSectionProps = ComponentProps<typeof HomeRewardsSection>;
type SponsorSectionsProps = ComponentProps<typeof HomeSponsorSections>;
type PitchBoardRuntimeProps = ComponentProps<typeof HomePitchBoardRuntime>;

interface HomeDashboardSectionsProps {
  joinTeamDialog: JoinTeamDialogProps;
  rewards: RewardsSectionProps;
  sponsors: SponsorSectionsProps;
  pitchBoard: PitchBoardRuntimeProps;
}

export function HomeDashboardSections({
  joinTeamDialog,
  rewards,
  sponsors,
  pitchBoard,
}: HomeDashboardSectionsProps) {
  return (
    <>
      <HomeJoinTeamDialog {...joinTeamDialog} />
      <HomeRewardsSection {...rewards} />
      <HomeSponsorSections {...sponsors} />
      <HomePitchBoardRuntime {...pitchBoard} />
    </>
  );
}
