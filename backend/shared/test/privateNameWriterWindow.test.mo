import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Writer "../PrivateNameWriterWindow";

let owner = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let outsider = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let request = { operation_id = "window-1"; generation = 1 : Nat64; inventory_digest = Blob.fromArray([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]) };
let state = Map.empty<Text, Writer.Intent>();
let gate = Writer.Gate(true, ?owner, state, 3);
assert gate.enter() == #Err("Coordinated private-name write window required");
assert gate.open(outsider, request) == #Err("Configured rehearsal identity required");
assert gate.open(owner, request) == #Ok;
assert gate.open(owner, request) == #Ok;
let lease = switch (gate.enter()) { case (#Ok(key)) key; case _ { assert false; null } };
assert lease == ?request;
assert gate.seal(owner, request) == #Ok;
assert gate.enter() == #Err("Private-name writer closing or busy");
switch (gate.receipt(owner, request, outsider)) { case (#Ok(r)) { assert r.active == 1 and r.closing and not r.sealed }; case _ assert false };
// An upgrade/reconstruction preserves in-flight work and closed admission.
let restored = Writer.Gate(true, ?owner, state, 3);
assert restored.enter() == #Err("Private-name writer closing or busy");
restored.leave(lease);
assert restored.seal(owner, request) == #Ok;
switch (restored.receipt(owner, request, outsider)) { case (#Ok(r)) { assert r.active == 0 and r.closing and r.sealed }; case _ assert false };
assert restored.open(owner, request) == #Err("Private-name writer window already closing or sealed");
let second = { request with operation_id = "window-2"; generation = 2 : Nat64 };
assert restored.open(owner, second) == #Ok;
restored.leave(lease); // delayed old cleanup cannot release a replacement.
let next = switch (restored.enter()) { case (#Ok(key)) key; case _ { assert false; null } };
assert next == ?second;
assert restored.open(owner, { second with generation = 3 : Nat64 }) == #Err("Immutable private-name writer conflict");
restored.leave(next);
assert restored.seal(owner, second) == #Ok;
assert Writer.Gate(false, null, Map.empty<Text, Writer.Intent>(), 1).enter() == #Ok(null);
// Interrupted recovery: a window sealed while work was in flight seals itself
// when the last retained callback finishes, without any repeated seal call.
let recovered = Writer.Gate(true, ?owner, Map.empty<Text, Writer.Intent>(), 3);
let third = { request with operation_id = "window-3"; generation = 3 : Nat64 };
assert recovered.open(owner, third) == #Ok;
let held = switch (recovered.enter()) { case (#Ok(key)) key; case _ { assert false; null } };
assert recovered.seal(owner, third) == #Ok;
switch (recovered.receipt(owner, third, outsider)) { case (#Ok(r)) { assert r.closing and not r.sealed and r.active == 1 }; case _ assert false };
recovered.leave(held);
switch (recovered.receipt(owner, third, outsider)) { case (#Ok(r)) { assert r.closing and r.sealed and r.active == 0 }; case _ assert false };
assert recovered.open(owner, { request with operation_id = "window-4"; generation = 4 : Nat64 }) == #Ok;