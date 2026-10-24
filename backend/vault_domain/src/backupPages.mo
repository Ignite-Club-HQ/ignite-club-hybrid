import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Runtime "mo:core/Runtime";
import Types "types";

module {
  public func summary(b : Types.Backup) : Types.BackupSummary {
    { id = b.id; backup_label = b.backup_label; created_at_ms = b.created_at_ms; created_by = b.created_by; folder_count = b.folders.size(); file_count = b.files.size() }
  };
  public func page(b : Types.Backup, offset : Nat, revision : Nat) : Types.BackupPage {
    let total = b.folders.size() + b.files.size();
    if (offset > total) Runtime.trap("Invalid backup cursor");
    let end = Nat.min(total, offset + 40);
    let folderStart = Nat.min(offset, b.folders.size());
    let folderEnd = Nat.min(end, b.folders.size());
    let fileStart = if (offset > b.folders.size()) offset - b.folders.size() else 0;
    let fileEnd = if (end > b.folders.size()) end - b.folders.size() else 0;
    { summary = summary(b); offset; revision; next = if (end < total) ?end else null;
      folders = Array.tabulate(folderEnd - folderStart, func i = b.folders[folderStart + i]);
      files = Array.tabulate(fileEnd - fileStart, func i = b.files[fileStart + i]) }
  };
}