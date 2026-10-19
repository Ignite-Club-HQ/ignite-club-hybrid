import Principal "mo:core/Principal";
import Fence "../src/accountUnlinkFence";

let removed = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let survivor = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let receipts : [Fence.Receipt] = [("account-a", removed, 8)];
// A delayed same-generation snapshot cannot resurrect a removed alias.
assert Fence.rejects("account-a", 8, [survivor, removed], receipts);
assert Fence.rejects("account-a", 7, [removed], receipts);
// A receipt also works before a local account exists; no local state required.
assert Fence.rejects("account-a", 0, [removed], receipts);
// Newer explicit relinks and survivor-only snapshots remain valid.
assert not Fence.rejects("account-a", 9, [survivor, removed], receipts);
assert not Fence.rejects("account-a", 8, [survivor], receipts);
assert not Fence.rejects("account-b", 8, [removed], receipts);