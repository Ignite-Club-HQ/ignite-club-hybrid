import Policy "../src/uploadPolicy";

assert Policy.effectiveCapacity(42_949_672_960) == 2_147_483_648;
assert Policy.threshold(42_949_672_960) == 1_717_986_918;
assert Policy.effectiveCapacity(1_000) == 1_000;
assert Policy.canAdmit(1_000, 600, 100, 100, 0);
assert not Policy.canAdmit(1_000, 600, 101, 100, 0);
assert not Policy.canAdmit(1_000, 800, 0, 1, 0);
assert not Policy.canAdmit(1_000, 0, 0, 10, Policy.heapBudget - 159);
assert Policy.canAdmit(1_000, 0, 0, 10, Policy.heapBudget - 160);
assert Policy.validDeclaration(10_551_296, 11);
assert not Policy.validDeclaration(10_551_297, 11);
assert not Policy.validDeclaration(1_000_001, 1);
assert not Policy.validDeclaration(1, 1_000_000);
assert Policy.validDeclaration(0, 1);
assert not Policy.validDeclaration(0, 2);
assert Policy.canWriteChunk(100, 90, 10, 20, 0);
assert not Policy.canWriteChunk(100, 90, 0, 20, 0);
assert not Policy.canWriteChunk(2_000_000, 0, 0, 1_000_001, 0);
assert not Policy.canWriteChunk(100, 0, 1, 1, 0);
assert Policy.maxPending == 64;
assert Policy.maxPendingPerOwner == 4;
// Free allowance includes in-flight sends, not only finalized files.
assert Policy.withinFreeQuota(8, 0, 1, 0, 1, 10, null);
assert not Policy.withinFreeQuota(9, 0, 1, 0, 1, 10, null);
assert Policy.withinFreeQuota(0, 25_165_824, 0, 0, 1_048_576, 10, ?26_214_400);
assert not Policy.withinFreeQuota(0, 25_165_824, 1, 1, 1_048_576, 10, ?26_214_400);
// Pro vault: 5 GiB base plus purchased GB, counting in-flight uploads.
assert Policy.withinProVault(5_368_709_119, 0, 1, 0);
assert not Policy.withinProVault(5_368_709_119, 1, 1, 0);
assert Policy.withinProVault(6_442_450_944, 0, 0, 1);
assert not Policy.withinProVault(6_442_450_944, 0, 1, 1);
// Large capacity is opt-in: default ceiling unchanged, large mode 32 GiB.
assert Policy.effectiveCapacityFor(42_949_672_960, false) == 2_147_483_648;
assert Policy.effectiveCapacityFor(42_949_672_960, true) == 34_359_738_368;
assert Policy.thresholdFor(34_359_738_368, true) == 27_487_790_694;
assert Policy.canAdmitFor(34_359_738_368, 20_000_000_000, 0, 1_000, 0, true);
assert not Policy.canAdmitFor(34_359_738_368, 20_000_000_000, 0, 1_000, 0, false);
