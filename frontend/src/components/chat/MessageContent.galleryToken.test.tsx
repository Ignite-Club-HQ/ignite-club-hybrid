import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./GalleryLinkCard", () => ({ GalleryLinkCard: ({ cardId }: { cardId: string }) => <div>gallery card {cardId}</div> }));
import { MessageContent } from "./MessageContent";

describe("team photo cards in chat", () => {
  it("shows an on-chain gallery card instead of the raw code", () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <MessageContent text="[gallery:gallery-card-5472a18b-41ed-4c31-baf2-61739d1cffcd-1]" />
    </MemoryRouter></QueryClientProvider>);
    expect(screen.getByText("gallery card gallery-card-5472a18b-41ed-4c31-baf2-61739d1cffcd-1")).toBeTruthy();
    expect(screen.queryByText(/\[gallery:/)).toBeNull();
  });
});
