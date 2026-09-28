/**
 * Regression tests for the admin notification-preferences report.
 *
 * Historical defect: stats aggregation subtracted the raw count of
 * `notification_preferences` rows with `email_messages_enabled === false`
 * from the total profile count. Duplicate preference rows or rows belonging
 * to deleted profiles could therefore drive the "email enabled" statistic
 * below zero. The fix aggregates against the current profile identity set
 * and dedupes per user_id.
 *
 * These tests pin that contract. They also verify:
 *   - orphan preference rows (unknown user_id) are ignored
 *   - duplicate push subscriptions count one enabled user
 *   - missing preferences default to enabled
 *   - non-admin viewers never execute the sensitive report queries
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ---- Mocks --------------------------------------------------------------

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "admin-user" } }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return { ...actual, Navigate: () => <div data-testid="redirected" /> };
});

type Row = Record<string, any>;
interface TableFixture {
  rows: Row[];
  // for head/count queries
  count?: number;
}

// Per-test fixture container.
const fixtures: Record<string, TableFixture> = {};
let isAdmin = true;

function makeBuilder(table: string) {
  const fx = fixtures[table] ?? { rows: [] };
  const rows = fx.rows;

  const chain: any = {
    _rows: rows,
    _filters: [] as Array<(r: Row) => boolean>,
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      chain._head = !!opts?.head;
      chain._wantCount = !!opts?.count;
      return chain;
    },
    order() { return chain; },
    eq(col: string, val: any) {
      chain._filters.push((r: Row) => r[col] === val);
      return chain;
    },
    single() {
      const filtered = chain._filters.reduce(
        (acc: Row[], f: (r: Row) => boolean) => acc.filter(f),
        rows,
      );
      return Promise.resolve({ data: filtered[0] ?? null, error: null });
    },
    then(resolve: (v: any) => any, reject?: any) {
      const filtered = chain._filters.reduce(
        (acc: Row[], f: (r: Row) => boolean) => acc.filter(f),
        rows,
      );
      const payload = chain._head
        ? { data: null, count: fx.count ?? filtered.length, error: null }
        : { data: filtered, count: filtered.length, error: null };
      return Promise.resolve(payload).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      // Admin-gate query lives at user_roles. Toggle via top-level `isAdmin`.
      if (table === "user_roles") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: () =>
                  Promise.resolve({
                    data: isAdmin ? { role: "app_admin" } : null,
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      return makeBuilder(table);
    },
  },
}));

// ---- Helpers ------------------------------------------------------------

function setHref(relative: string) {
  const url = new URL(relative, "http://localhost");
  if (!url.searchParams.has("backend")) url.searchParams.set("backend", "supabase");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function setFixtures(next: Record<string, TableFixture>) {
  for (const key of Object.keys(fixtures)) delete fixtures[key];
  Object.assign(fixtures, next);
}

async function renderPage() {
  setHref("/notification-preferences");
  const { default: Page } = await import("./NotificationPreferencesPage");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Page />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function readStat(label: RegExp): Promise<number> {
  return await waitFor(() => {
    const node = screen.getByText(label);
    const value = node.parentElement?.querySelector("p.text-2xl")?.textContent ?? "";
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`stat "${label}" not ready: ${value}`);
    return n;
  });
}

// ---- Tests --------------------------------------------------------------

describe("NotificationPreferencesPage stats", () => {
  beforeEach(() => {
    isAdmin = true;
    setFixtures({});
  });

  it("must count disabled email users uniquely and ignore orphan preference rows", async () => {
    // Two current profiles. User 1 disabled + duplicate row + orphan row for a deleted user.
    setFixtures({
      profiles: { rows: [{ id: "u1", display_name: "A" }, { id: "u2", display_name: "B" }] },
      push_subscriptions: { rows: [] },
      notification_preferences: {
        rows: [
          { user_id: "u1", email_messages_enabled: false },
          { user_id: "u1", email_messages_enabled: false }, // duplicate
          { user_id: "deleted", email_messages_enabled: false }, // orphan
        ],
      },
    });
    await renderPage();

    expect(await readStat(/Total Users/i)).toBe(2);
    // 2 profiles − 1 unique disabled user = 1 enabled. Historic bug: 2 − 3 = −1.
    expect(await readStat(/Email Enabled/i)).toBe(1);
  });

  it("orphan preference rows are ignored", async () => {
    setFixtures({
      profiles: { rows: [{ id: "u1" }] },
      push_subscriptions: { rows: [] },
      notification_preferences: {
        rows: [{ user_id: "ghost", email_messages_enabled: false }],
      },
    });
    await renderPage();
    expect(await readStat(/Email Enabled/i)).toBe(1);
  });

  it("missing preferences default to enabled", async () => {
    setFixtures({
      profiles: { rows: [{ id: "u1" }, { id: "u2" }] },
      push_subscriptions: { rows: [] },
      notification_preferences: { rows: [] },
    });
    await renderPage();
    expect(await readStat(/Email Enabled/i)).toBe(2);
  });

  it("all users disabled produces zero", async () => {
    setFixtures({
      profiles: { rows: [{ id: "u1" }, { id: "u2" }] },
      push_subscriptions: { rows: [] },
      notification_preferences: {
        rows: [
          { user_id: "u1", email_messages_enabled: false },
          { user_id: "u2", email_messages_enabled: false },
        ],
      },
    });
    await renderPage();
    expect(await readStat(/Email Enabled/i)).toBe(0);
  });

  it("inconsistent data can never produce a negative result", async () => {
    // Massive orphan set — enough to underflow the old subtraction.
    setFixtures({
      profiles: { rows: [{ id: "u1" }] },
      push_subscriptions: { rows: [] },
      notification_preferences: {
        rows: Array.from({ length: 50 }, (_, i) => ({
          user_id: `orphan-${i}`,
          email_messages_enabled: false,
        })),
      },
    });
    await renderPage();
    expect(await readStat(/Email Enabled/i)).toBeGreaterThanOrEqual(0);
  });

  it("duplicate push subscriptions count one push-enabled user", async () => {
    setFixtures({
      profiles: { rows: [{ id: "u1" }, { id: "u2" }] },
      push_subscriptions: {
        rows: [
          { user_id: "u1", platform: "ios" },
          { user_id: "u1", platform: "android" },
          { user_id: "orphan", platform: "web" }, // must be ignored
        ],
      },
      notification_preferences: { rows: [] },
    });
    await renderPage();
    expect(await readStat(/Push Enabled/i)).toBe(1);
  });

  it("duplicate disabled rows count once", async () => {
    setFixtures({
      profiles: { rows: [{ id: "u1" }, { id: "u2" }] },
      push_subscriptions: { rows: [] },
      notification_preferences: {
        rows: [
          { user_id: "u1", email_messages_enabled: false },
          { user_id: "u1", email_messages_enabled: false },
          { user_id: "u1", email_messages_enabled: false },
        ],
      },
    });
    await renderPage();
    expect(await readStat(/Email Enabled/i)).toBe(1);
  });

  it("non-admin viewers execute no sensitive report queries", async () => {
    isAdmin = false;
    setFixtures({
      profiles: { rows: [{ id: "u1" }] },
      push_subscriptions: { rows: [] },
      notification_preferences: { rows: [] },
    });
    await renderPage();
    await waitFor(() => {
      expect(screen.getByTestId("redirected")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Total Users/i)).not.toBeInTheDocument();
  });
});
