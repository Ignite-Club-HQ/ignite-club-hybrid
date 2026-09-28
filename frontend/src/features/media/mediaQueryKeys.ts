export type MediaFeedKeyOptions = {
  userId: string | undefined;
  clubId: string | null;
  teamId: string | null;
  eventId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  cardId: string | null;
  cardPhotoIdsSignature: string;
};

export const mediaKeys = {
  roles: (userId: string | undefined) => ["user-roles-media", userId] as const,
  proAccess: () => ["has-pro-access"] as const,
  proAccessFor: (
    userId: string | undefined,
    clubIdsSignature?: string,
    teamIdsSignature?: string,
    activeClubId?: string | null,
  ) => clubIdsSignature === undefined && teamIdsSignature === undefined
    ? ["has-pro-access", userId] as const
    : ["has-pro-access", userId, clubIdsSignature, teamIdsSignature, activeClubId ?? null] as const,
  profile: (userId: string | undefined) => ["user-profile-media", userId] as const,
  filterClubs: (userId: string | undefined) => ["media-filter-clubs", userId] as const,
  filterTeams: (userId: string | undefined) => ["media-filter-teams", userId] as const,
  cardPhotoIds: (cardId: string | null) => ["gallery-chat-card-photo-ids", cardId] as const,
  feeds: (userId: string | undefined) => ["photos", userId] as const,
  feed: (options: MediaFeedKeyOptions) => [
    "photos",
    options.userId,
    options.clubId,
    options.teamId,
    options.eventId,
    options.dateFrom,
    options.dateTo,
    options.cardId,
    options.cardPhotoIdsSignature,
  ] as const,
  highlightedPhoto: (userId: string | undefined, photoId: string | null) =>
    ["highlighted-photo", userId, photoId] as const,
  reactions: (userId: string | undefined) => ["photo-reactions", userId] as const,
  reactionsBucket: (userId: string | undefined, photoCountBucket: number) =>
    ["photo-reactions", userId, photoCountBucket] as const,
  comments: (userId: string | undefined) => ["photo-comments", userId] as const,
  commentsBucket: (userId: string | undefined, photoCountBucket: number) =>
    ["photo-comments", userId, photoCountBucket] as const,
};
