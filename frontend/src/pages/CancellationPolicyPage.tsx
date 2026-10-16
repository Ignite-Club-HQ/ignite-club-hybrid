import LegalPageEmbed from "@/components/LegalPageEmbed";
import { LEGAL_URLS } from "@/lib/legalLinks";

export default function CancellationPolicyPage() {
  return (
    <LegalPageEmbed
      title="Refund & Cancellation Policy"
      websiteUrl={LEGAL_URLS.cancellation}
    />
  );
}
