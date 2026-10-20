import Retirement "../src/mediaJournalRetirement";
import Retained "../src/mediaRetainedQuota";
import Monthly "../src/mediaQuota";
import Token "../../shared/MediaJournalToken";
import Principal "mo:core/Principal";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Map "mo:core/Map";
let store = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let ledger = Retained.empty(); let monthly = Monthly.empty(); let state = Retirement.empty();
assert Retained.register(ledger, store); assert Retained.seal(ledger, store);
func ok(r : Retained.Result) { switch (r) { case (#Ok(_)) {}; case _ assert false } };
let token = "r1:1:1:upload";
ok(Retained.reserve(ledger, store, token, "c", "clubs/c/chat/a", 7, true, 0));
assert not Retirement.acknowledge(state, ledger, monthly, store, token);
ok(Retained.settle(ledger, store, token, true));
assert Retirement.retire(state, ledger, monthly, 4, "").removed == 0; // lost reply
assert Retirement.acknowledge(state, ledger, monthly, store, token);
assert Retirement.retire(state, ledger, monthly, 2, "").removed == 0;
assert Retirement.retire(state, ledger, monthly, 3, "").removed == 1;
assert Retained.usage(ledger, "c").finalized == 7;
assert Token.expired(token, 3);
assert not Token.expired("upload-legacy", 99);
assert Token.epoch("r1:1:1:upload:extra") == null;
ok(Retained.cancel(ledger, store, "upload-legacy", "c", "clubs/c/chat/legacy", 1));
assert not Retirement.acknowledge(state, ledger, monthly, store, "upload-legacy");
assert Retirement.retire(state, ledger, monthly, 99, "").removed == 0;
// A monthly reply lost after commit may not be removed independently.
let paired = "r1:1:2:upload";
ok(Retained.reserve(ledger, store, paired, "c", "clubs/c/chat/paired", 1, true, 0));
switch (Monthly.reserve(monthly, store, paired, "c", "chat_photo", 1, 1, true)) { case (#Ok(_)) {}; case _ assert false };
switch (Monthly.settle(monthly, store, paired, true)) { case (#Ok(_)) {}; case _ assert false };
assert not Retirement.acknowledge(state, ledger, monthly, store, paired);
ignore Monthly.retireCoordinatedPage(monthly, 99, "", "", false);
assert Monthly.status(monthly, store, paired) != null;
ok(Retained.settle(ledger, store, paired, true));
assert Retirement.acknowledge(state, ledger, monthly, store, paired);
assert Retirement.retire(state, ledger, monthly, 99, "").removed == 1;
assert Monthly.status(monthly, store, paired) == null;
// Mixed eligibility and acknowledgement-time/retirement-time ledger drift.
let mixed = Retained.empty(); let mixMonthly = Monthly.empty(); let mixState = Retirement.empty();
assert Retained.register(mixed, store); assert Retained.seal(mixed, store);
for (t in ["r1:1:10:upload", "r1:1:11:upload", "r1:1:12:upload", "r1:98:13:upload", "legacy", "r1:bad:14:upload"].values()) {
  ok(Retained.cancel(mixed, store, t, "c", "clubs/c/photos/" # t, 1));
  ignore Retirement.acknowledge(mixState, mixed, mixMonthly, store, t)
};
let unacked = store.toText() # "\u{1f}r1:1:11:upload";
mixState.acknowledged.remove(unacked);
switch (Monthly.reserve(mixMonthly, store, "r1:1:12:upload", "c", "gallery_photo", 1, 1, true)) { case (#Ok(_)) {}; case _ assert false };
assert Retirement.retire(mixState, mixed, mixMonthly, 99, "").removed == 1;
assert mixed.operations.size() == 5;
assert Monthly.status(mixMonthly, store, "r1:1:12:upload") != null;
assert mixed.operations.get(unacked) != null;
assert Retained.settle(mixed, store, "r1:1:10:upload", true) == #Err("Unknown reservation");
// Bounded cleanup still recovers room when the authority journal is full.
for (i in Nat.range(0, 100_000)) {
  let t = "r1:1:" # i.toText() # ":delete";
  let key = store.toText() # "\u{1f}" # t;
  ledger.operations.add(key, {store;token=t;path="p";club="c";bytes=0;previous=null;state=#released});
  state.acknowledged.add(key, true)
};
assert ledger.operations.size() >= 100_000;
let page = Retirement.retire(state, ledger, monthly, 99, "");
assert page.removed == 200;
assert page.cursor != "";