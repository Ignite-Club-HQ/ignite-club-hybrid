import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TeamAddAdminCard } from "./TeamAddAdminCard";

describe("TeamAddAdminCard", () => {
  it("renders the promote-to-admin entry point", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TeamAddAdminCard
          teamId="team-1"
          teamName="U12 Blue"
          clubId="club-1"
          members={{}}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Team Admin Management")).toBeInTheDocument();
    expect(
      screen.getByText("Add another admin to help manage the team"),
    ).toBeInTheDocument();
  });
});
