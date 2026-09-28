import { useCallback, useMemo, useState } from "react";

export interface VaultLightboxPhoto {
  id: string;
  file_url?: string | null;
  image_url?: string | null;
  title?: string | null;
  club_id?: string | null;
  team_id?: string | null;
}

export interface VaultLightboxState<Photo extends VaultLightboxPhoto> {
  isOpen: boolean;
  currentIndex: number;
  currentPhoto: Photo | null;
  canDeleteCurrentPhoto: boolean;
}

interface UseVaultLightboxOptions<Photo extends VaultLightboxPhoto> {
  photos: Photo[];
  canDeletePhoto: (photo: Photo) => boolean;
  onDeletePhotoRequested: (photoId: string) => void;
}

export function useVaultLightbox<Photo extends VaultLightboxPhoto>({
  photos,
  canDeletePhoto,
  onDeletePhotoRequested,
}: UseVaultLightboxOptions<Photo>) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const currentPhoto = photos[lightboxIndex] ?? null;
  const canDeleteCurrentPhoto = useMemo(
    () => (currentPhoto ? canDeletePhoto(currentPhoto) : false),
    [canDeletePhoto, currentPhoto],
  );

  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false);
  }, []);

  const navigate = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const handleLightboxDelete = useCallback((photoId: string) => {
    setLightboxOpen(false);
    onDeletePhotoRequested(photoId);
  }, [onDeletePhotoRequested]);

  const state: VaultLightboxState<Photo> = {
    isOpen: lightboxOpen,
    currentIndex: lightboxIndex,
    currentPhoto,
    canDeleteCurrentPhoto,
  };

  return {
    state,
    openLightbox,
    closeLightbox,
    navigate,
    handleLightboxDelete,
  };
}
