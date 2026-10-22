module {
type ClubProfile = {
    id : Text;
    secondary_color : ?Text;
    name : Text;
    slug : Text;
    description : ?Text;
    created_at_ms : Nat64;
    logo_url : ?Text;
    is_active : Bool;
    primary_color : ?Text;
    // Soft-delete marker mirroring the Supabase `clubs.deleted_at` column;
    // null means active. Permanent delete removes the record outright.
    deleted_at_ms : ?Nat64;
    // PlayHQ integration config mirroring the Supabase `clubs.playhq_*`
    // columns; null means the club has no PlayHQ connection.
    playhq_tenant : ?Text;
    playhq_org_id : ?Text;
    // Sport this club plays, mirroring the Supabase `clubs.sport` column.
    // null means not yet set.
    sport : ?Text;
  };
type RoleGrant = { user : Principal; role : Text; club : ?Text; team : ?Text };
type Child = { id : Text; teams : [Text]; parent : ?Principal; club_id : ?Text };
type Guardian = { child : Text; user : Principal };
type Team = { id : Text; club : Text };
type ClubTeam = {
    id : Text;
    name : Text;
    division : ?Text;
    gender : ?Text;
    is_active : Bool;
    club_id : Text;
    age_group : ?Text;
    description : ?Text;
    logo_url : ?Text;
    team_type : ?Text;
    // Soft-delete marker mirroring the Supabase `teams.deleted_at` column.
    deleted_at_ms : ?Nat64;
    is_shell : Bool;
    shell_claim_token : ?Text;
    shell_claimed_at_ms : ?Nat64;
    shell_claimed_by : ?Principal;
    shell_contact_email : ?Text;
    shell_contact_name : ?Text;
    shell_invited_by : ?Principal;
    archived : Bool;
    // PlayHQ link fields mirroring the Supabase `teams.playhq_*` columns:
    // which PlayHQ competition/team this team mirrors, and whether fixture
    // sync auto-creates match events. null/false means unlinked.
    playhq_team_id : ?Text;
    playhq_competition_id : ?Text;
    playhq_auto_create_events : Bool;
    // Team-folder grouping mirroring the Supabase `teams.folder_id` column;
    // null means the team is unfiled.
    folder_id : ?Text;
  };
type Exclusion = { club : Text; user : Principal };
type RemovedMember = { club : Text; user : Principal; removed_at_ms : Nat64; removed_by : Principal };
type Data = { profiles : [ClubProfile]; roles : [RoleGrant]; children : [Child]; guardians : [Guardian]; aclTeams : [Team]; teams : [ClubTeam]; exclusions : [Exclusion]; removed : [RemovedMember] };
 type Binding = { identity : Principal; router : Principal; group : Text; deployment : Text; generation : Nat64; inventory_digest : Blob };
 type Cursor = { revision : Nat; phase : Nat; offset : Nat; nested : Nat };
 type Edge = { #Club : { id : Text; deleted : Bool }; #Role : { subject : Principal; club : ?Text }; #Parent : { child : Text; subject : Principal }; #Guardian : { child : Text; subject : Principal }; #ChildTeam : { child : Text; team : Text }; #Team : { id : Text; club : Text; deleted : Bool }; #Excluded : { subject : Principal; club : Text } };
 type Page = { revision : Nat; edges : [Edge]; next : ?Cursor; scanned : Nat };
 type State = { var snapshot : ?{ binding : Binding; revision : Nat; data : Data; var started : Bool; var next : ?Cursor; var last : ?{ cursor : ?Cursor; page : Page } } };
 public func migration(_ : {}) : { var membershipSourceRetention : State } { { var membershipSourceRetention = { var snapshot = null } } }
}
