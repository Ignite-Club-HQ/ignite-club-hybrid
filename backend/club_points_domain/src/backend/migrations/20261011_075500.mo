import Principal "mo:core/Principal";
module {
  public func migration(_old : {}) : { var clubDomainCanister : ?Principal } {
    { var clubDomainCanister = null };
  };
};