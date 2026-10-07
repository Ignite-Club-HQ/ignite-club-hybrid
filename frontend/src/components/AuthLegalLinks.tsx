import { LEGAL_URLS } from "@/lib/legalLinks";

/** Separate browsing preserves the sign-in page, profile draft and invite URL. */
export function AuthLegalLinks() {
  return (
    <nav aria-label="Legal and contact links" className="text-center text-xs text-muted-foreground space-y-3">
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        <a href={LEGAL_URLS.terms} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">Terms</a>
        <a href={LEGAL_URLS.privacy} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">Privacy</a>
        <a href={LEGAL_URLS.cancellation} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">Cancellation</a>
      </div>
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        <a href={LEGAL_URLS.contact} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">Contact</a>
        <a href={LEGAL_URLS.support} target="_blank" rel="noopener noreferrer" className="hover:text-foreground hover:underline">Support</a>
      </div>
    </nav>
  );
}