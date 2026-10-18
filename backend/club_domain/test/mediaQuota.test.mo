import Quota "../src/mediaQuota";
import Principal "mo:core/Principal";
let a = Principal.fromText("aaaaa-aa");
let b = Principal.fromText("2vxsx-fae");
let ledger = Quota.empty();
func ok(result : Quota.Result) : Quota.Reservation { switch(result) { case (#Ok(r)) r; case (#Err(_)) { assert false; loop {} } } };
func denied(result : Quota.Result) { switch(result) { case (#Err(_)) {}; case _ assert false } };
// Two stores consume one club/category allowance, including in-flight writes.
var n = 0;
while (n < 10) {
  ignore ok(Quota.reserve(ledger, if(n % 2 == 0) a else b, debug_show(n), "club", "gallery_photo", 1, 1, false));
  n += 1;
};
denied(Quota.reserve(ledger, b, "overflow", "club", "gallery_photo", 1, 1, false));
assert Quota.getUsage(ledger, "club", "gallery_photo", 1).pending_count == 10;
let first = ok(Quota.reserve(ledger, a, "0", "club", "gallery_photo", 1, 1, false));
assert first.status == #reserved;
assert Quota.getUsage(ledger, "club", "gallery_photo", 1).pending_count == 10;
denied(Quota.reserve(ledger, a, "0", "different-club", "gallery_photo", 1, 1, false));
ignore ok(Quota.settle(ledger, a, "0", true));
ignore ok(Quota.settle(ledger, a, "0", true));
assert Quota.getUsage(ledger, "club", "gallery_photo", 1).count == 1;
denied(Quota.settle(ledger, a, "0", false));
ignore ok(Quota.settle(ledger, b, "1", false));
ignore ok(Quota.settle(ledger, b, "1", false));
denied(Quota.settle(ledger, b, "1", true));
assert Quota.getUsage(ledger, "club", "gallery_photo", 1).pending_count == 8;
ignore ok(Quota.reserve(ledger, b, "replacement", "club", "gallery_photo", 1, 1, false));
// Store B cannot settle Store A's token.
denied(Quota.settle(ledger, b, "0", true));
// The 25 MiB file budget is shared across stores.
ignore ok(Quota.reserve(ledger, a, "f1", "files", "vault", 10_485_760, 1, false));
ignore ok(Quota.reserve(ledger, b, "f2", "files", "vault", 10_485_760, 1, false));
ignore ok(Quota.reserve(ledger, a, "f3", "files", "vault", 5_242_880, 1, false));
denied(Quota.reserve(ledger, b, "f4", "files", "vault", 1, 1, false));
ignore ok(Quota.reserve(ledger, b, "pro", "files", "vault", 1, 1, true));
// New cycle independent; retries cannot retarget an old operation to it.
ignore ok(Quota.reserve(ledger, b, "new-cycle", "club", "gallery_photo", 1, 2, false));
denied(Quota.reserve(ledger, a, "0", "club", "gallery_photo", 1, 2, false));
denied(Quota.reserve(ledger, a, "bad", "club", "unknown", 1, 1, false));
denied(Quota.reserve(ledger, a, "huge", "club", "gallery_photo", 10_551_297, 1, true));