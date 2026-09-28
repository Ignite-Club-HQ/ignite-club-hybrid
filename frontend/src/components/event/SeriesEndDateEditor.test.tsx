import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeriesEndDateEditor } from "./SeriesEndDateEditor";

type EventRow = {
  id: string;
  title: string;
  club_id: string;
  team_id: string;
  created_by: string;
  type: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  parent_event_id: string | null;
  recurrence_end_date: string | null;
  is_recurring: boolean;
};

const testState = vi.hoisted(() => ({
  events: [] as EventRow[],
  calls: [] as Array<{ operation: string; payload?: unknown }>,
  failure: null as null | { operation: string; error: { code: string; message: string } },
  toast: vi.fn(),
}));

function responseFor(operation: string) {
  const failure = testState.failure?.operation === operation ? testState.failure.error : null;
  return failure ? { data: null, error: failure } : { data: null, error: null };
}

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: testState.toast }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "events") throw new Error(`Unexpected table: ${table}`);

      let operation = "select";
      let payload: any;
      let eqFilter: { column: string; value: unknown } | null = null;
      let inFilter: { column: string; values: unknown[] } | null = null;

      const filteredRows = () => {
        let rows = [...testState.events];
        if (eqFilter) rows = rows.filter((row: any) => row[eqFilter!.column] === eqFilter!.value);
        if (inFilter) rows = rows.filter((row: any) => inFilter!.values.includes(row[inFilter!.column]));
        return rows;
      };

      const execute = async () => {
        testState.calls.push({ operation, payload });
        const failed = responseFor(operation);
        if (failed.error) return failed;

        if (operation === "select") return { data: filteredRows(), error: null };
        if (operation === "insert") {
          const rows = (Array.isArray(payload) ? payload : [payload]).map((row, index) => ({
            ...row,
            id: row.id ?? `generated-${testState.events.length + index + 1}`,
          }));
          testState.events.push(...rows);
          return { data: rows, error: null };
        }
        if (operation === "delete") {
          const ids = new Set(filteredRows().map((row) => row.id));
          testState.events = testState.events.filter((row) => !ids.has(row.id));
          return { data: null, error: null };
        }
        if (operation === "update") {
          for (const row of filteredRows()) Object.assign(row, payload);
          return { data: null, error: null };
        }
        throw new Error(`Unexpected operation: ${operation}`);
      };

      const chain: any = {
        select: () => chain,
        insert: (value: unknown) => {
          operation = "insert";
          payload = value;
          return chain;
        },
        delete: () => {
          operation = "delete";
          return chain;
        },
        update: (value: unknown) => {
          operation = "update";
          payload = value;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          eqFilter = { column, value };
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          inFilter = { column, values };
          return chain;
        },
        order: async (column: keyof EventRow, options: { ascending: boolean }) => {
          const result = await execute();
          if (result.error || !Array.isArray(result.data)) return result;
          result.data.sort((a: any, b: any) => {
            const comparison = String(a[column]).localeCompare(String(b[column]));
            return options.ascending ? comparison : -comparison;
          });
          return result;
        },
        maybeSingle: async () => {
          const result = await execute();
          return result.error
            ? result
            : { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null };
        },
        single: async () => {
          const result = await execute();
          return result.error
            ? result
            : { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: null };
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          execute().then(resolve, reject),
      };
      return chain;
    },
  },
}));

const parentId = "10000000-0000-4000-8000-000000000001";

function occurrence(
  id: string,
  date: string,
  parentEventId: string | null,
  recurrenceEndDate = "2099-08-15",
): EventRow {
  return {
    id,
    title: "Synthetic weekly training",
    club_id: "20000000-0000-4000-8000-000000000001",
    team_id: "30000000-0000-4000-8000-000000000001",
    created_by: "40000000-0000-4000-8000-000000000001",
    type: "training",
    event_date: `${date}T09:00:00.000Z`,
    start_time: `${date}T09:00:00.000Z`,
    end_time: `${date}T10:30:00.000Z`,
    parent_event_id: parentEventId,
    recurrence_end_date: recurrenceEndDate,
    is_recurring: true,
  };
}

function seedSeries(dates = ["2099-08-01", "2099-08-08", "2099-08-15"]) {
  testState.events = dates.map((date, index) =>
    occurrence(
      index === 0 ? parentId : `10000000-0000-4000-8000-00000000000${index + 1}`,
      date,
      index === 0 ? null : parentId,
    ),
  );
}

