// Adds the per-club transfer fence list (club ids locked for a group move).
module {
  public func migration(_ : {}) : { var transferFences : [Text] } {
    { var transferFences = [] }
  }
}
