import Types "../../types";
// Adds on-chain PlayHQ team fixture sync state (purely additive).
module {
  public func migration(_ : {}) : {
    var playhqTeamSyncs : [Types.PlayHQTeamSync];
    var playhqEventLinks : [Types.PlayHQEventLink];
  } {
    { var playhqTeamSyncs = []; var playhqEventLinks = [] }
  };
};
