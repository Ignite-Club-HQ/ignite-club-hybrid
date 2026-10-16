import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { AuthLegalLinks } from "./AuthLegalLinks";
import { ProfilePolicyLinks } from "./ProfilePolicyLinks";
import { LEGAL_URLS } from "@/lib/legalLinks";

afterEach(cleanup);

describe("Legal links", () => {
  it("provides all five real destinations without replacing the sign-in page", () => {
    render(<AuthLegalLinks />);
    for (const [name, key] of [["Terms", "terms"], ["Privacy", "privacy"], ["Cancellation", "cancellation"], ["Contact", "contact"], ["Support", "support"]] as const) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", LEGAL_URLS[key]);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("opens profile policies without changing agreement state", () => {
    const toggle = vi.fn();
    render(<label onClick={toggle}><ProfilePolicyLinks /></label>);
    for (const [name, key] of [["Terms of Service", "terms"], ["Privacy Policy", "privacy"]] as const) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("href", LEGAL_URLS[key]);
      expect(link).toHaveAttribute("target", "_blank");
      fireEvent.click(link);
    }
    expect(toggle).not.toHaveBeenCalled();
  });

  it("uses the same footer in both login modes and policy links on profile setup", () => {
    const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source("../pages/AuthPage.tsx")).toContain("<AuthLegalLinks />");
    expect(source("./IcpSignInScreen.tsx")).toContain("<AuthLegalLinks />");
    expect(source("../pages/CompleteProfilePage.tsx")).toContain("<ProfilePolicyLinks />");
    for (const [page, key] of [["TermsOfServicePage", "terms"], ["PrivacyPolicyPage", "privacy"], ["CancellationPolicyPage", "cancellation"]]) {
      expect(source(`../pages/${page}.tsx`)).toContain(`websiteUrl={LEGAL_URLS.${key}}`);
    }
  });
});