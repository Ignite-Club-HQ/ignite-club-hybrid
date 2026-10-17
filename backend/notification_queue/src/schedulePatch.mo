module {
  // Existing option API: omitted keeps; empty image/zero date clears.
  public func image(previous : ?Text, patch : ?Text) : ?Text {
    switch (patch) { case null { previous }; case (?"") { null }; case _ { patch } }
  };
  public func endDate(previous : ?Nat64, patch : ?Nat64) : ?Nat64 {
    switch (patch) { case null { previous }; case (?0) { null }; case _ { patch } }
  };
}