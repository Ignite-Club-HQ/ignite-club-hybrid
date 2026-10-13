// Adds a caller-recorded presence heartbeat (principal text -> last-seen ms)
// backing the admin "Online Users" page on ICP, where there is no Supabase
// realtime presence channel. Stored as a separate assoc list so existing
// records — and every migration that mentions them — stay untouched.
module {
  public func migration(_ : {}) : {
    var presenceLastSeen : [(Text, Int)];
  } {
    {
      var presenceLastSeen = [];
    }
  };
};
