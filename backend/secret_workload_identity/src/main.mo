/// Secret Workload Identity Canister
/// Manages workload identity registration and vault secret access control
/// Enforces least-privilege access to vault secrets by canister principal

import Array "mo:core/Array";
import Int "mo:core/Int";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Option "mo:core/Option";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";

persistent actor {

  // ==================== Types ====================

  public type WorkloadIdentity = {
    workload_principal : Principal;
    workload_name : Text;
    allowed_scopes : [Text];
    registered_at : Nat64;
    last_used : Nat64;
    status : { #Active; #Suspended; #Revoked };
  };

  public type SecretAccessAudit = {
    timestamp : Nat64;
    requesting_principal : Principal;
    workload_name : Text;
    secret_scope : Text;
    approved : Bool;
    denial_reason : ?Text;
    nonce : Text;
  };

  public type SecretRequest = {
    secret_scope : Text;
    nonce : Text;
  };

  public type SecretAccessResult = {
    approved : Bool;
    reason : Text;
    timestamp : Nat64;
  };

  public type WorkloadIdentityFilter = {
    opt_principal : ?Principal;
    opt_scope : ?Text;
    opt_from_ts : ?Nat64;
    opt_to_ts : ?Nat64;
  };

  public type AuditSummary = {
    total_accesses : Nat64;
    approved : Nat64;
    denied : Nat64;
  };

  // ==================== State ====================

  var workloads : [WorkloadIdentity] = [];
  var secret_audit_log : [SecretAccessAudit] = [];
  var governor : Principal = Principal.anonymous();

  // Whitelist of valid scopes
  let allowed_scope_whitelist : [Text] = [
    "send-push-notification",
    "send-email-notification",
    "write-audit-log",
    "oauth-token-exchange",
    "payment-processor",
    "storage-signing",
    "webhook-delivery"
  ];

  // ==================== Helper Functions ====================

  func now_ns() : Nat64 {
    Nat.toNat64(Int.abs(Time.now()))
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) {
      Runtime.trap("Authenticated caller required");
    };
  };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func is_valid_scope(scope : Text) : Bool {
    allowed_scope_whitelist.any(func(s) = s == scope)
  };

  func log_secret_audit(
    requesting_principal : Principal,
    workload_name : Text,
    secret_scope : Text,
    approved : Bool,
    denial_reason : ?Text,
    nonce : Text
  ) {
    let audit_entry : SecretAccessAudit = {
      timestamp = now_ns();
      requesting_principal = requesting_principal;
      workload_name = workload_name;
      secret_scope = secret_scope;
      approved = approved;
      denial_reason = denial_reason;
      nonce = nonce;
    };
    secret_audit_log := secret_audit_log.concat([audit_entry]);
  };

  // ==================== Public Methods ====================

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) {
      return #Err("Already initialized");
    };
    governor := caller;
    #Ok
  };

  public shared ({ caller }) func register_workload(
    workload_principal : Principal,
    workload_name : Text,
    allowed_scopes : [Text]
  ) : async { #Ok : WorkloadIdentity; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) { return #Err("Governor only") };

    if (workload_principal.equal(Principal.anonymous())) {
      return #Err("Cannot register anonymous principal");
    };

    if (workload_name == "") {
      return #Err("Workload name cannot be empty");
    };

    // Validate that all scopes are in whitelist
    for (scope in allowed_scopes.values()) {
      if (not is_valid_scope(scope)) {
        return #Err("Invalid scope: " # scope);
      };
    };

    let now = now_ns();
    let workload : WorkloadIdentity = {
      workload_principal = workload_principal;
      workload_name = workload_name;
      allowed_scopes = allowed_scopes;
      registered_at = now;
      last_used = 0;
      status = #Active;
    };

    // Replace existing or append
    workloads := Array.filter<WorkloadIdentity>(workloads, func(w) {
      not w.workload_principal.equal(workload_principal)
    }).concat([workload]);

    #Ok(workload)
  };

  public shared ({ caller }) func verify_secret_access(
    workload_principal : Principal,
    secret_scope : Text,
    nonce : Text
  ) : async SecretAccessResult {
    auth(caller);
    if (workload_principal.equal(Principal.anonymous()) or (not caller.equal(workload_principal) and not isGovernor(caller))) {
      log_secret_audit(caller, "invalid-caller", secret_scope, false, ?"Caller does not match workload principal", nonce);
      return {
        approved = false;
        reason = "Workload principal must be the authenticated caller or an authorized governor checking on its behalf";
        timestamp = now_ns();
      };
    };
    if (nonce == "") {
      log_secret_audit(caller, "invalid-request", secret_scope, false, ?"Nonce is required", nonce);
      return {
        approved = false;
        reason = "Nonce is required";
        timestamp = now_ns();
      };
    };
    if (secret_audit_log.any(func(record) = record.requesting_principal.equal(caller) and record.nonce == nonce)) {
      log_secret_audit(caller, "replay", secret_scope, false, ?"Nonce has already been used", nonce);
      return {
        approved = false;
        reason = "Nonce has already been used";
        timestamp = now_ns();
      };
    };

    let matching_workload = workloads.find(func(w) = w.workload_principal.equal(workload_principal));

    switch (matching_workload) {
      case (?w) {
        let now = now_ns();

        // Check if workload is active
        switch (w.status) {
          case (#Active) {
            // Check if scope is allowed
            let has_scope = w.allowed_scopes.any(func(s) = s == secret_scope);

            if (has_scope) {
              // Update last_used
              workloads := Array.tabulate<WorkloadIdentity>(workloads.size(), func(idx) {
                let cur = workloads[idx];
                if (cur.workload_principal.equal(workload_principal)) {
                  { cur with last_used = now }
                } else {
                  cur
                }
              });

              log_secret_audit(caller, w.workload_name, secret_scope, true, null, nonce);

              {
                approved = true;
                reason = "Scope authorized for active workload";
                timestamp = now;
              }
            } else {
              log_secret_audit(caller, w.workload_name, secret_scope, false, ?"Scope not in workload whitelist", nonce);

              {
                approved = false;
                reason = "Scope '" # secret_scope # "' is not granted to this workload";
                timestamp = now;
              }
            };
          };
          case (#Suspended) {
            log_secret_audit(caller, w.workload_name, secret_scope, false, ?"Workload is suspended", nonce);

            {
              approved = false;
              reason = "Workload identity is currently suspended";
              timestamp = now;
            }
          };
          case (#Revoked) {
            log_secret_audit(caller, w.workload_name, secret_scope, false, ?"Workload is revoked", nonce);

            {
              approved = false;
              reason = "Workload identity has been revoked";
              timestamp = now;
            }
          };
        }
      };
      case null {
        let now = now_ns();
        log_secret_audit(caller, "unregistered", secret_scope, false, ?"Workload principal not found", nonce);

        {
          approved = false;
          reason = "Workload principal is not registered in workload identity registry";
          timestamp = now;
        }
      };
    }
  };

  public shared query ({ caller }) func get_workload(workload_principal : Principal) : async { #Ok : WorkloadIdentity; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");

    switch (workloads.find(func(w) = w.workload_principal.equal(workload_principal))) {
      case (?w) { #Ok(w) };
      case null { #Err("Workload not found") };
    }
  };

  public shared query ({ caller }) func list_workloads() : async [WorkloadIdentity] {
    auth(caller);
    if (not isGovernor(caller)) Runtime.trap("Governor only");
    workloads
  };

  public shared ({ caller }) func update_workload_scopes(
    workload_principal : Principal,
    allowed_scopes : [Text]
  ) : async { #Ok : WorkloadIdentity; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) { return #Err("Governor only") };

    // Validate scopes
    for (scope in allowed_scopes.values()) {
      if (not is_valid_scope(scope)) {
        return #Err("Invalid scope: " # scope);
      };
    };

    var found = false;
    let now = now_ns();

    workloads := Array.tabulate<WorkloadIdentity>(workloads.size(), func(idx) {
      let cur = workloads[idx];
      if (cur.workload_principal.equal(workload_principal)) {
        found := true;
        { cur with allowed_scopes = allowed_scopes; last_used = now }
      } else {
        cur
      }
    });

    if (not found) {
      return #Err("Workload not found");
    };

    switch (workloads.find(func(w) = w.workload_principal.equal(workload_principal))) {
      case (?w) { #Ok(w) };
      case null { #Err("Workload not found after update") };
    }
  };

  public shared query ({ caller }) func audit_secret_access(filter : WorkloadIdentityFilter) : async [SecretAccessAudit] {
    auth(caller);
    if (not isGovernor(caller)) Runtime.trap("Governor only");

    Array.filter<SecretAccessAudit>(secret_audit_log, func(record) {
      let principal_match = switch (filter.opt_principal) {
        case (?p) { record.requesting_principal.equal(p) };
        case null { true };
      };
      let scope_match = switch (filter.opt_scope) {
        case (?s) { record.secret_scope == s };
        case null { true };
      };
      let time_from_match = switch (filter.opt_from_ts) {
        case (?ts) { record.timestamp >= ts };
        case null { true };
      };
      let time_to_match = switch (filter.opt_to_ts) {
        case (?ts) { record.timestamp <= ts };
        case null { true };
      };
      principal_match and scope_match and time_from_match and time_to_match
    })
  };

  public shared ({ caller }) func revoke_workload(workload_principal : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) { return #Err("Governor only") };

    var found = false;
    workloads := Array.tabulate<WorkloadIdentity>(workloads.size(), func(idx) {
      let cur = workloads[idx];
      if (cur.workload_principal.equal(workload_principal)) {
        found := true;
        { cur with status = #Revoked }
      } else {
        cur
      }
    });

    if (not found) {
      return #Err("Workload not found");
    };

    #Ok
  };

  public shared query ({ caller }) func get_audit_summary() : async AuditSummary {
    auth(caller);
    if (not isGovernor(caller)) Runtime.trap("Governor only");

    var approved_count : Nat = 0;
    var denied_count : Nat = 0;

    for (record in secret_audit_log.values()) {
      if (record.approved) {
        approved_count += 1;
      } else {
        denied_count += 1;
      };
    };

    {
      total_accesses = Nat.toNat64(secret_audit_log.size());
      approved = Nat.toNat64(approved_count);
      denied = Nat.toNat64(denied_count);
    }
  };
}
