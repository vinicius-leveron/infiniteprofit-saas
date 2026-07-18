import { describe, expect, it, vi } from "vitest";
import { runBackendCanary } from "../../supabase/functions/backend-canary/core";

const targets = [
  {
    name: "frontend" as const,
    url: "https://app.example.test",
    thresholdMs: 3_000,
  },
  {
    name: "auth" as const,
    url: "https://api.example.test/auth/v1/health",
    thresholdMs: 2_000,
  },
  {
    name: "postgrest" as const,
    url: "https://api.example.test/rest/v1/rpc/backend_healthcheck",
    thresholdMs: 800,
  },
];

describe("backend internal canary", () => {
  it("passes only when every sample and SLO is healthy", async () => {
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 }));
    const report = await runBackendCanary({
      targets,
      fetcher,
      sampleCount: 2,
    });

    expect(report.status).toBe("pass");
    expect(report.results).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it("records a failed target without leaking response bodies", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      new Response(
        String(input).includes("backend_healthcheck")
          ? "database secret detail"
          : "ok",
        {
          status: String(input).includes("backend_healthcheck") ? 500 : 200,
        },
      )
    );
    const report = await runBackendCanary({
      targets,
      fetcher,
      sampleCount: 1,
    });

    expect(report.status).toBe("fail");
    expect(report.results.find((result) => result.name === "postgrest"))
      .toMatchObject({
        ok: false,
        statuses: { "500": 1 },
      });
    expect(JSON.stringify(report)).not.toContain("database secret detail");
  });
});
