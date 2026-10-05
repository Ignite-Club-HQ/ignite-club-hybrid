import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleMapEmbed } from "./GoogleMapEmbed";

describe("GoogleMapEmbed", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("embeds the event address using the public browser key", () => {
    vi.stubEnv("IGNITE_LIVE_GOOGLE_MAPS_BROWSER_KEY", "public-test-key");
    render(<GoogleMapEmbed address="35 Driffield, Adelaide SA" />);
    const frame = screen.getByTitle("Event location map");
    expect(frame).toHaveAttribute(
      "src",
      "https://www.google.com/maps/embed/v1/place?key=public-test-key&q=35%20Driffield%2C%20Adelaide%20SA",
    );
  });

  it("offers a usable map link instead of a broken frame when no key is configured", () => {
    vi.stubEnv("IGNITE_LIVE_GOOGLE_MAPS_BROWSER_KEY", "");
    render(<GoogleMapEmbed address="35 Driffield" />);
    expect(screen.queryByTitle("Event location map")).toBeNull();
    expect(screen.getByRole("link", { name: /View location on Google Maps/i })).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=35%20Driffield",
    );
  });
});