// Adds short invite link codes: an 8-char code resolving to a
// PendingInvite id, so share links can be short (e.g. example.com/i/AB12CD34)
// instead of embedding the full invite id. Stored as a separate map so
// PendingInvite — and every migration mentioning it — stays untouched.
// Codes are generated lazily by create_invite_short_code and are stable
// once created (idempotent: re-calling for the same invite_id returns the
// same code).
module {
  public func migration(_ : {}) : {
    var inviteShortCodes : [(Text, Text)];
  } {
    {
      var inviteShortCodes = [];
    }
  };
};
