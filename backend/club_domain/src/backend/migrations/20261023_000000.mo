module {
  // Adds on-chain pitch board storage: the named formation library
  // (pitch_formations parity) and per-team pitch alert role switches
  // (team_subscriptions.pitch_notify_* parity).
  type PitchFormation = {
    id : Text;
    team_id : Text;
    club_id : Text;
    name : Text;
    team_size : Nat32;
    formation_json : Text;
    drawing_json : ?Text;
    created_by : Principal;
    created_at_ms : Nat64;
  };
  type PitchNotifyFlags = { team_id : Text; coach : Bool; team_admin : Bool; subs_manager : Bool };

  public func migration(_ : {}) : {
    var pitchFormations : [PitchFormation];
    var pitchNotifyFlags : [PitchNotifyFlags];
  } {
    { var pitchFormations = []; var pitchNotifyFlags = [] }
  };
};
