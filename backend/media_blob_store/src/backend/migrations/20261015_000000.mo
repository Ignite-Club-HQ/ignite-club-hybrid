module {
  // Retention: upload timestamps per blob path start empty; existing blobs are
  // stamped by the first daily sweep (their 6-month clock starts then).
  public func migration(_ : {}) : { var blob_uploaded_at : [(Text, Int)] } {
    { var blob_uploaded_at = [] }
  };
};
