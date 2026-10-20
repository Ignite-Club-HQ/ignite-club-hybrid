//! Local-only instrumentation. Not part of the default build or public Candid.
//! No endpoint seeds state, authorizes membership, or changes release gates.
use crate::*;
#[derive(CandidType, Serialize)]
pub(crate) struct Probe { result: Outcome<GroupAssignment>, instructions: u64 }
#[ic_cdk::update]
fn measure_scale_path(path: String, club: String, target: String, revision: u64) -> Outcome<Probe> {
    require_governor()?;
    // Even a mistakenly enabled mainnet module refuses every probe.
    if !ic_cdk::api::env_var_name_exists("IGNITE_SCALE_PROBE_LOCAL") ||
        ic_cdk::api::env_var_value("IGNITE_SCALE_PROBE_LOCAL") != "1" { return Err("Isolated scale probe required".into()); }
    let start = ic_cdk::api::performance_counter(0);
    let result = match path.as_str() {
        "place" => assign_new_club_group(club, target, revision),
        "hosted" => read_hosted_club_assignment(club, target, revision),
        _ => return Err("Unknown scale path".into()),
    };
    Ok(Probe { result, instructions: ic_cdk::api::performance_counter(0) - start })
}