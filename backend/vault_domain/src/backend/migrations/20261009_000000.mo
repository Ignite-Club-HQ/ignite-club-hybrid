module {
  // Adds pinned-vault records (chat_pinned_vault counterpart).
  public func migration(_ : {}) : { var pinned_vaults : [Types.PinnedVault] } {
    { var pinned_vaults = [] }
  };
};
