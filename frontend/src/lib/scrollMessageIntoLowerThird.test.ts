import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollMessageIntoLowerThird } from "./scrollMessageIntoLowerThird";

afterEach(() => vi.restoreAllMocks());

describe("scrollMessageIntoLowerThird", () => {
  it("moves a selected message inside its Virtuoso scroller rather than the page", () => {
    const scroller = document.createElement("div");
    const row = document.createElement("div");
    scroller.appendChild(row);
    document.body.appendChild(scroller);
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 1600 },
      clientHeight: { configurable: true, value: 600 },
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ overflowY: "auto" } as CSSStyleDeclaration);
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ bottom: 700 } as DOMRect);
    const localScroll = vi.fn();
    scroller.scrollBy = localScroll;
    const pageScroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    scrollMessageIntoLowerThird(row);

    expect(localScroll).toHaveBeenCalledWith({
      top: 700 - window.innerHeight * 0.62,
      behavior: "smooth",
    });
    expect(pageScroll).not.toHaveBeenCalled();
  });

  it("does not cause micro-scroll jitter when the message is already positioned", () => {
    const row = document.createElement("div");
    document.body.appendChild(row);
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      bottom: window.innerHeight * 0.62 + 4,
    } as DOMRect);
    const pageScroll = vi.spyOn(window, "scrollBy").mockImplementation(() => {});

    scrollMessageIntoLowerThird(row);
    expect(pageScroll).not.toHaveBeenCalled();
  });
});
