import { useEffect, useState } from 'react';

/** Opening is local UI work; neither entitlement discovery nor feed reads block it. */
export function useHomeRewardsBrowser(activeClubId: string | null, eligibleClubIds: readonly string[]) {
  const [open, setOpen] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const onlyClubId = eligibleClubIds.length === 1 ? eligibleClubIds[0] : null;

  useEffect(() => {
    if (open && !selectedClubId && onlyClubId) setSelectedClubId(onlyClubId);
  }, [open, selectedClubId, onlyClubId]);

  return {
    open, setOpen, selectedClubId, setSelectedClubId,
    browse: () => {
      setSelectedClubId(activeClubId || onlyClubId || null);
      setOpen(true);
    },
  };
}