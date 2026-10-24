import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat64 "mo:core/Nat64";
module {
  public type Job = { id : Text; kind : Text; resource : Text; ciphertext : Text; state : Text; attempt : Nat; worker : ?Principal; provider_id : Text; created_at_ms : Nat64 };
  public class Queue(jobs : Map.Map<Text, Job>) {
    public func enqueue(id : Text, kind : Text, resource : Text, ciphertext : Text, now : Nat64) : { #Ok; #Err : Text } {
      switch (Map.get(jobs, Text.compare, id)) {
        case (?j) { if (j.state != "pending") return #Err("Email operation already retained; no replay"); if (j.kind != kind or j.resource != resource or j.ciphertext != ciphertext) return #Err("Email operation conflict"); #Ok };
        case null {
          let active=Map.entries(jobs).filter(func pair = pair.1.state=="pending" or pair.1.state=="processing" or pair.1.state=="unknown").size();
          if (active >= 10000 or Map.size(jobs)>=100_000 or id.size() == 0 or id.size() > 256 or ciphertext.size() > 16000) return #Err("Email queue capacity or input limit");
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
    public func scrub(matches : Job -> Bool) : Nat {
      var count=0;
      for((id,j) in Map.entries(jobs).toArray().values()) {
        if(matches(j)) {Map.add(jobs,Text.compare,id,{j with ciphertext="";resource="";state=if(j.state=="pending")"cancelled" else j.state});count+=1}
      };count
    };
    public func compact(cursor : ?Text,limit : Nat) : {next_cursor:?Text;scanned:Nat} {
      var scanned=0;var last:?Text=null;
      for((id,j) in Map.entries(jobs).toArray().values()) {
        if(switch cursor {case (?c)id>c;case null true}) {
          if(scanned>=limit)return {next_cursor=last;scanned};
          scanned+=1;last:=?id;
          if(j.state=="sent" or j.state=="failed" or j.state=="cancelled")Map.add(jobs,Text.compare,id,{j with ciphertext=""})
        }
      };{next_cursor=null;scanned}
    };
    public func reconcile(worker:Principal,id:Text,attempt:Nat,outcome:Text,provider:Text):{#Ok;#Err:Text} {
      let j=Map.get(jobs,Text.compare,id)??return #Err("Job missing");
      if(j.worker!=?worker or j.attempt!=attempt or (j.state!="unknown" and j.state!="processing"))return #Err("Original worker and claim required");
      if(outcome!="sent" or provider.size()==0 or provider.size()>256)return #Err("Exact provider acceptance receipt required");
      Map.add(jobs,Text.compare,id,{j with state="sent";provider_id=provider});#Ok
    };
  }
}