module {
  type Settings = { competition_id : Text; enabled : Bool; subject : Text; message : Text };
  public func migration(_ : {}) : { var competitionWelcomeSettings : [Settings] } {
    { var competitionWelcomeSettings = [] }
  };
}