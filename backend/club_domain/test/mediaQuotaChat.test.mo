import Quota "../src/mediaQuota";
import Principal "mo:core/Principal";
let store = Principal.fromText("jxeuj-uyaaa-aaaal-qxlna-cai");
let ledger = Quota.empty();
var n = 0;
while (n < 11) {
  let token = debug_show(n);
  let photo = Quota.reserve(ledger, store, "photo" # token, "free", "chat_photo", 1, 1, false);
  switch(photo) { case (#Ok(_)) assert n < 10; case (#Err(_)) assert n == 10 };
  switch(Quota.reserve(ledger, store, "pro" # token, "pro", "chat_photo", 1, 1, true)) { case (#Ok(_)) {}; case _ assert false };
  n += 1;
};
assert Quota.getUsage(ledger, "pro", "chat_photo", 1).pending_count == 11;
for ((token, size) in [("a", 10_485_760), ("b", 10_485_760), ("c", 5_242_880)].values()) {
  switch(Quota.reserve(ledger, store, token, "free", "chat_file", size, 1, false)) { case (#Ok(_)) {}; case _ assert false };
};
switch(Quota.reserve(ledger, store, "over", "free", "chat_file", 1, 1, false)) { case (#Err(_)) {}; case _ assert false };
// Gallery usage does not consume the independently scoped chat allowance.
switch(Quota.reserve(ledger, store, "gallery", "free", "gallery_photo", 1, 1, false)) { case (#Ok(_)) {}; case _ assert false };