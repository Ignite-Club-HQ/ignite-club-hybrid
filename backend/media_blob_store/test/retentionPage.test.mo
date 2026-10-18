import Page "../src/retentionPage";
let first = Page.indices(75, 0, 50);
assert first.size() == 50;
assert first[0] == 0 and first[49] == 49;
let second = Page.indices(75, 50, 50);
assert second[0] == 50 and second[24] == 74 and second[25] == 0;
assert Page.indices(0, 100, 50).size() == 0;
assert Page.indices(2, 100, 50) == [0, 1];