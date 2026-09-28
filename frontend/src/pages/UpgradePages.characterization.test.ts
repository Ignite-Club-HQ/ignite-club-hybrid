import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const clubUpgradeSource = readFileSync(join(pagesDirectory, "ClubUpgradePage.tsx"), "utf8");
const teamUpgradeSource = readFileSync(join(pagesDirectory, "UpgradeProPage.tsx"), "utf8");
const sharedPresentationSource = existsSync(join(pagesDirectory, "../components/subscription/UpgradePlanPresentation.tsx"))
  ? readFileSync(join(pagesDirectory, "../components/subscription/UpgradePlanPresentation.tsx"), "utf8")
  : "";

describe("Club and team upgrade page characterization", () => {
  it("keeps the product-specific route and authorization contracts separate", () => {
    expect(clubUpgradeSource).toContain('useParams<{ clubId: string }>()');
    expect(clubUpgradeSource).toContain('["is-club-admin", user?.id, clubId, providerKey]');
    expect(clubUpgradeSource).toContain("Only club administrators can purchase club subscriptions.");

    expect(teamUpgradeSource).toContain('useParams<{ teamId: string }>()');
    expect(teamUpgradeSource).toContain('["is-team-admin", user?.id, teamId]');
    expect(teamUpgradeSource).toContain(
      "Only team administrators, coaches, or club administrators can purchase team subscriptions.",
    );
  });

  it("keeps promo validation and checkout initiation scoped to the purchased product", () => {
    expect(clubUpgradeSource).toContain("promoData.scope_type !== 'club'");
    expect(clubUpgradeSource).toContain("subscription_type: 'club'");
    expect(clubUpgradeSource).toContain("subscriptionType: 'club'");
    expect(clubUpgradeSource).toContain("entity_id: clubId");

    expect(teamUpgradeSource).toContain("promoData.scope_type !== 'team'");
    expect(teamUpgradeSource).toContain("subscription_type: 'team'");
    expect(teamUpgradeSource).toContain("subscriptionType: 'team'");
    expect(teamUpgradeSource).toContain("entityId: teamId");
  });

  it("keeps club plan eligibility and team plan pricing distinct", () => {
    expect(clubUpgradeSource).toContain("const CLUB_PRICING =");
    expect(clubUpgradeSource).toContain("teamLimit");
    expect(clubUpgradeSource).toContain('Label className="text-sm font-medium">Select Plan</Label>');
    expect(clubUpgradeSource).toContain("getRecommendedPlan");

    expect(teamUpgradeSource).toContain("const PRICING =");
    expect(teamUpgradeSource).not.toContain("Select Plan");
    expect(teamUpgradeSource).not.toContain("getRecommendedPlan");
  });

  it("keeps ICP behavior explicit: club fixtures remain available while team billing is unavailable", () => {
    expect(clubUpgradeSource).toContain("getLocalLabClubDetail");
    expect(clubUpgradeSource).toContain("getLocalLabTeamList");
    expect(clubUpgradeSource).toContain("const useIcpLab = resolveLocalAuthMode");

    expect(teamUpgradeSource).toContain("Pro upgrades are unavailable in ICP lab mode");
    expect(teamUpgradeSource).toContain("return <SupabaseUpgradeProPage />;");
  });

  it("keeps equivalent presentation states present in both variants", () => {
    for (const source of [clubUpgradeSource, teamUpgradeSource]) {
      expect(source).toMatch(/renderTrialBanner|UpgradeTrialBanner/);
      expect(source).toContain("renderExpiryBanner");
      expect(source).toContain("renderProActiveCard");
      expect(source).toMatch(/renderPricingCard|UpgradeOfferCard/);
      expect(`${source}\n${sharedPresentationSource}`).toContain("SubscriptionLegalLinks");
      expect(source).toContain("isCheckingOut");
    }
  });
});
