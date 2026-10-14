// Adds chatPhotoReminderLog (cooldown tracking for the admin "run now" /
// future timer chat photo gallery reminder sweep — see
// run_chat_photo_gallery_reminders in main.mo). Follows the partial-migration
// pattern of 20261015 (applied migrations are immutable — see
// backend/AGENTS.md).
import Principal "mo:core/Principal";
module {
  type ChatPhotoReminderLog = { team_id : Text; author : Principal; last_reminded_ms : Nat64 };
  public func migration(_ : {}) : { var chatPhotoReminderLog : [ChatPhotoReminderLog] } {
    { var chatPhotoReminderLog = [] }
  };
};
