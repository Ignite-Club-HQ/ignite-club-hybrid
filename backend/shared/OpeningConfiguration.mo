import Principal "mo:core/Principal";
module {
  public func optional(id : ?Principal) : Text { switch (id) { case (?p) p.toText(); case null "" } };
};