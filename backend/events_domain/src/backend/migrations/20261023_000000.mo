import Types "../../types";
// Adds per-event sponsor links and the bounded active-game write log backing
// the admin "sync storm" monitor (both purely additive).
module {
  public func migration(_ : {}) : {
    var eventSponsors : [(Text, [Text])];
    var activeGameWriteLog : [(Text, Nat64)];
  } {
    { var eventSponsors = []; var activeGameWriteLog = [] };
  };
};
