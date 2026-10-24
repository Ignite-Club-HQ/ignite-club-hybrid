import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat64 "mo:core/Nat64";
module {
  public type Job = { id : Text; kind : Text; resource : Text; ciphertext : Text; state : Text; attempt : Nat; worker : ?Principal; provider_id : Text; created_at_ms : Nat64 };
  public class Queue(jobs : Map.Map<Text, Job>) {
    public func enqueue(id : Text, kind : Text, resource : Text, ciphertext : Text, now : Nat64) : { #Ok; #Err : Text } {
      switch (Map.get(jobs, Text.compare, id)) {
        case (?j) { if (j.kind != kind or j.resource != resource or j.ciphertext != ciphertext) return #Err("Email operation conflict"); #Ok };
        case null {
          if (Map.size(jobs) >= 10000 or id.size() == 0 or id.size() > 256 or ciphertext.size() > 16000) return #Err("Email queue capacity or input limit");
          Map.add(jobs, Text.compare, id, { id; kind; resource; ciphertext; state = "pending"; attempt = 0; worker = null; provider_id = ""; created_at_ms = now }); #Ok
        }
      }
    };
    public func claim(worker : Principal, eligible : Job -> Bool) : ?Job {
      for ((id, job) in Map.entries(jobs)) {
        if (job.state == "pending" and eligible(job)) {
          let claimed = { job with state = "processing"; worker = ?worker; attempt = job.attempt + 1 };
          Map.add(jobs, Text.compare, id, claimed); return ?claimed
        }
      }; null
    };
    public func finish(worker : Principal, id : Text, attempt : Nat, outcome : Text, provider : Text) : { #Ok; #Err : Text } {
      let job = Map.get(jobs, Text.compare, id) ?? return #Err("Email job missing");
      if (job.worker != ?worker or job.attempt != attempt) return #Err("Email claim mismatch");
      if (outcome != "sent" and outcome != "failed" and outcome != "unknown") return #Err("Invalid email outcome");
      if (provider.size() > 256 or (outcome == "sent" and provider.size() == 0)) return #Err("Invalid provider receipt");
      if (job.state == outcome and job.provider_id == provider) return #Ok;
      if (job.state != "processing") return #Err("Email outcome already retained");
      Map.add(jobs, Text.compare, id, { job with state = outcome; provider_id = provider }); #Ok
    };
  }
}