import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Array "mo:core/Array";
import Text "mo:core/Text";
import Char "mo:core/Char";
import Nat64 "mo:core/Nat64";
import Nat32 "mo:core/Nat32";
import Nat "mo:core/Nat";
import Types "types";

// Local, loosely-typed interfaces for domain canisters' export_state. Array
// element types are declared as `Any` because the coordinator only reads
// collection sizes (never element contents) to compute recordCount/checksum.
// This is Candid-subtyping compatible: `Any` maps to Candid's reserved/top
// type, so a domain's real vec<Record> response decodes fine as vec<Any>.
type EventsExport = {
  #Ok : { schema : Nat32; governor : Principal; roles : [Any]; events : [Any]; rsvps : [Any]; attendance : [Any]; lineups : [Any]; duties : [Any]; roster : [Any]; recurrences : [Any] };
  #Err : Text;
};
type EventsDomainActor = actor { export_state : shared query () -> async EventsExport };

type CompetitionExport = {
  #Ok : { schema : Nat32; governor : Principal; roles : [Any]; competitions : [Any]; entries : [Any]; tokens : [Any]; seasons : [Any]; matches : [Any] };
  #Err : Text;
};
type CompetitionDomainActor = actor { export_state : shared query () -> async CompetitionExport };

type MediaExport = {
  #Ok : { schema : Nat32; governor : Principal; assets : [Any]; capabilities : [Any]; reactions : [Any]; comments : [Any]; roles : [Any] };
  #Err : Text;
};
type MediaMetadataActor = actor { export_state : shared query () -> async MediaExport };

type MessagingExport = {
  #Ok : { schema : Nat32; governor : Principal; roles : [Any]; conversations : [Any]; messages : [Any]; receipts : [Any]; unread : [Any] };
  #Err : Text;
};
type MessagingDomainActor = actor { export_state : shared query () -> async MessagingExport };

