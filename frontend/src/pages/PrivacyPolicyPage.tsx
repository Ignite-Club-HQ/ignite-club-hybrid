import LegalPageEmbed from "@/components/LegalPageEmbed";
import { LEGAL_URLS } from "@/lib/legalLinks";

export default function PrivacyPolicyPage() {
  return (
    <LegalPageEmbed
      title="Privacy Policy"
      websiteUrl={LEGAL_URLS.privacy}
    />
  );
}
