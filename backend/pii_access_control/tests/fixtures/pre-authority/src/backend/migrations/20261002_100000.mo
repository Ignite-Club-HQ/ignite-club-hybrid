import Principal "mo:core/Principal";
module {
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
  type KeyStatus = { #Active; #RotationPending; #Revoked; #Shredded };
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
  type GuardianRelationship = {
    guardian : Principal;
    children : [Text];
  };
  type ClubReadGrant = {
    pii_id : Text;
    field_id : Text;
    club_id : Text;
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
    var guardian_relationships : [GuardianRelationship];
    var club_read_grants : [ClubReadGrant];
    var club_domain_canister : ?Principal;
  };
  type NewActor = {
    var governor : Principal;
    var pii_records : [PiiRecord];
    var audit_log : [AuditRecord];
    var metadata_version : Nat32;
    var guardian_relationships : [GuardianRelationship];
    var club_read_grants : [ClubReadGrant];
    var club_domain_canister : ?Principal;
  };
  // vetKeys switch: drops all canister-held key material (master secrets,
  // key rotation metadata, media root secret). Records become client-side
  // IBE ciphertext; key custody moves to the subnet's vetKD master key.
  // Records, grants, guardians and the audit log are untouched.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var pii_records = old.pii_records;
      var audit_log = old.audit_log;
      var metadata_version = old.metadata_version;
      var guardian_relationships = old.guardian_relationships;
      var club_read_grants = old.club_read_grants;
      var club_domain_canister = old.club_domain_canister;
    }
  };
};
