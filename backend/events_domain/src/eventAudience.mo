import Array "mo:core/Array";
import Principal "mo:core/Principal";
import Types "types";

module {
  public type Membership = {
    roles : [Types.RoleGrant];
    children : [{ id : Text; teams : [Text]; parent : ?Principal }];
    guardians : [{ child_id : Text; user : Principal }];
  };
  public type Subject = { user : Text; child : ?Text };
  public func teamInScope(event : Types.Event, team : ?Text) : Bool {
    switch (event.team_id) {
      case (?id) team == ?id;
      case null {
        let targets = event.target_team_ids ?? [];
        targets.size() == 0 or (switch (team) { case (?id) targets.any(func(t) = t == id); case null false })
      }
    }
  };
  public func subjects(event : Types.Event, membership : Membership) : [Subject] {
    var out : [Subject] = [];
    let restricted = event.restricted_to_roles ?? [];
    let allowed = if (restricted.size() > 0) restricted else switch (event.rsvp_audience) {
      case ( ?"players_only") ["player"];
      case ( ?"parents_only") ["parent"];
      case _ [];
    };
    for (role in membership.roles.values()) {
      if (teamInScope(event, role.team_id) and (allowed.size() == 0 or allowed.any(func(r) = r == role.role) or role.role == "club_admin")) {
        let user = role.user.toText();
        if (not out.any(func(s) = s.user == user and s.child == null)) out := out.concat([{ user; child = null }]);
      }
    };
    if (not event.adults_only and event.rsvp_audience != ?"parents_only" and restricted.size() == 0) {
      for (child in membership.children.values()) {
        if (child.teams.any(func(team) = teamInScope(event, ?team))) {
          var parents : [Principal] = switch (child.parent) { case null []; case (?p) [p] };
          for (guardian in membership.guardians.values()) {
            if (guardian.child_id == child.id and not parents.any(func(p) = p == guardian.user)) parents := parents.concat([guardian.user]);
          };
          for (parent in parents.values()) {
            let user = parent.toText();
            if (not Principal.isAnonymous(parent) and not out.any(func(s) = s.user == user and s.child == ?child.id)) out := out.concat([{ user; child = ?child.id }]);
          }
        }
      }
    };
    out
  };
  public func unanswered(event : Types.Event, subjects : [Subject], responses : [Types.Rsvp]) : [Subject] {
    subjects.filter(func(subject) = not responses.any(func(r) = r.event_id == event.id and
      (switch (subject.child) { case null r.account_id == subject.user and r.child_id == null; case (?child) r.child_id == ?child })))
  };
  public func users(subjects : [Subject]) : [Text] {
    var out : [Text] = [];
    for (subject in subjects.values()) if (not out.any(func(id) = id == subject.user)) out := out.concat([subject.user]);
    out
  };
  public func managers(event : Types.Event, membership : Membership) : [Text] {
    users(membership.roles.filter(func(r) = r.role == "club_admin" or r.role == "committee_member" or
      ((r.role == "coach" or r.role == "team_admin") and teamInScope(event, r.team_id)))
      .map(func(r) = { user = r.user.toText(); child = null }))
  };
}