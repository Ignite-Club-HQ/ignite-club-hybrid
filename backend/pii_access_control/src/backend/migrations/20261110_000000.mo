module {
  // Display-only guardian metadata sidecar (label / primary-contact flag),
  // preserved from the source system during migration. Never gates access.
  type GuardianLabel = { guardian : Principal; rel_label : ?Text; is_primary : ?Bool };
  public func migration(_ : {}) : { var guardianLabels : [GuardianLabel] } {
    { var guardianLabels = [] }
  };
}
