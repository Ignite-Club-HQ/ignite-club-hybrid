import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const vaultPageSource = readFileSync(join(pagesDirectory, "VaultPage.tsx"), "utf8");
const photoLightboxSource = readFileSync(join(pagesDirectory, "../components/PhotoLightbox.tsx"), "utf8");
const lightboxHookPath = join(pagesDirectory, "../features/vault/useVaultLightbox.ts");
const vaultLightboxPath = join(pagesDirectory, "../components/vault/VaultLightbox.tsx");
const lightboxHookSource = existsSync(lightboxHookPath) ? readFileSync(lightboxHookPath, "utf8") : "";
const vaultLightboxSource = existsSync(vaultLightboxPath) ? readFileSync(vaultLightboxPath, "utf8") : "";
const clusterSource = `${vaultPageSource}\n${lightboxHookSource}\n${vaultLightboxSource}\n${photoLightboxSource}`;

describe("Vault lightbox behavior contract", () => {
  it("preserves page-owned photo open, close, navigation, and delete request semantics", () => {
    expect(clusterSource).toContain("PhotoLightbox");
    expect(clusterSource).toMatch(/setLightboxIndex\(index\);\s*setLightboxOpen\(true\);/);
    expect(clusterSource).toContain("onPhotoClick: openLightbox");
    expect(clusterSource).toMatch(/setLightboxOpen\(false\);[\s\S]*(setDeletePhotoId\(photoId\)|onDeletePhotoRequested\(photoId\))/);
    expect(clusterSource).toMatch(/photos=\{photos \|\| \[\]\}|photos\}/);
    expect(clusterSource).toMatch(/currentIndex=\{lightboxIndex\}|currentIndex=\{state\.currentIndex\}/);
    expect(clusterSource).toMatch(/onNavigate=\{setLightboxIndex\}|onNavigate=\{navigate\}|onNavigate=\{onNavigate\}/);
    expect(clusterSource).toContain("canDeletePhoto");
  });

  it("keeps keyboard, boundary navigation, zoom reset, and close behavior inside the viewer", () => {
    expect(photoLightboxSource).toContain('if (e.key === "ArrowLeft") handlePrev();');
    expect(photoLightboxSource).toContain('if (e.key === "ArrowRight") handleNext();');
    expect(photoLightboxSource).toContain('if (e.key === "Escape") onClose();');
    expect(photoLightboxSource).toContain("if (currentIndex > 0) onNavigate(currentIndex - 1);");
    expect(photoLightboxSource).toContain("if (currentIndex < photos.length - 1) onNavigate(currentIndex + 1);");
    expect(photoLightboxSource).toContain("usePinchZoom(1, 4)");
    expect(photoLightboxSource).toContain("resetZoom();");
    expect(photoLightboxSource).toContain("handleDialogOpenChange");
    expect(photoLightboxSource).toContain("if (downloadCloseGuardRef.current) return;");
    expect(photoLightboxSource).toContain("onClose();");
  });

  it("preserves lightbox download, delete confirmation, share, and report side effects", () => {
    expect(photoLightboxSource).toContain("downloadMedia(url, kind)");
    expect(photoLightboxSource).toContain("isDownloadInFlight(url)");
    expect(photoLightboxSource).toContain('toast.error("Could not download")');
    expect(photoLightboxSource).toContain("setDeleteConfirmOpen(true)");
    expect(photoLightboxSource).toContain("confirmDelete");
    expect(photoLightboxSource).toContain("onDelete(currentPhoto.id)");
    expect(photoLightboxSource).toContain("ReportPhotoDialog");
    expect(photoLightboxSource).toContain("gateShareWithPro");
  });

  it("keeps any extracted Vault lightbox boundary narrow when present", () => {
    if (!lightboxHookSource && !vaultLightboxSource) {
      expect(vaultPageSource).toMatch(/\[lightboxOpen, setLightboxOpen\]/);
      expect(vaultPageSource).toMatch(/\[lightboxIndex, setLightboxIndex\]/);
      return;
    }

    expect(lightboxHookSource).toContain("useVaultLightbox");
    expect(lightboxHookSource).toContain("onDeletePhotoRequested");
    expect(lightboxHookSource).not.toContain("supabase");
    expect(lightboxHookSource).not.toContain("useQuery");
    expect(vaultLightboxSource).toContain("PhotoLightbox");
    expect(vaultLightboxSource).not.toContain("supabase");
    expect(vaultPageSource).not.toMatch(/\[lightboxOpen, setLightboxOpen\]/);
    expect(vaultPageSource).not.toMatch(/\[lightboxIndex, setLightboxIndex\]/);
  });
});
