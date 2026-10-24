import Principal "mo:core/Principal";
import Types "types";

module {
  public type Intent = { file : Types.VaultFile; ready : Bool };
  public func sameDestination(a : Types.VaultFile, b : Types.VaultFile) : Bool {
    a.id == b.id and a.uploaded_by.equal(b.uploaded_by) and a.club == b.club and
    a.team == b.team and a.folder_id == b.folder_id and a.competition_id == b.competition_id and
    a.mini_league_id == b.mini_league_id and a.name == b.name and a.size == b.size and
    a.mime == b.mime and a.file_url == b.file_url and a.blob_ref == b.blob_ref
  };
}