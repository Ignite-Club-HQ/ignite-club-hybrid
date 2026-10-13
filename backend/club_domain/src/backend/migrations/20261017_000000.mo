// Adds per-user accessibility preferences (textScale/highContrast/
// reduceMotion/boldText), serialized client-side as JSON, mirroring the
// existing per-user themePrefs assoc list added in 20261001_000000.
module {
  public func migration(_ : {}) : {
    var accessibilityPrefs : [(Principal, Text)];
  } {
    {
      var accessibilityPrefs = [];
    }
  };
};
