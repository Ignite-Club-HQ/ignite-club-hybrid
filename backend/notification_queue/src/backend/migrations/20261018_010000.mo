// Adds identityAccessCanister wiring for caller-account ownership checks on
// inbox reads/mutations (list_inbox, get_notification, mark_read,
// mark_all_read, delete_notification). Fail-closed while unset.
module {
  public func migration(_ : {}) : { var identityAccessCanister : ?Principal } {
    { var identityAccessCanister = null }
  };
};
