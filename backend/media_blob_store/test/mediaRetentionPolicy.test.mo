import Policy "../src/mediaRetentionPolicy";
let sixMonths = 180 * 86_400 * 1_000_000_000;
assert Policy.mayDelete(?false, 1, 1, sixMonths + 2, sixMonths);
assert not Policy.mayDelete(?true, 1, 1, sixMonths + 2, sixMonths);
assert not Policy.mayDelete(null, 1, 1, sixMonths + 2, sixMonths);
assert not Policy.mayDelete(?false, 1, 2, sixMonths + 3, sixMonths);
assert not Policy.mayDelete(?false, 1, 1, sixMonths + 1, sixMonths);