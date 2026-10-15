module {
  type RoleLink = { competition_id : Text; role : Text; token : Text; revoked : Bool; created_by : Principal; created_at_ms : Nat64 };
  type OfficialChat = { competition_id : Text; scope : Text; conversation_id : Text };
  // Adds referee/committee role join links and the competition-chat-scope ->
  // messaging_domain conversation mapping. No prior rows to backfill.
  public func migration(_ : {}) : {
    var roleLinks : [RoleLink];
    var officialChats : [OfficialChat];
  } {
    { var roleLinks = []; var officialChats = [] }
  };
};
