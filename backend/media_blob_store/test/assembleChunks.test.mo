import Assemble "../src/assembleChunks";
import Sha256 "mo:sha2/Sha256";

let assembled = Assemble.assemble([?"a", ?"", ?"bc"], 3);
assert assembled == "abc";
assert Sha256.fromBlob(#sha256, assembled) == Sha256.fromBlob(#sha256, "abc");
assert Assemble.assemble([?""], 0) == "";
assert Assemble.assemble([?"abc"], 3) == "abc";