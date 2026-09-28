import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Array "mo:core/Array";
import Types "types";

persistent actor {
  var governor : ?Principal;
  var nextId : Nat;
  var active : ?Types.Migration;
  var completed : [Types.Migration];

  func authenticated(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous())
  };

  func isGovernor(caller : Principal) : Bool {
    switch (governor) {
      case (?owner) { owner.equal(caller) };
      case null { false };
    }
  };

  func requireGovernor(caller : Principal) {
    if (not authenticated(caller)) { Runtime.trap("Authenticated caller required") };
    if (not isGovernor(caller)) { Runtime.trap("Governor required") };
  };

  func findActive(id : Nat) : Types.Migration {
    switch (active) {
      case (?migration) {
        if (migration.id == id) { migration } else { Runtime.trap("Migration not found") };
      };
      case null { Runtime.trap("No active migration") };
    }
  };

  func setPhase(id : Nat, phase : Types.Phase, recordCount : Nat, checksum : Text) {
    let current = findActive(id);
    active := ?{
      current with
      phase = phase;
      recordCount = recordCount;
      checksum = checksum;
    };
  };

  public shared ({ caller }) func initialize() : async () {
    if (not authenticated(caller)) { Runtime.trap("Authenticated caller required") };
    switch (governor) {
      case (?_) { Runtime.trap("Governor already initialized") };
      case null { governor := ?caller };
    };
  };

  public query func status() : async (?Types.Migration, [Types.Migration]) {
    (active, completed)
  };

  public shared ({ caller }) func begin(
    domain : Text,
    source : Principal,
    destination : Principal,
    schemaVersion : Nat,
    checksum : Text,
  ) : async Types.Migration {
    requireGovernor(caller);
    switch (active) {
      case (?_) { Runtime.trap("Migration already active") };
      case null {};
    };
    if (domain == "" or checksum == "") { Runtime.trap("Domain and checksum required") };
    if (source.equal(destination)) { Runtime.trap("Source and destination must differ") };
    let migration : Types.Migration = {
      id = nextId;
      domain;
      source;
      destination;
      schemaVersion;
      recordCount = 0;
      checksum;
      phase = #started;
    };
    nextId += 1;
    active := ?migration;
    migration
  };

  public shared ({ caller }) func markExported(id : Nat, recordCount : Nat, checksum : Text) : async Types.Migration {
    requireGovernor(caller);
    let current = findActive(id);
    if (current.phase != #started) { Runtime.trap("Invalid export transition") };
    setPhase(id, #exported, recordCount, checksum);
    findActive(id)
  };

  public shared ({ caller }) func markImported(id : Nat, recordCount : Nat, checksum : Text) : async Types.Migration {
    requireGovernor(caller);
    let current = findActive(id);
    if (current.phase != #exported or current.recordCount != recordCount or current.checksum != checksum) {
      Runtime.trap("Import evidence does not match export");
    };
    setPhase(id, #imported, recordCount, checksum);
    findActive(id)
  };

  public shared ({ caller }) func verify(id : Nat, recordCount : Nat, checksum : Text) : async Types.Migration {
    requireGovernor(caller);
    let current = findActive(id);
    if (current.phase != #imported or current.recordCount != recordCount or current.checksum != checksum) {
      Runtime.trap("Verification evidence does not match import");
    };
    setPhase(id, #verified, recordCount, checksum);
    findActive(id)
  };

  public shared ({ caller }) func commit(id : Nat) : async Types.Migration {
    requireGovernor(caller);
    let current = findActive(id);
    if (current.phase != #verified) { Runtime.trap("Migration is not verified") };
    let committed = { current with phase = #committed };
    completed := completed.concat([committed]);
    active := null;
    committed
  };

  public shared ({ caller }) func abort(id : Nat) : async Types.Migration {
    requireGovernor(caller);
    let current = findActive(id);
    let aborted = { current with phase = #aborted };
    completed := completed.concat([aborted]);
    active := null;
    aborted
  };
};
