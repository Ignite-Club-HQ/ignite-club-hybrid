import fs from "node:fs";
import path from "node:path";
import React, { Suspense } from "react";
import { describe, expect, it } from "vitest";
import {
  Link,
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package-lock.json"), "utf8"),
);

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </output>
  );
}

function ParameterProbe() {
  const { clubId, eventId } = useParams();
  const [searchParams] = useSearchParams();
  return (
    <div>
      <span>club:{clubId}</span>
      <span>event:{eventId}</span>
      <span>tab:{searchParams.get("tab")}</span>
      <LocationProbe />
    </div>
  );
}

function NavigationHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate("/events/next?tab=rsvp#attendance")}>
        next event
      </button>
      <button onClick={() => navigate(-1)}>back</button>
      <LocationProbe />
    </>
  );
}

describe("React Router behavioural upgrade contract", () => {
  it("matches nested parameters while preserving query and hash state", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/clubs/club%204/events/event%2F7?tab=attendance#player-3",
        ]}
      >
        <Routes>
          <Route
            path="/clubs/:clubId/events/:eventId"
            element={<ParameterProbe />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("club:club 4")).toBeInTheDocument();
    expect(screen.getByText("event:event/7")).toBeInTheDocument();
    expect(screen.getByText("tab:attendance")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/clubs/club%204/events/event%2F7?tab=attendance#player-3",
    );
  });

  it("uses replace redirects without leaving the protected location in history", () => {
    render(
      <MemoryRouter initialEntries={["/events/private"]}>
        <Routes>
          <Route path="/events/private" element={<Navigate to="/auth" replace />} />
          <Route path="/auth" element={<NavigationHarness />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("location")).toHaveTextContent("/auth");
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/auth");
  });

  it("preserves browser history for ordinary in-app navigation", () => {
    render(
      <MemoryRouter initialEntries={["/events/current"]}>
        <Routes>
          <Route path="*" element={<NavigationHarness />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "next event" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/events/next?tab=rsvp#attendance",
    );
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/events/current");
  });

  it("resolves nested relative redirects at the club route boundary", () => {
    render(
      <MemoryRouter initialEntries={["/clubs/club-7/attendance"]}>
        <LocationProbe />
        <Routes>
          <Route path="/clubs/:clubId">
            <Route
              path="attendance"
              element={<Navigate to="../engagement" replace />}
            />
            <Route path="engagement" element={<div>engagement report</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("engagement report")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/clubs/club-7/engagement",
    );
  });

  it("keeps reserved characters inside an encoded invite-token segment", () => {
    const token = encodeURIComponent("a/b?next=//attacker.test#fragment");
    render(
      <MemoryRouter initialEntries={[`/join/p/${token}`]}>
        <Routes>
          <Route
            path="/join/p/:token"
            element={<ParameterInviteToken />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("invite-token")).toHaveTextContent(
      "a/b?next=//attacker.test#fragment",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(`/join/p/${token}`);
  });

  it("creates same-origin links for every application route used by navigation", () => {
    const routes = [
      "/",
      "/events",
      "/events/event-1?tab=attendance",
      "/clubs/club-1/engagement",
      "/messages/club/club-1",
      "/media?photo=photo-1",
      "/vault/folder/folder-1",
      "/join/p/synthetic-token",
      "/verify-reset-code?email=member%40example.test",
    ];

    render(
      <MemoryRouter>
        {routes.map((route) => (
          <Link key={route} to={route}>
            {route}
          </Link>
        ))}
      </MemoryRouter>,
    );

    for (const route of routes) {
      const href = screen.getByRole("link", { name: route }).getAttribute("href");
      expect(href).toBe(route);
      expect(href).toMatch(/^\/(?!\/)/);
    }
  });
});

describe("React Router v7 future behaviour on the v6 control version", () => {
  it("resolves links from the full splat location when the v7 flag is enabled", () => {
    render(
      <MemoryRouter
        initialEntries={["/files/club-7/season-2"]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Routes>
          <Route
            path="/files/*"
            element={
              <>
                <Link to="details">open details</Link>
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("link", { name: "open details" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/files/club-7/season-2/details",
    );
  });

  it("keeps the current screen visible while a v7 transition waits for a lazy route", async () => {
    let resolveModule!: (module: { default: React.ComponentType }) => void;
    const LazyDestination = React.lazy(
      () =>
        new Promise<{ default: React.ComponentType }>((resolve) => {
          resolveModule = resolve;
        }),
    );

    render(
      <MemoryRouter
        initialEntries={["/current"]}
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
      >
        <Suspense fallback={<div>loading destination</div>}>
          <Routes>
            <Route
              path="/current"
              element={<Link to="/lazy-destination">open lazy destination</Link>}
            />
            <Route path="/lazy-destination" element={<LazyDestination />} />
          </Routes>
        </Suspense>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("link", { name: "open lazy destination" }),
    );

    expect(
      screen.getByRole("link", { name: "open lazy destination" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("loading destination")).not.toBeInTheDocument();

    resolveModule({ default: () => <div>lazy destination ready</div> });
    expect(await screen.findByText("lazy destination ready")).toBeInTheDocument();
  });
});

function ParameterInviteToken() {
  const { token } = useParams();
  return (
    <>
      <span data-testid="invite-token">{token}</span>
      <LocationProbe />
    </>
  );
}

describe("React Router 7 security-upgrade acceptance gates", () => {
  it("uses the patched React Router line required by current advisories", () => {
    const version =
      packageJson.dependencies?.["react-router-dom"] ??
      packageJson.devDependencies?.["react-router-dom"];
    expect(version).toBeDefined();
    expect(String(version)).toBe("7.18.2");
    expect(packageLock.packages?.["node_modules/react-router-dom"]?.version).toBe("7.18.2");
    expect(packageLock.packages?.["node_modules/react-router"]?.version).toBe("7.18.2");
  });

  it("does not retain a separate direct react-router version that can drift", () => {
    expect(packageJson.dependencies?.["react-router"]).toBeUndefined();
    expect(packageJson.devDependencies?.["react-router"]).toBeUndefined();
  });
});
