// Data shapes only — no Supabase/ICP dependency. Ported (subset) from the
// bundle's vault feature `types.ts`; only the types `vaultAccess.ts` needs
// for its access-decision functions are included here.

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
