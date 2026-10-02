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
  type GuardianRelationship = {
    guardian : Principal;
    children : [Text];
  };
  // A club-scoped read grant: members of `club_id` (verified live via
  // club_domain's has_club_staff_role) may read the (pii_id, field_id)
  // record through the decrypt methods.
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
    var club_read_grants : [ClubReadGrant];
    var club_domain_canister : ?Principal;
  };
  // Adds club-scoped read grants (empty) and the club_domain canister
  // pointer (unset — the governor sets it post-deploy via
  // set_club_domain_canister). Existing state is untouched.
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
      var guardian_relationships = old.guardian_relationships;
      var club_read_grants = [];
      var club_domain_canister = null;
    }
  };
};
