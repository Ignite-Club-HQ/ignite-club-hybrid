// Adds post-game photo prompts: event ids already prompted (purely additive).
module {
  public func migration(_ : {}) : { var photoPromptsSent : [Text] } {
    { var photoPromptsSent = [] }
  };
};
