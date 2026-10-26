import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/LazyImage", () => ({ LazyImage: ({ src }: { src?: string }) => <img src={src} alt="Resolved photo" /> }));
import { AlbumCarousel } from "./AlbumCarousel";
afterEach(cleanup);
describe("album retrieval states", () => {
  it("does not hand a pending photo or old failure placeholder to the image renderer", () => {
    const { container, rerender } = render(<AlbumCarousel photos={[{ id: "a", loading: true, file_url: "old-failure" }]} />);
    expect(container.querySelector("img")).toBeNull();
    rerender(<AlbumCarousel photos={[{ id: "a", loading: false, file_url: "blob:ready" }]} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:ready");
  });
  it("keeps a resolved album photo displayed while another slide is retrieved", () => {
    const { container } = render(<AlbumCarousel photos={[{ id: "a", loading: false, file_url: "blob:existing" }, { id: "b", loading: true }]} />);
    expect(container.querySelectorAll("img")).toHaveLength(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:existing");
  });
});