// Uniform view of any domain's export evidence, extracted from whichever
// export shape matched the migration's recorded domain.
type Evidence = { schema : Nat32; governor : Principal; sizes : [(Text, Nat)] };

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


  func fnv1a(text : Text) : Text {
    var hash : Nat64 = 14695981039346656037;
    let prime : Nat64 = 1099511628211;
    for (character in Text.toIter(text)) {
      let code : Nat64 = Nat64.fromNat32(Char.toNat32(character));
      hash := (hash ^ code) *% prime;
    };
    Nat64.toText(hash)
  };

  func buildChecksum(schema : Nat32, governor : Principal, sizes : [(Text, Nat)]) : Text {
    var text : Text = Nat32.toText(schema) # "|" # governor.toText();
    for ((name, size) in sizes.values()) {
      text #= "|" # name # "=" # Nat.toText(size);
    };
    fnv1a(text)
  };

  func recordCountOf(sizes : [(Text, Nat)]) : Nat {
    var total = 0;
    for ((_, size) in sizes.values()) { total += size };
    total
  };

  // Fetches export evidence from a domain canister principal, dispatching on
  // the migration's recorded domain name. Traps (via the underlying inter-
  // canister call failure or an explicit trap) if the domain is unsupported
  // or the domain canister rejects the caller (only governor / bulk-access
  // allowlisted principals may call export_state on the domain canisters).
  func fetchEvidence(domain : Text, principal : Principal) : async* Evidence {
    switch (domain) {
      case ("events_domain") {
        let target : EventsDomainActor = actor (Principal.toText(principal));
        switch (await target.export_state()) {
          case (#Err(message)) { Runtime.trap("events_domain export_state failed: " # message) };
          case (#Ok(state)) {
            {
              schema = state.schema;
              governor = state.governor;
              sizes = [
                ("roles", state.roles.size()),
                ("events", state.events.size()),
                ("rsvps", state.rsvps.size()),
                ("attendance", state.attendance.size()),
                ("lineups", state.lineups.size()),
                ("duties", state.duties.size()),
                ("roster", state.roster.size()),
                ("recurrences", state.recurrences.size()),
              ];
            }
          };
        };
      };
      case ("competition_domain") {
        let target : CompetitionDomainActor = actor (Principal.toText(principal));
        switch (await target.export_state()) {
          case (#Err(message)) { Runtime.trap("competition_domain export_state failed: " # message) };
          case (#Ok(state)) {
            {
              schema = state.schema;
              governor = state.governor;
              sizes = [
                ("roles", state.roles.size()),
                ("competitions", state.competitions.size()),
                ("entries", state.entries.size()),
                ("tokens", state.tokens.size()),
                ("seasons", state.seasons.size()),
                ("matches", state.matches.size()),
              ];
            }
          };
        };
      };
      case ("media_metadata") {
        let target : MediaMetadataActor = actor (Principal.toText(principal));
        switch (await target.export_state()) {
          case (#Err(message)) { Runtime.trap("media_metadata export_state failed: " # message) };
          case (#Ok(state)) {
            {
              schema = state.schema;
              governor = state.governor;
              sizes = [
                ("assets", state.assets.size()),
                ("capabilities", state.capabilities.size()),
                ("reactions", state.reactions.size()),
                ("comments", state.comments.size()),
                ("roles", state.roles.size()),
              ];
            }
          };
        };
      };
      case ("messaging_domain") {
        let target : MessagingDomainActor = actor (Principal.toText(principal));
        switch (await target.export_state()) {
          case (#Err(message)) { Runtime.trap("messaging_domain export_state failed: " # message) };
          case (#Ok(state)) {
            {
              schema = state.schema;
              governor = state.governor;
              sizes = [
                ("roles", state.roles.size()),
                ("conversations", state.conversations.size()),
                ("messages", state.messages.size()),
                ("receipts", state.receipts.size()),
                ("unread", state.unread.size()),
              ];
            }
          };
        };
      };
      case (_) { Runtime.trap("Unsupported domain for orchestration: " # domain) };
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


  // Calls source.export_state() and destination.export_state() itself (real
  // inter-canister calls) and only advances #started -> #exported when the
  // schema versions reported by both sides agree, recording the source's
  // collection sizes as the expected recordCount/checksum for this migration.
  // The destination is typically still empty at this stage (no import_state
  // exists yet on domain canisters — see README gaps), so schema agreement
  // is the meaningful "matching evidence" check available before an off-chain
  // copy occurs. On call failure this traps and leaves the phase unchanged;
  // on schema mismatch the migration is aborted.
  public shared ({ caller }) func orchestrateExport(id : Nat) : async Types.Migration {
    requireGovernor(caller);
    let current = findActive(id);
    if (current.phase != #started) { Runtime.trap("Invalid export transition") };
    let sourceEvidence = await* fetchEvidence(current.domain, current.source);
    let destinationEvidence = await* fetchEvidence(current.domain, current.destination);
    if (sourceEvidence.schema != destinationEvidence.schema) {
      let aborted = { current with phase = #aborted };
      completed := completed.concat([aborted]);
      active := null;
      return aborted;
    };
    let recordCount = recordCountOf(sourceEvidence.sizes);
    let checksum = buildChecksum(sourceEvidence.schema, sourceEvidence.governor, sourceEvidence.sizes);
    setPhase(id, #exported, recordCount, checksum);
    findActive(id)
  };

  // Calls export_state() on both source and destination again after an
  // off-chain (or future on-chain) import has happened, and only advances
  // #imported -> #verified when record counts and checksums fully agree
  // between the two sides. A mismatch aborts the migration. On call failure
  // this traps and leaves the phase unchanged.
  public shared ({ caller }) func orchestrateVerify(id : Nat) : async Types.Migration {
    requireGovernor(caller);
    let current = findActive(id);
    if (current.phase != #imported) { Runtime.trap("Invalid verify transition") };
    let sourceEvidence = await* fetchEvidence(current.domain, current.source);
    let destinationEvidence = await* fetchEvidence(current.domain, current.destination);
    let sourceChecksum = buildChecksum(sourceEvidence.schema, sourceEvidence.governor, sourceEvidence.sizes);
    let destinationChecksum = buildChecksum(destinationEvidence.schema, destinationEvidence.governor, destinationEvidence.sizes);
    let sourceCount = recordCountOf(sourceEvidence.sizes);
    let destinationCount = recordCountOf(destinationEvidence.sizes);
    if (sourceEvidence.schema != destinationEvidence.schema or sourceCount != destinationCount or sourceChecksum != destinationChecksum) {
      let aborted = { current with phase = #aborted };
      completed := completed.concat([aborted]);
      active := null;
      return aborted;
    };
    setPhase(id, #verified, sourceCount, sourceChecksum);
    findActive(id)
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
