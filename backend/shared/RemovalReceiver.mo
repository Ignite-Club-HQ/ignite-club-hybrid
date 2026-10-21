import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Blob "mo:core/Blob";

// Receiver-local persistent fences. A receipt is NOT global completion.
module {
  public type Request = { account_id : Text; generation : Nat64; inventory_digest : Blob; subjects : [Principal] };
  public type Receipt = { request : Request; receiver : Principal; outstanding : Nat };
  public class Gate(enabled : Bool, authority : ?Principal,
    intents : Map.Map<Text, Request>, subjects : Map.Map<Principal, Text>, active : Map.Map<Principal, Nat>) {
    public func denied(subject : Principal) : Bool { subjects.containsKey(subject) };
    // Fail closed on stale snapshot imports before any replacement. Matching
    // raw principal bytes also catches nested Candid principal fields; UTF-8
    // forms cover legacy principal-text references. False positives deny import.
    public func snapshotDenied(snapshot : Blob) : Bool {
      let hay = Blob.toArray(snapshot);
      func contains(needle : Blob) : Bool {
        let n = Blob.toArray(needle);
        if (n.size() == 0 or n.size() > hay.size()) return false;
        var i = 0;
        while (i + n.size() <= hay.size()) {
          var j = 0;
          while (j < n.size() and hay[i+j] == n[j]) j += 1;
          if (j == n.size()) return true;
          i += 1;
        };
        false
      };
      for ((subject, _) in subjects.entries()) {
        if (contains(Principal.toBlob(subject)) or contains(Text.encodeUtf8(subject.toText()))) return true;
      };
      false
    };
    public func enter(subject : Principal) : Bool {
      if (not enabled) return true;
      if (denied(subject)) return false;
      let count = switch (active.get(subject)) { case null 0; case (?n) n };
      if (count >= 200 or (count == 0 and active.size() >= 100_000)) return false;
      active.add(subject, count + 1);
      true
    };
    public func leave(subject : Principal) {
      if (not enabled) return;
      switch (active.get(subject)) {
        case (?n) { if (n <= 1) active.remove(subject) else active.add(subject, n - 1) };
        case null {}
      }
    };
    public func prepare(caller : Principal, request : Request) : { #Ok; #Err : Text } {
      if (not enabled or authority != ?caller or Principal.isAnonymous(caller)) return #Err("Configured rehearsal identity required");
      if (request.account_id == "" or request.account_id.size() > 128 or request.generation == 0 or request.inventory_digest.size() != 32 or request.subjects.size() == 0 or request.subjects.size() > 8) return #Err("Invalid removal fence");
      switch (intents.get(request.account_id)) {
        case (?prior) { return if (prior == request) #Ok else #Err("Immutable removal fence conflict") };
        case null {}
      };
      if (// Persistent core maps retain every fence; 512 MiB at a conservative
      // 1 KiB/intent and 128 B/subject each, rather than lifetime account quotas.
      intents.size() >= 524_288 or subjects.size() + request.subjects.size() > 4_194_304) return #Err("Removal fence capacity reached");
      var unique = Map.empty<Principal, Bool>();
      for (subject in request.subjects.values()) {
        if (Principal.isAnonymous(subject) or subject == Principal.fromText("aaaaa-aa") or unique.containsKey(subject) or subjects.containsKey(subject)) return #Err("Invalid or previously fenced subject");
        unique.add(subject, true)
      };
      // Entire request validated before any persistent mutation. No awaits.
      intents.add(request.account_id, request);
      for (subject in request.subjects.values()) subjects.add(subject, request.account_id);
      #Ok
    };
    public func receipt(caller : Principal, request : Request, receiver : Principal, pending : Nat) : { #Ok : Receipt; #Err : Text } {
      if (not enabled or authority != ?caller or Principal.isAnonymous(caller)) return #Err("Configured rehearsal identity required");
      if (intents.get(request.account_id) != ?request) return #Err("Exact persistent removal fence required");
      var outstanding = pending;
      for (subject in request.subjects.values()) {
        outstanding += switch (active.get(subject)) { case null 0; case (?n) n }
      };
      #Ok({ request; receiver; outstanding })
    };
    // A sealed receipt cannot be obtained from a cached observation or a
    // timeout. Immutable fences reject new holds; outstanding work must settle.
    public func seal(caller : Principal, request : Request, receiver : Principal, pending : Nat) : { #Ok : Receipt; #Err : Text } {
      switch (receipt(caller, request, receiver, pending)) {
        case (#Err(e)) #Err(e);
        case (#Ok(r)) { if (r.outstanding != 0) #Err("Removal work remains outstanding") else #Ok(r) };
      }
    }
  }
}