import { LEGAL_URLS } from "@/lib/legalLinks";

export function ProfilePolicyLinks() {
  const preserveCheckbox = (event: React.MouseEvent<HTMLAnchorElement>) => event.stopPropagation();
  return (
    <>
      I have read and agree to the{" "}
      <a href={LEGAL_URLS.terms} target="_blank" rel="noopener noreferrer" onClick={preserveCheckbox} className="text-primary hover:underline">Terms of Service</a>
      {" "}and{" "}
      <a href={LEGAL_URLS.privacy} target="_blank" rel="noopener noreferrer" onClick={preserveCheckbox} className="text-primary hover:underline">Privacy Policy</a>
    </>
  );
}