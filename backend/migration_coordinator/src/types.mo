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

  // Local, loosely-typed interfaces for domain canisters' export_state. Array
  // element types are declared as `Any` because the coordinator only reads
  // collection sizes (never element contents) to compute recordCount/checksum.
  // This is Candid-subtyping compatible: `Any` maps to Candid's reserved/top
  // type, so a domain's real vec<Record> response decodes fine as vec<Any>.
  public type EventsExport = {
    #Ok : { schema : Nat32; governor : Principal; roles : [Any]; events : [Any]; rsvps : [Any]; attendance : [Any]; lineups : [Any]; duties : [Any]; roster : [Any]; recurrences : [Any] };
    #Err : Text;
  };
  public type EventsDomainActor = actor { export_state : shared query () -> async EventsExport };

  public type CompetitionExport = {
    #Ok : { schema : Nat32; governor : Principal; roles : [Any]; competitions : [Any]; entries : [Any]; tokens : [Any]; seasons : [Any]; matches : [Any] };
    #Err : Text;
  };
  public type CompetitionDomainActor = actor { export_state : shared query () -> async CompetitionExport };

  public type MediaExport = {
    #Ok : { schema : Nat32; governor : Principal; assets : [Any]; capabilities : [Any]; reactions : [Any]; comments : [Any]; roles : [Any] };
    #Err : Text;
  };
  public type MediaMetadataActor = actor { export_state : shared query () -> async MediaExport };

  public type MessagingExport = {
    #Ok : { schema : Nat32; governor : Principal; roles : [Any]; conversations : [Any]; messages : [Any]; receipts : [Any]; unread : [Any] };
    #Err : Text;
  };
  public type MessagingDomainActor = actor { export_state : shared query () -> async MessagingExport };

  // Uniform view of any domain's export evidence, extracted from whichever
  // export shape matched the migration's recorded domain.
  public type Evidence = { schema : Nat32; governor : Principal; sizes : [(Text, Nat)] };
}
