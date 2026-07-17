import { describe, expect, it } from "vitest";
import {
  deriveOverallHealth,
  deriveSourceHealth,
  type SourceHealthSignal,
} from "./sourceHealth";

const NOW = new Date("2026-07-17T12:00:00.000Z").getTime();

function signal(overrides: Partial<SourceHealthSignal> = {}): SourceHealthSignal {
  return {
    workspaceId: "client-a",
    projectId: "funnel-a",
    source: "meta",
    configured: true,
    lastSuccessAt: "2026-07-17T10:00:00.000Z",
    lastEventAt: "2026-07-17T10:00:00.000Z",
    lastErrorAt: null,
    syncing: false,
    warningCount: 0,
    criticalCount: 0,
    ...overrides,
  };
}

describe("source health", () => {
  it("keeps an unconfigured source neutral", () => {
    expect(deriveSourceHealth(signal({ configured: false }), NOW).status).toBe("not_configured");
  });

  it("prioritizes an active sync over stale data", () => {
    expect(
      deriveSourceHealth(
        signal({ syncing: true, lastSuccessAt: "2026-07-01T00:00:00.000Z" }),
        NOW,
      ).status,
    ).toBe("syncing");
  });

  it("marks a failure newer than the last success as an error", () => {
    expect(
      deriveSourceHealth(
        signal({ lastErrorAt: "2026-07-17T11:00:00.000Z" }),
        NOW,
      ).status,
    ).toBe("error");
  });

  it("does not let another funnel's timestamp affect this signal", () => {
    const stale = deriveSourceHealth(
      signal({
        projectId: "funnel-stale",
        lastSuccessAt: "2026-07-10T10:00:00.000Z",
        lastEventAt: null,
      }),
      NOW,
    );
    const healthy = deriveSourceHealth(
      signal({ projectId: "funnel-healthy" }),
      NOW,
    );

    expect(stale.status).toBe("warning");
    expect(healthy.status).toBe("healthy");
  });

  it("uses the worst configured source for the overall status", () => {
    expect(
      deriveOverallHealth([
        deriveSourceHealth(signal({ source: "meta" }), NOW),
        deriveSourceHealth(signal({ source: "vturb", warningCount: 1 }), NOW),
      ]),
    ).toBe("warning");
  });
});
