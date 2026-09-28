import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getVaultPhotoPresentation,
  type VaultPhotoLoadState,
} from "../src/lab/componentCandidatePolicies";

afterEach(cleanup);

type Photo = {
  id: string;
  title?: string;
  fileUrl?: string;
  imageUrl?: string;
};

function VaultPhotoFixture({
  photo,
  index,
  signedUrl = null,
  signedUrlLoading = false,
  canDelete,
  onPhotoClick,
  onDelete,
  onDownload,
  canRename = false,
  onRename,
  selectionMode = false,
  isSelected = false,
  onToggleSelection,
}: {
  photo: Photo;
  index: number;
  signedUrl?: string | null;
  signedUrlLoading?: boolean;
  canDelete: boolean;
  onPhotoClick: (index: number) => void;
  onDelete: (id: string) => void;
  onDownload?: (url: string, filename: string) => void;
  canRename?: boolean;
  onRename?: (photo: Photo) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: string) => void;
}) {
  const [loadState, setLoadState] = useState<VaultPhotoLoadState>("pending");
  const [menuOpen, setMenuOpen] = useState(false);
  const presentation = getVaultPhotoPresentation({
    photo,
    signedUrl,
    signedUrlLoading,
    loadState,
    selectionMode,
    canDelete,
    canRename,
    hasDownloadHandler: Boolean(onDownload),
    hasRenameHandler: Boolean(onRename),
  });

  if (presentation.phase === "empty") return <div>No image</div>;
  if (presentation.phase === "loading") {
    return (
      <>
        {!signedUrlLoading && presentation.photoUrl && (
          <img
            src={presentation.photoUrl}
            alt=""
            onLoad={() => setLoadState("loaded")}
            onError={() => setLoadState("error")}
          />
        )}
        <div data-testid="vault-photo-skeleton" />
      </>
    );
  }
  if (presentation.phase === "error") return <div>Failed to load</div>;

  const activatePhoto = () => {
    if (presentation.selectedAction === "toggle-selection") onToggleSelection?.(photo.id);
    else onPhotoClick(index);
  };
  return (
    <div data-selected={String(selectionMode && isSelected)}>
      <img src={presentation.photoUrl ?? undefined} alt={presentation.alt} onClick={activatePhoto} />
      {selectionMode && (
        <button
          type="button"
          aria-label={`Toggle ${presentation.alt} selection`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelection?.(photo.id);
          }}
        >
          {isSelected ? "Selected" : "Not selected"}
        </button>
      )}
      {presentation.actions.length > 0 && (
        <>
          <button type="button" aria-label="Photo actions" onClick={() => setMenuOpen(true)}>
            actions
          </button>
          {menuOpen && (
            <div role="menu">
              {presentation.actions.includes("download") && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onDownload?.(presentation.photoUrl!, presentation.downloadName);
                    setMenuOpen(false);
                  }}
                >
                  Download
                </button>
              )}
              {presentation.actions.includes("rename") && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onRename?.(photo);
                    setMenuOpen(false);
                  }}
                >
                  Rename
                </button>
              )}
              {presentation.actions.includes("delete") && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onDelete(photo.id);
                    setMenuOpen(false);
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const photo: Photo = {
  id: "photo-1",
  title: "Match day",
  fileUrl: "private-photo.jpg",
};

const renderLoaded = (
  props: Partial<React.ComponentProps<typeof VaultPhotoFixture>> = {},
) => {
  const callbacks = {
    onPhotoClick: vi.fn(),
    onDelete: vi.fn(),
    onDownload: vi.fn(),
    onRename: vi.fn(),
    onToggleSelection: vi.fn(),
  };
  const result = render(<VaultPhotoFixture
    photo={photo}
    index={2}
    signedUrl="signed-photo.jpg"
    canDelete
    canRename
    {...callbacks}
    {...props}
  />);
  const preload = result.container.querySelector('img[alt=""]');
  expect(preload).not.toBeNull();
  fireEvent.load(preload!);
  return { ...callbacks, ...result };
};

describe("VaultPhotoItem authoritative behaviors", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an explicit empty state when neither photo URL exists", () => {
    render(<VaultPhotoFixture
      photo={{ id: "photo-1" }}
      index={0}
      canDelete={false}
      onPhotoClick={vi.fn()}
      onDelete={vi.fn()}
    />);
    expect(screen.getByText("No image")).toBeTruthy();
  });

  it("waits for the signed URL and image preload before revealing content", () => {
    const props = {
      photo,
      index: 0,
      canDelete: false,
      onPhotoClick: vi.fn(),
      onDelete: vi.fn(),
    };
    const { container, rerender } = render(
      <VaultPhotoFixture {...props} signedUrlLoading />,
    );
    expect(screen.getByTestId("vault-photo-skeleton")).toBeTruthy();
    expect(screen.queryByAltText("Match day")).toBeNull();
    rerender(<VaultPhotoFixture {...props} signedUrl="signed-photo.jpg" />);
    const preload = container.querySelector('img[alt=""]');
    expect(preload).not.toBeNull();
    fireEvent.load(preload!);
    expect((screen.getByAltText("Match day") as HTMLImageElement).getAttribute("src"))
      .toBe("signed-photo.jpg");
  });

  it("shows a stable failure state after preload error", () => {
    const { container } = render(<VaultPhotoFixture
      photo={photo}
      index={0}
      signedUrl="signed-photo.jpg"
      canDelete={false}
      onPhotoClick={vi.fn()}
      onDelete={vi.fn()}
    />);
    const preload = container.querySelector('img[alt=""]');
    expect(preload).not.toBeNull();
    fireEvent.error(preload!);
    expect(screen.getByText("Failed to load")).toBeTruthy();
  });

  it("opens the photo by its supplied index outside selection mode", () => {
    const callbacks = renderLoaded();
    fireEvent.click(screen.getByAltText("Match day"));
    expect(callbacks.onPhotoClick).toHaveBeenCalledWith(2);
    expect(callbacks.onToggleSelection).not.toHaveBeenCalled();
  });

  it("toggles only selection in selection mode", () => {
    const callbacks = renderLoaded({ selectionMode: true, isSelected: true });
    fireEvent.click(screen.getByAltText("Match day"));
    fireEvent.click(screen.getByRole("button", { name: "Toggle Match day selection" }));
    expect(callbacks.onToggleSelection).toHaveBeenCalledTimes(2);
    expect(callbacks.onToggleSelection).toHaveBeenNthCalledWith(1, "photo-1");
    expect(callbacks.onPhotoClick).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Photo actions" })).toBeNull();
  });

  it("delegates only authorized download, rename and delete actions", () => {
    const callbacks = renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Photo actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(callbacks.onDownload).toHaveBeenCalledWith("signed-photo.jpg", "Match day");

    fireEvent.click(screen.getByRole("button", { name: "Photo actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(callbacks.onRename).toHaveBeenCalledWith(photo);

    fireEvent.click(screen.getByRole("button", { name: "Photo actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(callbacks.onDelete).toHaveBeenCalledWith("photo-1");
  });
});
