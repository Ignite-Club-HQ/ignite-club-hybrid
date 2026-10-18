import StableBytes "../src/stableBytes";
assert StableBytes.slotFor(0) == 65_536;
assert StableBytes.slotFor(65_536) == 65_536;
assert StableBytes.slotFor(65_537) == 131_072;
assert StableBytes.slotFor(10_551_296) == 16_777_216;
assert StableBytes.limit == 2_147_483_648;
assert StableBytes.responseChunk == 1_000_000;