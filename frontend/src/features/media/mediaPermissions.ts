export type MediaPermissionRole = {
  role: string;
  club_id: string | null;
  team_id: string | null;
};

export type MediaPermissionPhoto = {
  uploader_id?: string | null;
  club_id?: string | null;
  team_id?: string | null;
};

export function canDeleteMediaPhoto(options: {
  photo: MediaPermissionPhoto;
  userId: string | undefined;
  isAppAdmin: boolean;
  roles: readonly MediaPermissionRole[] | undefined;
}): boolean {
  const { photo, userId, isAppAdmin, roles } = options;
  if (isAppAdmin) return true;
  if (photo.uploader_id === userId) return true;
  if (roles?.some((role) => role.role === "club_admin" && role.club_id === photo.club_id)) {
    return true;
  }
  // Team admins can delete team-level photos only. A club-level photo with no
  // team remains outside their scope even when it belongs to the same club.
  return Boolean(photo.team_id && roles?.some(
    (role) => role.role === "team_admin" && role.team_id === photo.team_id,
  ));
}

export function canShareMediaPhoto(userId: string | undefined): boolean {
  return Boolean(userId);
}