function renderEditor(canEdit = true) {
  const onUpdated = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SeriesEndDateEditor
        eventId={parentId}
        parentEventId={parentId}
        canEdit={canEdit}
        onUpdated={onUpdated}
      />
    </QueryClientProvider>,
  );
  return { onUpdated };
}

async function changeEndDate(value: string) {
  const input = await screen.findByLabelText(/Series ends on/i);
  fireEvent.change(input, { target: { value } });
}

beforeEach(() => {
  seedSeries();
  testState.calls = [];
  testState.failure = null;
  testState.toast.mockReset();
});

afterEach(() => cleanup());

describe("SeriesEndDateEditor", () => {
  it("shows the current series without exposing edit controls to a read-only member", async () => {
    renderEditor(false);

    expect(await screen.findByText(/3 occurrences/i)).toBeInTheDocument();
    expect(screen.getByText(/last on Sat 15 Aug 2099/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Series ends on/i)).not.toBeInTheDocument();
    expect(testState.calls.every((call) => call.operation === "select")).toBe(true);
  });

  it("extends a weekly series, preserving cadence, duration and parent scope", async () => {
    const { onUpdated } = renderEditor();
    await changeEndDate("2099-08-29");

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(await screen.findByRole("heading", { name: "Extend series?" })).toBeInTheDocument();
    expect(screen.getByText(/add 2 new occurrences/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    const dates = testState.events.map((event) => event.event_date);
    expect(dates).toEqual([
      "2099-08-01T09:00:00.000Z",
      "2099-08-08T09:00:00.000Z",
      "2099-08-15T09:00:00.000Z",
      "2099-08-22T09:00:00.000Z",
      "2099-08-29T09:00:00.000Z",
    ]);

    const added = testState.events.slice(3);
    expect(added).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          club_id: testState.events[0].club_id,
          team_id: testState.events[0].team_id,
          parent_event_id: parentId,
          start_time: "2099-08-22T09:00:00.000Z",
          end_time: "2099-08-22T10:30:00.000Z",
          is_recurring: true,
        }),
        expect.objectContaining({
          start_time: "2099-08-29T09:00:00.000Z",
          end_time: "2099-08-29T10:30:00.000Z",
        }),
      ]),
    );
    expect(testState.events.every((event) => event.recurrence_end_date === "2099-08-29")).toBe(true);
    expect(testState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Series end date updated", description: "Added 2 occurrences." }),
    );
  });

  it("shortens a series by deleting only later children and synchronising the retained records", async () => {
    seedSeries(["2099-08-01", "2099-08-08", "2099-08-15", "2099-08-22"]);
    const { onUpdated } = renderEditor();
    await changeEndDate("2099-08-08");

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    expect(await screen.findByRole("heading", { name: "Shorten series?" })).toBeInTheDocument();
    expect(screen.getByText(/remove 2 future occurrences/i)).toBeInTheDocument();
    expect(screen.getByText(/RSVPs and duties.*will be deleted/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(testState.events.map((event) => event.id)).toEqual([
      parentId,
      "10000000-0000-4000-8000-000000000002",
    ]);
    expect(testState.events.every((event) => event.recurrence_end_date === "2099-08-08")).toBe(true);
    expect(testState.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Series end date updated", description: "Removed 2 future occurrences." }),
    );
  });

  it("does not mutate when the user cancels the confirmation", async () => {
    const original = structuredClone(testState.events);
    const { onUpdated } = renderEditor();
    await changeEndDate("2099-08-29");

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(testState.events).toEqual(original);
    expect(onUpdated).not.toHaveBeenCalled();
    expect(testState.calls.every((call) => call.operation === "select")).toBe(true);
  });

  it("fails closed when creating an extended occurrence is rejected", async () => {
    testState.failure = {
      operation: "insert",
      error: { code: "42501", message: "permission denied for table events" },
    };
    const original = structuredClone(testState.events);
    const { onUpdated } = renderEditor();
    await changeEndDate("2099-08-29");

    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(testState.toast).toHaveBeenCalled());
    expect(testState.events).toEqual(original);
    expect(onUpdated).not.toHaveBeenCalled();
    expect(testState.calls.some((call) => call.operation === "update")).toBe(false);
    expect(testState.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Series end date updated" }),
    );
  });
});
