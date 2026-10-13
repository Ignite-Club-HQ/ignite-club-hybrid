import Types "../../types";

module {
  // Adds the on-chain vault backups map (governor/app-admin only — see
  // create_backup/list_backups/get_backup/restore_backup/delete_backup in
  // main.mo) and the counter used to mint backup ids.
  public func migration(_ : {}) : { var backups : [Types.Backup]; var nextBackupSeq : Nat64 } {
    { var backups = []; var nextBackupSeq = 0 }
  };
};
