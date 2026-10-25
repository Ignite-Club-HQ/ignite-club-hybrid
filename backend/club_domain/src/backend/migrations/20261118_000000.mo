import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : { var familyInvites : [{ request_id : Text; created_by : Principal; primary : Text; secondary : ?Text; children : [Text]; bound_secondary : ?Principal }] } {
    { var familyInvites = [] }
  }
}