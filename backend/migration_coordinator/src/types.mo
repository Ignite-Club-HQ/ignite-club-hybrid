module {
  public type Phase = {
    #started;
    #exported;
    #imported;
    #verified;
    #committed;
    #aborted;
  };

  public type Migration = {
    id : Nat;
    domain : Text;
    source : Principal;
    destination : Principal;
    schemaVersion : Nat;
    recordCount : Nat;
    checksum : Text;
    phase : Phase;
  };
}
