module {
  public func sameClub(existing : ?Text, requested : Text) : Bool {
    switch (existing) { case null { true }; case (?club) { club == requested } }
  };
  public func targetClub(target : ?(Text, Bool), requested : Text) : Bool {
    switch (target) { case null { false }; case (?(club, deleted)) { club == requested and not deleted } }
  };
}