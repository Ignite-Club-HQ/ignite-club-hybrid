module {
  public func migration(_ : {}) : { var invite_email_sender : ?{ key : Text; from : Text; app_url : Text }; var invite_emails_sent : [Text] } {
    { var invite_email_sender = null; var invite_emails_sent = [] }
  }
}
