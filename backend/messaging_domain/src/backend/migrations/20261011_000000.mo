// Adds per-group join policy + category so club groups can be opened for
// discovery (Supabase chat_groups.join_policy/category parity).
module {
  public func migration(_ : {}) : { var groupJoinPolicies : [{ conversation_id : Text; join_policy : Text; category : ?Text }] } {
    { var groupJoinPolicies = [] }
  };
};
