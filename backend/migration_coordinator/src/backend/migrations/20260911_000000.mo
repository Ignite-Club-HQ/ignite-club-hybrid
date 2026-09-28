module {
  type OldActor = {};

  type Phase = {
    #started;
    #exported;
    #imported;
    #verified;
    #committed;
    #aborted;
  };

  type Migration = {
    id : Nat;
    domain : Text;
    source : Principal;
    destination : Principal;
    schemaVersion : Nat;
    recordCount : Nat;
    checksum : Text;
    phase : Phase;
  };

  type NewActor = {
    var governor : ?Principal;
    var nextId : Nat;
    var active : ?Migration;
    var completed : [Migration];
  };

  public func migration(_old : OldActor) : NewActor {
    {
      var governor = null;
      var nextId = 0;
      var active = null;
      var completed = [];
    }
  };
};
