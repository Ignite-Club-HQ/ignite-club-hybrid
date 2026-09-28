import { PhotoLightbox } from "@/components/PhotoLightbox";
import type { VaultLightboxPhoto, VaultLightboxState } from "@/features/vault/useVaultLightbox";

interface VaultLightboxProps<Photo extends VaultLightboxPhoto> {
  photos: Photo[];
  state: VaultLightboxState<Photo>;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDelete: (photoId: string) => void;
}

export function VaultLightbox<Photo extends VaultLightboxPhoto>({
  photos,
  state,
  onClose,
  onNavigate,
  onDelete,
}: VaultLightboxProps<Photo>) {
  return (
    <PhotoLightbox
      isOpen={state.isOpen}
      onClose={onClose}
      photos={photos}
      currentIndex={state.currentIndex}
      onNavigate={onNavigate}
      onDelete={onDelete}
      canDelete={state.canDeleteCurrentPhoto}
    />
  );
}
