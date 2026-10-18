use crate::{Backend, Placement, ResidencyAssignment};

pub fn unchanged_placement(existing: &Placement, country: &str, backend: &Backend) -> Result<(), String> {
    if existing.country != country || &existing.backend != backend {
        Err("Existing club placement is immutable; a verified data migration is required".into())
    } else { Ok(()) }
}

pub fn unchanged_residency(existing: &ResidencyAssignment, profile: &str, target: &str) -> Result<(), String> {
    if existing.profile != profile || existing.target_alias != target {
        Err("Existing residency assignment is immutable; a verified data migration is required".into())
    } else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::PlacementState;
    #[test]
    fn country_and_backend_cannot_change_through_ordinary_assignment() {
        let backend = Backend::Supabase { environment: "existing".into() };
        let saved = Placement { club_id: "club-1".into(), country: "AU".into(), backend: backend.clone(), state: PlacementState::ReadOnly, version: 7 };
        assert!(unchanged_placement(&saved, "AU", &backend).is_ok());
        assert!(unchanged_placement(&saved, "US", &backend).is_err());
        assert!(unchanged_placement(&saved, "AU", &Backend::Supabase { environment: "other".into() }).is_err());
        assert_eq!(saved.state, PlacementState::ReadOnly);
    }
    #[test]
    fn residency_cannot_silently_move_to_another_deployment() {
        let saved = ResidencyAssignment { club_id: "club-1".into(), profile: "EU".into(), target_alias: "eu-engine".into(), version: 1 };
        assert!(unchanged_residency(&saved, "EU", "eu-engine").is_ok());
        assert!(unchanged_residency(&saved, "GLOBAL", "eu-engine").is_err());
        assert!(unchanged_residency(&saved, "EU", "mainnet").is_err());
    }
}