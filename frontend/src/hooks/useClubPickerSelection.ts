import { useLocation, useNavigate } from "react-router-dom";
import { useClubTheme } from "./useClubTheme";
import { clubPickerDestination } from "@/lib/clubPickerNavigation";

/** Kept at the picker boundary so restore/notification switches never bounce. */
export function useClubPickerSelection() {
  const { activeClubTheme, setActiveClubTheme } = useClubTheme();
  const location = useLocation();
  const navigate = useNavigate();
  return (clubId: string | null) => {
    const destination = clubPickerDestination(location.pathname, location.search, activeClubTheme, clubId);
    // Leave before purging old content caches; stalled reads cannot hold navigation.
    if (destination) navigate(destination, { replace: true });
    setActiveClubTheme(clubId);
  };
}