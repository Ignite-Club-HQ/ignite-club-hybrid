// Send-and-forget invite email: the address exists only for this call and is
// never written to canister state. Delivery goes straight to Resend over an
// HTTPS outcall; the invite id is the idempotency key so retries never send twice.
import Blob "mo:core/Blob";
import Char "mo:core/Char";
import Nat64 "mo:core/Nat64";
import Text "mo:core/Text";

module {
  public type Header = { name : Text; value : Text };
  public type HttpResult = { status : Nat; headers : [Header]; body : Blob };
  public type Request = {
    url : Text;
    max_response_bytes : ?Nat64;
    method : { #get; #head; #post };
    headers : [Header];
    body : ?Blob;
    transform : ?{ function : shared query ({ response : HttpResult; context : Blob }) -> async HttpResult; context : Blob };
    is_replicated : ?Bool;
  };
  public type Sender = { key : Text; from : Text; app_url : Text };

  public func validEmail(e : Text) : Bool {
    if (e.size() < 3 or e.size() > 254) return false;
    var at = 0;
    var dotAfterAt = false;
    for (c in e.chars()) {
      if (c == '@') at += 1
      else if (at == 1 and c == '.') dotAfterAt := true;
      if (c == ' ' or c == '<' or c == '>' or c == '\"' or c == ',' or c == ';' or c == '\\' or Char.toNat32(c) < 33) return false;
    };
    at == 1 and dotAfterAt
  };

  func json(t : Text) : Text {
    var out = "";
    for (c in t.chars()) {
      out #= switch (c) { case '\"' "\\\""; case '\\' "\\\\"; case '\n' "\\n"; case '<' "\\u003c"; case '>' "\\u003e"; case '&' "\\u0026"; case _ Text.fromChar(c) };
    };
    out
  };

  public func subject(kind : Text) : Text {
    switch (kind) {
      case "club" "You're invited to join a club on Ignite";
      case "guardian" "You're invited as a guardian on Ignite";
      case _ "You're invited to join a team on Ignite";
    }
  };

  public func request(sender : Sender, inviteId : Text, kind : Text, to : Text) : Request {
    let link = sender.app_url # "/join/p/" # inviteId;
    let html = "<p>You've been invited to Ignite Club HQ.</p><p><a href=\"" # link # "\">Accept your invite</a></p><p>Or open this link: " # link # "</p><p>If you weren't expecting this, you can ignore this email.</p>";
    let body = "{\"from\":\"" # json(sender.from) # "\",\"to\":[\"" # json(to) # "\"],\"subject\":\"" # json(subject(kind)) # "\",\"html\":\"" # json(html) # "\"}";
    {
      url = "https://api.resend.com/emails";
      max_response_bytes = ?4096;
      method = #post;
      headers = [
        { name = "Authorization"; value = "Bearer " # sender.key },
        { name = "Content-Type"; value = "application/json" },
        { name = "Idempotency-Key"; value = "ignite-invite-" # inviteId },
      ];
      body = ?Text.encodeUtf8(body);
      transform = null;
      is_replicated = ?false;
    }
  };
};
