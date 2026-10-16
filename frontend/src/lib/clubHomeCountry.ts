import { getCurrentCountry } from "@/live/userCountry";

/** Home country recorded on a new club: the creator's country, else Australia. */
export function defaultClubHomeCountry(): string {
  const c = getCurrentCountry().country?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) ? c : "AU";
}
