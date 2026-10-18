import Principal "mo:core/Principal";
module {
  type CompetitionEventOperation = { operation_id : Text; competition_id : Text; event_ids : [Text] };
  type OldActor = {};
  type NewActor = {
    var competitionDomainCanister : ?Principal;
    var competitionEventOperations : [CompetitionEventOperation];
  };

  public func migration(_ : OldActor) : NewActor {
    { var competitionDomainCanister = null; var competitionEventOperations = [] }
  };
};