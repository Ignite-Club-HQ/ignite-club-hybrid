import Patch "../src/schedulePatch";

assert Patch.image(?"photo", null) == ?"photo";
assert Patch.image(?"photo", ?"") == null;
assert Patch.image(?"photo", ?"replacement") == ?"replacement";
assert Patch.endDate(?123, null) == ?123;
assert Patch.endDate(?123, ?0) == null;
assert Patch.endDate(?123, ?456) == ?456;