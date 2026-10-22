import Principal "mo:core/Principal";
module {
  // Infrastructure identities are not user aliases or admission grants.
  public type Binding = {
    identity : Principal; router : Principal; group : Text; deployment : Text;
    generation : Nat64; inventory_digest : Blob;
  };
  public type State = { var binding : ?Binding; var enabled : Bool };
  public func same(a : Binding, b : Binding) : Bool {
    a.identity == b.identity and a.router == b.router and a.group == b.group and
    a.deployment == b.deployment and a.generation == b.generation and a.inventory_digest == b.inventory_digest
  };
  public func configure(state : State, binding : Binding) : { #Ok; #Err : Text } {
    if (Principal.isAnonymous(binding.identity) or Principal.isAnonymous(binding.router) or
        binding.identity == Principal.fromText("aaaaa-aa") or binding.router == Principal.fromText("aaaaa-aa") or
        binding.group.size() == 0 or binding.group.size() > 64 or binding.deployment.size() == 0 or
        binding.deployment.size() > 64 or binding.generation == 0 or binding.inventory_digest.size() != 32) {
      return #Err("Invalid directory source binding")
    };
    switch (state.binding) {
      case (?prior) {
        if (same(prior, binding) and state.enabled) return #Ok;
        if (binding.generation <= prior.generation) return #Err("New directory generation required");
      };
      case null {}
    };
    state.binding := ?binding; state.enabled := true; #Ok
  };
  public func allowed(state : State, caller : Principal, binding : Binding) : Bool {
    state.enabled and caller == binding.identity and
    (switch (state.binding) { case (?current) same(current, binding); case null false })
  };
}