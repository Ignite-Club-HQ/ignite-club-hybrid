module {
  type CompetitionLadderSetting = { competition_id : Text; hide_ladder : Bool };
  type OldActor = {};
  type NewActor = { var competitionLadderSettings : [CompetitionLadderSetting] };

  public func migration(_ : OldActor) : NewActor {
    { var competitionLadderSettings = [] }
  };
};