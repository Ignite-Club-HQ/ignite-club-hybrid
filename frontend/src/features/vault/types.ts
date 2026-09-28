export type VaultFolderView =
  | { type: "root" }
  | {
      type: "club";
      clubId: string;
      clubName: string;
      folderId?: string;
      folderName?: string;
    }
  | {
      type: "team";
      clubId: string;
      clubName: string;
      teamId: string;
      teamName: string;
      folderId?: string;
      folderName?: string;
    }
  | {
      type: "mini-league";
      clubId: string;
      clubName: string;
      miniLeagueId: string;
      miniLeagueName: string;
      folderId?: string;
      folderName?: string;
    };

export type VaultScope = {
  clubId: string | null;
  teamId: string | null;
  miniLeagueId: string | null;
  folderId: string | null;
};

export type VaultRoleRecord = {
  role?: string | null;
  club_id?: string | null;
  team_id?: string | null;
};

export type VaultSubscriptionRecord = {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
};

export type VaultFolderVisibilityRecord = {
  name: string;
  restricted_roles: string[] | null;
};
