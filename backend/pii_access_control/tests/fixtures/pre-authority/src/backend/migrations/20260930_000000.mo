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
    readers : [Principal];
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
  // A guardian relationship: `guardian` may read the PII of every pii_id in
  // `children`. Verified (i.e. created) only via add_guardian_relationship,
  // which requires either the governor or the guardian acting on their own
  // behalf (self-registration flow — the caller can only ever add themself
  // as the guardian, never impersonate another principal).
  type GuardianRelationship = {
    guardian : Principal;
    children : [Text]; // pii_id set
  };
  type OldActor = {
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
    var guardian_relationships : [GuardianRelationship];
  };
  // Adds guardian-relationship records backing verified reader grants.
  // Existing state is untouched; the new list starts empty.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var pii_records = old.pii_records;
      var audit_log = old.audit_log;
      var key_metadata_list = old.key_metadata_list;
      var master_secrets = old.master_secrets;
      var master_key_id_current = old.master_key_id_current;
      var metadata_version = old.metadata_version;
      var last_key_rotation = old.last_key_rotation;
      var media_root_secret = old.media_root_secret;
      var guardian_relationships = [];
    }
  };
};
