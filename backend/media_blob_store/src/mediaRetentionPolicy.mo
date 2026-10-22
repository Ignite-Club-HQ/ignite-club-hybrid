module {
  public func mayDelete(premium : ?Bool, originalStamp : Int, currentStamp : Int, now : Int, retention : Int) : Bool {
    premium == ?false and originalStamp == currentStamp and now - currentStamp > retention
  };
};