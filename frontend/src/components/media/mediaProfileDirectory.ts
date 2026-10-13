interface MediaDirectoryProfile {
  account_id: string;
  display_name: string;
  avatar_ref: [] | [string];
}

/** Preserve saved photos when adapting ICP directory profiles for media. */
export function mediaProfileDirectory(profiles: readonly MediaDirectoryProfile[]) {
  return new Map(profiles.map((profile) => [profile.account_id, {
    display_name: profile.display_name || null,
    avatar_url: profile.avatar_ref[0] || null,
  }]));
}