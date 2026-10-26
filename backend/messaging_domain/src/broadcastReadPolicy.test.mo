import Policy "broadcastReadPolicy";
assert Policy.canAppend(2499);
assert not Policy.canAppend(2500);
assert Policy.covers(1, 2, false);
assert Policy.covers(2, 2, true);
assert not Policy.covers(3, 2, false);
assert not Policy.covers(0, 2, false);
assert not Policy.covers(1, 0, false);
assert Policy.covers(0, 0, true);