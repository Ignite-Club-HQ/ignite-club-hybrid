import LegalPageEmbed from "@/components/LegalPageEmbed";
import { LEGAL_URLS } from "@/lib/legalLinks";

export default function TermsOfServicePage() {
  return (
    <LegalPageEmbed
      title="Terms of Service"
      websiteUrl={LEGAL_URLS.terms}
    />
  );
}
