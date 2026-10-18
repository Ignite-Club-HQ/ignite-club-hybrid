// Adds club-owned sponsor counters so sponsor statistics move with a club.
import Types "../../types";
module {
  public func migration(_ : {}) : { var clubSponsorMetrics : [Types.ClubSponsorMetricCounter]; var clubSponsorReach : [Types.ClubSponsorReachCounter] } {
    { var clubSponsorMetrics = []; var clubSponsorReach = [] }
  }
}
