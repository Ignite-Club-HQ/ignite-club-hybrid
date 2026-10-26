import { describe, expect, it } from "vitest";
import { pollResultsToData } from "./pollReadRepository";

const principal = (text: string) => ({ toText: () => text });

function candidResults(overrides: Record<string, unknown> = {}) {
  return {
    poll: {
      id: "poll-1",
      question: "Training day?",
      options: ["Tuesday", "Thursday"],
      closed: false,
      created_at_ms: 1_760_000_000_000,
      creator: principal("aaaaa-aa"),
    },
    counts: [3, 1],
    total_votes: 4,
    votes: [
      [
        { user: principal("user-a"), option_index: 0 },
        { user: principal("user-b"), option_index: 0 },
      ],
    ],
    ...overrides,
  };
}

describe("pollResultsToData", () => {
  it("maps individual votes when the canister provides them", () => {
    const data = pollResultsToData("poll-1", candidResults());
    expect(data.poll.question).toBe("Training day?");
    expect(data.options).toEqual([
      { id: "0", label: "Tuesday", position: 0 },
      { id: "1", label: "Thursday", position: 1 },
    ]);
    expect(data.votes).toEqual([
      { id: "poll-1:user-a", option_id: "0", user_id: "user-a" },
      { id: "poll-1:user-b", option_id: "0", user_id: "user-b" },
    ]);
    expect(data.voterDetailsAvailable).toBe(true);
    expect(data.closed).toBe(false);
  });

  it("expands anonymous counts when individual votes are absent", () => {
    const data = pollResultsToData("poll-1", candidResults({ votes: [] }));
    expect(data.votes).toHaveLength(4);
    expect(data.votes.filter(v => v.option_id === "0")).toHaveLength(3);
    expect(data.votes.filter(v => v.option_id === "1")).toHaveLength(1);
    expect(data.voterDetailsAvailable).toBe(false);
  });

  it("marks closed polls with a closed_at timestamp", () => {
    const data = pollResultsToData("poll-1", candidResults({
      poll: { ...candidResults().poll, closed: true },
    }));
    expect(data.closed).toBe(true);
    expect(data.poll.closed_at).not.toBeNull();
  });
});
