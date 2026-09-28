import { describe, it, expect } from "vitest";
import {
  classifyClubSubscription,
  classifyTeamSubscription,
  isPromoReminderEnabled,
} from "../../supabase/functions/send-renewal-reminders/classify";

/**
 * Renewal reminders must never tell promo/trial-granted (non-paying)
 * subscribers to "renew / manage billing" — there is no payment instrument.
 */
describe("renewal reminder promo classification", () => {
  describe("club subscriptions", () => {
    it("promo-granted club sub (promo_code_id set, no stripe) is not paying", () => {
      expect(
        classifyClubSubscription({ promo_code_id: "promo-1", stripe_subscription_id: null }),
      ).toBe("promo_granted");
    });

    it("stripe-backed club sub stays on the standard payment reminder", () => {
      expect(
        classifyClubSubscription({ promo_code_id: null, stripe_subscription_id: "sub_123" }),
      ).toBe("paying");
    });

    it("promo code plus stripe (converted to paying) uses the standard reminder", () => {
      expect(
        classifyClubSubscription({ promo_code_id: "promo-1", stripe_subscription_id: "sub_123" }),
      ).toBe("paying");
    });

    it("club sub with neither promo nor stripe is treated as paying (legacy rows)", () => {
      expect(
        classifyClubSubscription({ promo_code_id: null, stripe_subscription_id: null }),
      ).toBe("paying");
    });
  });

  describe("team subscriptions", () => {
    it("team sub with no stripe and no IAP transaction is promo-granted", () => {
      expect(
        classifyTeamSubscription({ stripe_subscription_id: null }, false),
      ).toBe("promo_granted");
    });

    it("team sub with no stripe but a live IAP transaction stays paying", () => {
      expect(
        classifyTeamSubscription({ stripe_subscription_id: null }, true),
      ).toBe("paying");
    });

    it("stripe-backed team sub stays paying", () => {
      expect(
        classifyTeamSubscription({ stripe_subscription_id: "sub_123" }, false),
      ).toBe("paying");
    });
  });

  describe("PROMO_REMINDER_ENABLED flag", () => {
    it("defaults to disabled unless explicitly 'true'", () => {
      expect(isPromoReminderEnabled(() => undefined)).toBe(false);
      expect(isPromoReminderEnabled(() => "false")).toBe(false);
      expect(isPromoReminderEnabled(() => "1")).toBe(false);
      expect(isPromoReminderEnabled(() => "true")).toBe(true);
    });
  });
});
