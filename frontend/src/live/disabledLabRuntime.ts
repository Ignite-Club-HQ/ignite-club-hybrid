import type {
  JoinToken,
  Match,
  Season,
  TeamEntry,
} from "@/lab/bindings/competition_domain/declarations/competition_domain.did.js";

export interface LocalCompetitionSummary {
  id: string;
  name: string;
  sport: string | null;
  season: string;
  status: string;
  visibility: string;
  organizer_club_id: string;
  source: string;
  last_synced_at: string | null;
  clubs: { name: string } | null;
  competition_entries: unknown[];
  revision: bigint;
}

export interface LocalCompetitionState {
  competition: LocalCompetitionSummary;
  entries: TeamEntry[];
  seasons: Season[];
  matches: Match[];
  joinTokens: JoinToken[];
}

// Callers only reach these in fixture/lab branches that the live runtime never
// selects, so the loose signature keeps their existing call sites type-valid.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const disabled = (..._args: unknown[]): any => {
  throw new Error("Local fixture and synthetic-identity services are disabled in the live application.");
};

export const personas: string[] = [];
export const isLocalEventsCanisterUnavailable = (_error?: unknown) => true;
export const isLocalCompetitionCanisterUnavailable = (_error?: unknown) => true;
export const resetLocalIdentityAccessClient = () => undefined;
export const resetLocalMediaMetadataClient = () => undefined;

export {
  disabled as claimLocalCompetitionJoinToken,
  disabled as connectLocalActor,
  disabled as connectLocalActorWithConfig,
  disabled as connectLocalDomainActor,
  disabled as connectLocalIdentityAccessClient,
  disabled as connectLocalIdentityAccessClientWithIdentity,
  disabled as connectLocalMediaMetadataClient,
  disabled as createCompetitionDomainClient,
  disabled as createEventsDomainClient,
  disabled as createLocalActor,
  disabled as createLocalAgent,
  disabled as createLocalAgentWithIdentity,
  disabled as createLocalCompetition,
  disabled as createLocalCompetitionSeason,
  disabled as createLocalEvent,
  disabled as exportLocalEventsState,
  disabled as fetchLocalLabConfig,
  disabled as getFixtureClubDetail,
  disabled as getFixtureClubProStatus,
  disabled as getFixtureTeamDetail,
  disabled as getFixtureUpcomingEvents,
  disabled as getFixtureUserClubs,
  disabled as getFixtureUserTeams,
  disabled as getLocalCompetition,
  disabled as getLocalCompetitionState,
  disabled as getLocalEvent,
  disabled as getLocalLabActiveGames,
  disabled as getLocalLabAdminChatMessages,
  disabled as getLocalLabAppSettings,
  disabled as getLocalLabAssociationDetail,
  disabled as getLocalLabAssociations,
  disabled as getLocalLabAttendanceStats,
  disabled as getLocalLabBroadcast,
  disabled as getLocalLabBroadcastMessages,
  disabled as getLocalLabChatClub,
  disabled as getLocalLabChatTeam,
  disabled as getLocalLabChildren,
  disabled as getLocalLabClaimableTeam,
  disabled as getLocalLabClassEnrolment,
  disabled as getLocalLabClubDetail,
  disabled as getLocalLabClubEngagementAnalytics,
  disabled as getLocalLabClubLink,
  disabled as getLocalLabClubList,
  disabled as getLocalLabClubMessages,
  disabled as getLocalLabCompetitionSettings,
  disabled as getLocalLabDeletedChats,
  disabled as getLocalLabDirectConversation,
  disabled as getLocalLabDirectMessages,
  disabled as getLocalLabDmAttachments,
  disabled as getLocalLabEoiSubmissions,
  disabled as getLocalLabEventGroupPitch,
  disabled as getLocalLabEventList,
  disabled as getLocalLabFeedback,
  disabled as getLocalLabGroup,
  disabled as getLocalLabGroupMessages,
  disabled as getLocalLabHomeSnapshot,
  disabled as getLocalLabLeaderboard,
  disabled as getLocalLabMediaItems,
  disabled as getLocalLabMessagesSnapshot,
  disabled as getLocalLabMiniLeagueDetail,
  disabled as getLocalLabMiniLeagues,
  disabled as getLocalLabNewsPost,
  disabled as getLocalLabNewsPosts,
  disabled as getLocalLabNotifications,
  disabled as getLocalLabOnlineUsers,
  disabled as getLocalLabPlayerStatsReport,
  disabled as getLocalLabProfile,
  disabled as getLocalLabPublishableChatPhotos,
  disabled as getLocalLabRewardRedemptions,
  disabled as getLocalLabRewards,
  disabled as getLocalLabRoleRoster,
  disabled as getLocalLabSeasonCompare,
  disabled as getLocalLabSeasonDetail,
  disabled as getLocalLabSeasons,
  disabled as getLocalLabTeamDetail,
  disabled as getLocalLabTeamList,
  disabled as getLocalLabTeamMessages,
  disabled as getLocalLabTeamRoleRoster,
  disabled as getLocalLabUserDirectory,
  disabled as getLocalLabUserRoles,
  disabled as getLocalLabVaultItems,
  disabled as getLocalLabWelcomeMessage,
  disabled as getLocalTeamUnreadCount,
  disabled as issueLocalCompetitionJoinToken,
  disabled as listLocalCompetitions,
  disabled as listLocalEventRsvps,
  disabled as listLocalEvents,
  disabled as listLocalTeamMessages,
  disabled as markLocalTeamRead,
  disabled as recordLocalCompetitionMatch,
  disabled as registerLocalCompetitionTeam,
  disabled as sendLocalTeamMessage,
  disabled as setLocalCompetitionMatchResult,
  disabled as setLocalCompetitionSeasonStatus,
  disabled as setLocalEventAttendance,
  disabled as setLocalEventDuty,
  disabled as setLocalEventRecurrence,
  disabled as setLocalEventRsvp,
  disabled as syntheticIdentity,
  disabled as updateLocalEvent,
  disabled as validateEventTeamClubScope,
  disabled as validateLocalConfig,
  disabled as validateLocalLabConfig,
};
