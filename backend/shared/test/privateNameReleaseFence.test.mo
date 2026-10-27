import Fence "../PrivateNameReleaseFence";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Array "mo:core/Array";
let identity = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let outsider = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let intents = Map.empty<Text, Fence.Intent>();
let gate = Fence.Gate(true, ?identity, intents, 2);
let request : Fence.Request = { operation_id = "block-1"; generation = 1; inventory_digest = Blob.fromArray(Array.repeat<Nat8>(1, 32)) };
var epoch = 0;
assert gate.canRelease(epoch, epoch);
assert gate.prepare(outsider, request) == #Err("Configured rehearsal identity required");
assert gate.prepare(Principal.anonymous(), request) == #Err("Configured rehearsal identity required");
assert gate.prepare(identity, { request with inventory_digest = Blob.fromArray([1]) }) == #Err("Invalid private-name fence");
assert not gate.blocked();
assert gate.prepare(identity, request) == #Ok(true); epoch += 1;
assert not gate.canRelease(0, epoch);
assert not gate.canRelease(epoch, epoch);
assert gate.prepare(identity, request) == #Ok(false);
assert gate.prepare(identity, { request with generation = 2 }) == #Err("Immutable private-name fence conflict");
let second : Fence.Request = { request with operation_id = "remove-2"; generation = 2 };
assert gate.prepare(identity, second) == #Ok(true); epoch += 1;
let restored = Fence.Gate(true, ?identity, intents, 2);
assert restored.blocked();
assert restored.complete(outsider, request) == #Err("Configured rehearsal identity required");
assert restored.complete(identity, request) == #Ok(true); epoch += 1;
assert restored.blocked(); // One completion cannot remove another fence.
assert restored.complete(identity, request) == #Ok(false);
assert restored.complete(identity, second) == #Ok(true); epoch += 1;
assert not restored.blocked();
assert not restored.canRelease(0, epoch); // Reopen never admits a held old reply.
assert restored.canRelease(epoch, epoch);
assert restored.prepare(identity, request) == #Err("Private-name fence already completed");
assert restored.prepare(identity, { request with operation_id = "third" }) == #Err("Private-name fence capacity reached");
assert restored.complete(identity, { request with operation_id = "missing" }) == #Err("Exact persistent private-name fence required");
switch (restored.receipt(identity, second, outsider, epoch)) {
  case (#Ok(receipt)) { assert receipt.request == second; assert receipt.receiver == outsider; assert receipt.completed; assert receipt.release_epoch == epoch };
  case _ assert false
};
assert not Fence.Gate(false, ?identity, intents, 2).canRelease(epoch, epoch);
assert Fence.Gate(false, ?identity, intents, 2).prepare(identity, request) == #Err("Configured rehearsal identity required");