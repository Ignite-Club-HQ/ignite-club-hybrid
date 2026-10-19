import Quota "../src/mediaQuota";
import Principal "mo:core/Principal";
let a = Principal.fromText("aaaaa-aa");
let b = Principal.fromText("2vxsx-fae");
let ledger = Quota.empty();
func admitted(result : Quota.Result) { switch result { case (#Ok(_)) {}; case (#Err(_)) assert false } };
func denied(result : Quota.Result) { switch result { case (#Err(_)) {}; case (#Ok(_)) assert false } };
assert Quota.cycleNs == 30 * 24 * 60 * 60 * 1_000_000_000;
// Every free category shares ten slots across stores, not ten per store.
for (category in ["gallery_photo", "chat_photo", "chat_file", "vault"].values()) {
  var n = 0;
  while (n < 10) {
    admitted(Quota.reserve(ledger, if (n % 2 == 0) a else b, category # debug_show(n), "club", category, 1, 1, false));
    n += 1;
  };
  denied(Quota.reserve(ledger, b, category # "overflow", "club", category, 1, 1, false));
  assert Quota.getUsage(ledger, "club", category, 1).pending_count == 10;
  admitted(Quota.reserve(ledger, a, category # "next", "club", category, 1, 2, false));
  admitted(Quota.reserve(ledger, a, category # "other", "other-club", category, 1, 1, false));
};
// Each file category has its own 25 MiB shared allowance; pending uploads count.
for (category in ["chat_file", "vault"].values()) {
  admitted(Quota.reserve(ledger, a, category # "bytes1", "byte-club", category, 10_485_760, 1, false));
  admitted(Quota.reserve(ledger, b, category # "bytes2", "byte-club", category, 10_485_760, 1, false));
  admitted(Quota.reserve(ledger, a, category # "bytes3", "byte-club", category, 5_242_880, 1, false));
  assert Quota.getUsage(ledger, "byte-club", category, 1).pending_bytes == 25 * 1024 * 1024;
  denied(Quota.reserve(ledger, b, category # "byteover", "byte-club", category, 1, 1, false));
  admitted(Quota.reserve(ledger, b, category # "paid", "byte-club", category, 1, 1, true));
};