module {
  public func migration(_ : {}) : { var identityAccessCanister : ?Principal; var identityUnlinkReceipts : [(Text, Principal, Nat64)] } {
    { var identityAccessCanister = null; var identityUnlinkReceipts = [] }
  }
};