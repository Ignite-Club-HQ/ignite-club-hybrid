import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type KeyStatus = { #Active; #RotationPending; #Revoked; #Shredded };
  type OldPiiRecord = {
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
    pii_id : Text;
    field_id : Text;
    operation : Text;
    requesting_principal : Principal;
    success : Bool;
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
  type OldActor = {
    var governor : Principal;
    var pii_records : [OldPiiRecord];
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
  };
  // Adds per-record reader grants for PII access. Existing records get an
  // empty reader list (same access as before: governor or domain owner).
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var pii_records = Array.map<OldPiiRecord, PiiRecord>(old.pii_records, func(r) {
        { pii_id = r.pii_id; field_id = r.field_id; ciphertext = r.ciphertext; nonce = r.nonce; master_key_id = r.master_key_id; created_at = r.created_at; last_accessed = r.last_accessed; access_count = r.access_count; domain_owner = r.domain_owner; readers = [] }
      });
      var audit_log = old.audit_log;
      var key_metadata_list = old.key_metadata_list;
      var master_secrets = old.master_secrets;
      var master_key_id_current = old.master_key_id_current;
      var metadata_version = old.metadata_version;
      var last_key_rotation = old.last_key_rotation;
      var media_root_secret = old.media_root_secret;
    }
  };
};
