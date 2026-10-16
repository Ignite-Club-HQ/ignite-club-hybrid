import Types "../../types";
module {
  // Adds on-chain promo codes and their team redemptions (promo_codes parity).
  public func migration(_ : {}) : {
    var promoCodes : [Types.PromoCode];
    var promoRedemptions : [Types.PromoRedemption];
  } {
    { var promoCodes = []; var promoRedemptions = [] }
  };
};
