import Array "mo:core/Array";
import Blob "mo:core/Blob";

module {
  // Caller validates completeness and exact length before allocating.
  public func assemble(chunks : [?Blob], size : Nat) : Blob {
    var chunkIndex = 0;
    var offset = 0;
    var current : [Nat8] = [];
    let bytes = Array.tabulate<Nat8>(size, func(_) {
      while (offset >= current.size()) {
        current := switch (chunks[chunkIndex]) { case (?chunk) chunk.toArray(); case null [] };
        chunkIndex += 1;
        offset := 0;
      };
      let byte = current[offset];
      offset += 1;
      byte
    });
    bytes.toBlob()
  };
}