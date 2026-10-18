import Migration "../src/backend/migrations/20261025_000000";
import Quota "../src/mediaQuota";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
// Frozen migration state must match the current runtime module structurally.
let state = Migration.migration({});
let ledger : Quota.Ledger = state.mediaQuotaLedger;
assert state.mediaQuotaStores.size() == 0;
assert Map.size(ledger.usage) == 0;
assert Map.size(ledger.reservations) == 0;
let store = Principal.fromText("jxeuj-uyaaa-aaaal-qxlna-cai");
switch (Quota.reserve(ledger, store, "first", "club", "chat_photo", 3, 1, false)) {
  case (#Ok(_)) {};
  case _ assert false;
};
assert Map.size(state.mediaQuotaLedger.reservations) == 1;
assert Quota.getUsage(state.mediaQuotaLedger, "club", "chat_photo", 1).pending_count == 1;