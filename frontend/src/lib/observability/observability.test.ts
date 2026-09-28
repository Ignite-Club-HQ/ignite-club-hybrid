import { describe, expect, it, vi } from "vitest";
import { ProviderNeutralLogger } from "./logger";
import { ProviderNeutralTelemetry } from "./telemetry";

describe("provider-neutral observability", () => {
  it("redacts sensitive logger attributes and preserves correlation", () => {
    const sink = vi.fn();
    const logger = new ProviderNeutralLogger(sink, "info", "request-123");

    logger.debug("ignored");
    logger.info("loaded", { token: "synthetic-token", count: 2 });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({
      level: "info",
      message: "loaded",
      attributes: { token: "[REDACTED]", count: 2 },
      correlationId: "request-123",
    });
  });

  it("samples and removes unsupported telemetry values", () => {
    const sink = vi.fn();
    const telemetry = new ProviderNeutralTelemetry(sink, 1, () => 0);

    telemetry.record("route_ready", {
      route: "/synthetic",
      user_id: "synthetic-user",
      ignored: { value: true },
    }, 42);

    expect(sink).toHaveBeenCalledWith({
      name: "route_ready",
      value: 42,
      attributes: {
        route: "/synthetic",
        user_id: "[REDACTED]",
      },
    });
  });
});
