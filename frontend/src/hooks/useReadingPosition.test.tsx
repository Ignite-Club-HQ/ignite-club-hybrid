import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReadingPosition } from "./useReadingPosition";

describe("reading position", () => {
  it("compensates a row resize before paint without smooth scrolling", () => {
    let top = 80;
    function Page({ text }: { text: string }) {
      const ref = useReadingPosition(true, "p1:club1");
      return <div ref={ref}><div data-reading-row="a">{text}</div></div>;
    }
    const root = document.createElement("div"); root.id = "root"; document.body.append(root);
    root.scrollTop = 300;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    const view = render(<Page text="old" />, { container: root });
    const row = root.querySelector<HTMLElement>("[data-reading-row]");
    if (!row) throw new Error("row missing");
    vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => ({ top, bottom: top + 100 } as DOMRect));
    fireEvent.scroll(root);
    top = 130;
    view.rerender(<Page text="new" />);
    expect(root.scrollTop).toBe(350);
    view.unmount(); root.remove();
  });
});