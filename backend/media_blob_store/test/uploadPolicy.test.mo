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
// Pro media allowance: 3 GiB base plus purchased GB, counting vault, gallery
// and chat bytes combined, including in-flight uploads.
assert Policy.withinProMediaAllowance(3_221_225_471, 0, 1, 0);
assert not Policy.withinProMediaAllowance(3_221_225_471, 1, 1, 0);
assert Policy.withinProMediaAllowance(4_294_967_296, 0, 0, 1);
assert not Policy.withinProMediaAllowance(4_294_967_296, 0, 1, 1);
// Large capacity is opt-in: default ceiling unchanged, large mode 200 GiB.
assert Policy.effectiveCapacityFor(42_949_672_960, false) == 2_147_483_648;
assert Policy.effectiveCapacityFor(42_949_672_960, true) == 42_949_672_960;
assert Policy.ceilingFor(true) == 214_748_364_800;
assert Policy.effectiveCapacityFor(214_748_364_801, true) == 214_748_364_800;
assert Policy.thresholdFor(214_748_364_800, true) == 171_798_691_840;
assert Policy.canAdmitFor(214_748_364_800, 171_798_691_839, 0, 1, 0, true);
assert not Policy.canAdmitFor(214_748_364_800, 171_798_691_840, 0, 1, 0, true);
assert Policy.maxStoredFiles == 1_000_000;
assert Policy.thresholdFor(68_719_476_736, true) == 54_975_581_388;
assert Policy.canAdmitFor(68_719_476_736, 54_975_581_387, 0, 1, 0, true);
assert not Policy.canAdmitFor(68_719_476_736, 54_975_581_387, 1, 1, 0, true);
assert not Policy.canAdmitFor(68_719_476_736, 54_975_581_388, 0, 1, 0, true);
assert Policy.thresholdFor(34_359_738_368, true) == 27_487_790_694;
assert Policy.canAdmitFor(34_359_738_368, 20_000_000_000, 0, 1_000, 0, true);
assert not Policy.canAdmitFor(34_359_738_368, 20_000_000_000, 0, 1_000, 0, false);
// Exact large-store admission boundary still reserves 20% and in-flight bytes.
assert Policy.canAdmitFor(34_359_738_368, 27_487_790_693, 0, 1, 0, true);
assert not Policy.canAdmitFor(34_359_738_368, 27_487_790_693, 1, 1, 0, true);
assert not Policy.canAdmitFor(34_359_738_368, 0, 0, 10, Policy.heapBudget - 159, true);
// Eight new 3 GiB commitments fit this byte-only threshold; nine do not.
// Allocator/metadata/processing headroom must be measured separately.
assert Policy.proMediaBaseBytes * 8 <= Policy.thresholdFor(34_359_738_368, true);
assert Policy.proMediaBaseBytes * 9 > Policy.thresholdFor(34_359_738_368, true);
// Multi-bank rehearsal uses an explicit runtime-bound ceiling, never the
// platform's 500 GiB figure; 80% admission and heap checks remain mandatory.
assert Policy.canAdmitWithCeiling(214_748_364_800, 171_798_691_839, 0, 1, 0, 214_748_364_800);
assert not Policy.canAdmitWithCeiling(214_748_364_800, 171_798_691_839, 1, 1, 0, 214_748_364_800);
assert not Policy.canAdmitWithCeiling(536_870_912_000, 171_798_691_840, 0, 1, 0, 214_748_364_800);

assert Policy.freeMediaBaseBytes == 262_144_000;
assert Policy.teamMediaBaseBytes == 1_073_741_824;
assert Policy.withinMediaAllowance(262_143_999, 0, 1, Policy.freeMediaBaseBytes);
assert not Policy.withinMediaAllowance(262_143_999, 1, 1, Policy.freeMediaBaseBytes);
