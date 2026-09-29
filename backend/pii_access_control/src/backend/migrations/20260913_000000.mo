import Principal "mo:core/Principal";
module {
  type KeyStatus = { #Active; #RotationPending; #Revoked; #Shredded };
  type PiiRecord = {
    pii_id : Text;
    field_id : Text;
    ciphertext : [Nat8];
    nonce : [Nat8];
    master_key_id : Text;
    created_at : Nat64;
    last_accessed : Nat64;
    access_count : Nat64;
    domain_owner : Principal;
  };
  type AuditRecord = {
    timestamp : Nat64;
    requesting_principal : Principal;
    pii_id : Text;
    field_id : Text;
    operation : Text;
    allowed : Bool;
    purpose : Text;
  };
  type KeyMetadata = {
    key_id : Text;
    created_at : Nat64;
    rotation_due_at : Nat64;
    status : KeyStatus;
  };
  type MasterSecretEntry = {
    key_id : Text;
    secret : [Nat8];
  };
  type OldActor = {};
  type NewActor = {
    var governor : Principal;
    var pii_records : [PiiRecord];
    var audit_log : [AuditRecord];
    var key_metadata_list : [KeyMetadata];
    var master_secrets : [MasterSecretEntry];
    var master_key_id_current : Text;
    var metadata_version : Nat32;
    var last_key_rotation : Nat64;
    var media_root_secret : ?[Nat8];
  };
  // Initial bootstrap: seeds empty state. The governor is set on first
  // deployment via the canister's governor setup method, not here.
  public func migration(_old : OldActor) : NewActor {
    {
      var governor = Principal.anonymous();
      var pii_records = [];
      var audit_log = [];
      var key_metadata_list = [];
      var master_secrets = [];
      var master_key_id_current = "master-key-2026-09-13";
      var metadata_version = 1;
      var last_key_rotation = 0;
      var media_root_secret = null;
    }
  };
};
