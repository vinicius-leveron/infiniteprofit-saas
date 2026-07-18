import { describe, expect, it } from "vitest";
import {
  evaluateCanaryRuns,
  evaluateGatewayDrillReport,
  evaluateLoadReport,
  evaluateOnboardingReport,
  evaluateRestoreReport,
  evaluateRlsReport,
  evaluateRuntime,
  evaluateSqsSnapshot,
  readinessSummary,
} from "../../scripts/backend-readiness-core.mjs";

const now = new Date("2026-07-18T12:00:00Z");

describe("backend market readiness", () => {
  it("holds when the runtime has connection pressure, locks, or unclassified DLQ", () => {
    const checks = evaluateRuntime({
      project_status: "ACTIVE_HEALTHY",
      max_connections: 60,
      total_connections: 45,
      lock_waits: 1,
      expected_cron_jobs: 3,
      active_expected_cron_jobs: 3,
      unexpected_legacy_cron_jobs: 0,
      ready_jobs: 1,
      oldest_ready_age_seconds: 20,
      expired_running_jobs: 0,
      unclassified_dead_letters: 2,
      permanent_dead_letters: 1,
      invalid_critical_indexes: 0,
      raw_events_live_tuples: 20_000,
      raw_events_dead_tuples: 5_000,
      raw_events_autovacuum_age_seconds: 90_000,
    });

    expect(checks.find((check) => check.id === "connection_headroom")?.status)
      .toBe("hold");
    expect(checks.find((check) => check.id === "lock_waits")?.status)
      .toBe("hold");
    expect(checks.find((check) => check.id === "sync_dlq")?.status)
      .toBe("hold");
    expect(checks.find((check) => check.id === "raw_events_maintenance")?.status)
      .toBe("hold");
  });

  it("requires continuous successful canaries for the full window", () => {
    const runs = Array.from({ length: 96 }, (_, index) => {
      const createdAt = new Date(
        now.getTime() - (95 - index) * 15 * 60 * 1_000,
      );
      return {
        created_at: createdAt.toISOString(),
        updated_at: new Date(createdAt.getTime() + 60_000).toISOString(),
        status: "completed",
        conclusion: "success",
      };
    });

    expect(evaluateCanaryRuns(runs, { now }).status).toBe("pass");
    expect(evaluateCanaryRuns(runs.slice(-10), { now }).status).toBe("hold");
    runs[50].conclusion = "failure";
    expect(evaluateCanaryRuns(runs, { now }).status).toBe("hold");
  });

  it("accepts only authenticated staging load at twice the expected peak", () => {
    const report = {
      schema_version: 1,
      ok: true,
      production: false,
      mode: "authenticated",
      target: "staging.supabase.co",
      virtual_users: 20,
      actual_duration_seconds: 900,
      scenarios: {
        auth: { error_rate: 0, p95_ms: 600 },
        rest: { error_rate: 0, p95_ms: 250 },
        health_rpc: { error_rate: 0, p95_ms: 300 },
      },
      database: {
        ok: true,
        project_ref: "staging",
        samples: 61,
        max_connection_utilization: 0.4,
        max_lock_waits: 0,
        max_expired_running_jobs: 0,
        max_unclassified_dead_letters: 0,
      },
    };

    expect(evaluateLoadReport(report, 10).status).toBe("pass");
    expect(evaluateLoadReport({ ...report, production: true }, 10).status)
      .toBe("hold");
    expect(evaluateLoadReport({ ...report, virtual_users: 19 }, 10).status)
      .toBe("hold");
    expect(evaluateLoadReport({ ...report, database: undefined }, 10).status)
      .toBe("hold");
  });

  it("requires recent, isolated and idempotent recovery and gateway drills", () => {
    const restore = {
      schema_version: 1,
      environment: "isolated_restore",
      completed_at: "2026-07-18T11:00:00Z",
      counts: {
        raw_events: 100,
        daily_metrics: 10,
        workspaces: 2,
        projects: 3,
      },
      bindings_verified: true,
      idempotency_verified: true,
      rto_minutes: 20,
      artifact_url: "https://example.test/restore",
    };
    const gateway = {
      schema_version: 1,
      environment: "staging",
      completed_at: "2026-07-18T11:00:00Z",
      webhook_acknowledged_while_consumer_stopped: true,
      message_persisted_in_queue: true,
      delivered_once_after_resume: true,
      duplicate_did_not_change_metrics: true,
      dlq_depth: 0,
      artifact_url: "https://example.test/gateway",
    };

    expect(evaluateRestoreReport(restore, { now }).status).toBe("pass");
    expect(evaluateGatewayDrillReport(gateway, { now }).status).toBe("pass");
    expect(
      evaluateRestoreReport({ ...restore, idempotency_verified: false }, { now })
        .status,
    ).toBe("hold");
  });

  it("does not consider an empty SQS healthy without a live consumer", () => {
    const queue = {
      configured: true,
      visible_messages: 0,
      oldest_message_seconds: 0,
      dead_letter_messages: 0,
      consumer_status: "healthy",
      consumer_heartbeat_age_seconds: 30,
    };
    expect(evaluateSqsSnapshot(queue).status).toBe("pass");
    expect(
      evaluateSqsSnapshot({
        ...queue,
        consumer_heartbeat_age_seconds: 121,
      }).status,
    ).toBe("hold");
    expect(
      evaluateSqsSnapshot({ ...queue, consumer_status: "stopping" }).status,
    ).toBe("hold");
  });

  it("rejects stale or unversioned onboarding and RLS evidence", () => {
    const onboarding = {
      schema_version: 1,
      environment: "staging",
      completed_at: "2026-07-18T11:00:00Z",
      login: true,
      bootstrap_account: true,
      first_funnel: true,
      activation_redirect: true,
      secrets_not_persisted: true,
      artifact_url: "https://example.test/onboarding",
    };
    const rls = {
      schema_version: 1,
      environment: "staging",
      completed_at: "2026-07-18T11:00:00Z",
      ok: true,
      member_redacted: true,
      admin_inherited_access: true,
      direct_credentials_denied: true,
      sync_token_denied: true,
      artifact_url: "https://example.test/rls",
    };

    expect(evaluateOnboardingReport(onboarding, { now }).status).toBe("pass");
    expect(evaluateRlsReport(rls, { now }).status).toBe("pass");
    expect(
      evaluateOnboardingReport({ ...onboarding, schema_version: 0 }, { now })
        .status,
    ).toBe("hold");
    expect(
      evaluateRlsReport({ ...rls, environment: "production" }, { now }).status,
    ).toBe("hold");
  });

  it("returns one explicit release decision", () => {
    expect(
      readinessSummary([
        { id: "one", status: "pass", evidence: "ok" },
        { id: "two", status: "hold", evidence: "missing" },
      ], now),
    ).toMatchObject({
      decision: "hold",
      passed: 1,
      total: 2,
      holds: ["two"],
    });
  });
});
