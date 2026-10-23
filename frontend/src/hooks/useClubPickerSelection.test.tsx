import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useClubPickerSelection } from "./useClubPickerSelection";

const mocks = vi.hoisted(() => ({
  location: { pathname: "/messages/u9", search: "?message=old" },
  activeClubTheme: "giddy-goat" as string | null,
  setActiveClubTheme: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useLocation: () => mocks.location, useNavigate: () => mocks.navigate }));
vi.mock("./useClubTheme", () => ({ useClubTheme: () => mocks }));

describe("explicit club picker navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeClubTheme = "giddy-goat";
    mocks.location = { pathname: "/messages/u9", search: "" };
  });
  it.each([
    ["/messages/u9", "/messages"],
    ["/messages/club/giddy-goat", "/messages"],
    ["/messages/club-admin/committee", "/messages"],
    ["/groups/coaches", "/messages"],
    ["/events/training/edit", "/events"],
    ["/clubs/giddy-goat/roles", "/clubs"],
    ["/teams/u9", "/"],
    ["/news/post", "/news"],
    ["/vault/folder/private", "/vault"],
    ["/media/photo", "/media"],
  ])("leaves %s immediately for %s on another club selection", (pathname, destination) => {
    mocks.location.pathname = pathname;
    const { result } = renderHook(useClubPickerSelection);
    act(() => result.current("riverdogs"));
    expect(mocks.navigate).toHaveBeenCalledWith(destination, { replace: true });
    expect(mocks.navigate.mock.invocationCallOrder[0]).toBeLessThan(mocks.setActiveClubTheme.mock.invocationCallOrder[0]);
    expect(mocks.setActiveClubTheme).toHaveBeenCalledWith("riverdogs");
  });
  it.each(["/", "/messages", "/events", "/clubs", "/media", "/news", "/profile", "/settings", "/admin/users"])("keeps general page %s", pathname => {
    mocks.location.pathname = pathname;
    const { result } = renderHook(useClubPickerSelection);
    act(() => result.current("riverdogs"));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("does not navigate on restoration or a render", () => {
    const { rerender } = renderHook(useClubPickerSelection);
    mocks.activeClubTheme = "riverdogs";
    rerender();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.setActiveClubTheme).not.toHaveBeenCalled();
  });
  it.each(["giddy-goat", null])("keeps content for unchanged or All Clubs selection %s", club => {
    const { result } = renderHook(useClubPickerSelection);
    act(() => result.current(club));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("keeps a direct page already belonging to the new club", () => {
    mocks.location.pathname = "/clubs/riverdogs";
    const { result } = renderHook(useClubPickerSelection);
    act(() => result.current("riverdogs"));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("leaves open content when selecting from All Clubs", () => {
    mocks.activeClubTheme = null;
    const { result } = renderHook(useClubPickerSelection);
    act(() => result.current("riverdogs"));
    expect(mocks.navigate).toHaveBeenCalledWith("/messages", { replace: true });
  });
  it.each([["/media", "?photo=old&comments=1", "/media"], ["/vault", "?team=u9", "/vault"]])("clears stale content links on %s", (pathname, search, destination) => {
    mocks.location = { pathname, search };
    const { result } = renderHook(useClubPickerSelection);
    act(() => result.current("riverdogs"));
    expect(mocks.navigate).toHaveBeenCalledWith(destination, { replace: true });
  });
});