// Adds contentReports (ReportContentDialog persistence: message/user/photo
// moderation reports, admin-readable via list_content_reports). Follows the
// partial-migration pattern of 20261011 (applied migrations are immutable —
// see backend/AGENTS.md).
import Principal "mo:core/Principal";
module {
  type ContentReport = {
    id : Text;
    reporter : Principal;
    subject_kind : Text;
    subject_id : Text;
    conversation_id : ?Text;
    reason : Text;
    details : ?Text;
    created_at_ms : Nat64;
    status : Text;
  };
  public func migration(_ : {}) : { var contentReports : [ContentReport] } {
    { var contentReports = [] }
  };
};
