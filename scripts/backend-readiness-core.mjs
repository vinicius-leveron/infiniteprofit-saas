export const READINESS_LIMITS = Object.freeze({
  connectionUtilization: 0.7,
  oldestReadyJobSeconds: 300,
  canaryIntervalMinutes: 15,
  canaryCoverageRatio: 0.9,
  externalCanaryMinimumRuns: 6,
  externalCanaryMaximumAgeMinutes: 120,
  evidenceMaxAgeDays: 30,
  authP95Ms: 2_000,
  restP95Ms: 800,
  maximumErrorRate: 0.01,
  minimumLoadDurationSeconds: 15 * 60,
  gatewayQueueDepth: 100,
  gatewayQueueAgeSeconds: 300,
  rawEventsAutovacuumAgeSeconds: 24 * 60 * 60,
  rawEventsDeadTupleRatio: 0.2,
});

export function evaluateRuntime(snapshot, limits = READINESS_LIMITS) {
  const maxConnections = Number(snapshot.max_connections ?? 0);
  const totalConnections = Number(snapshot.total_connections ?? 0);
  const utilization =
    maxConnections > 0 ? totalConnections / maxConnections : 1;
  const rawEventsLiveTuples = Number(snapshot.raw_events_live_tuples ?? 0);
  const rawEventsDeadTuples = Number(snapshot.raw_events_dead_tuples ?? 0);
  const rawEventsDeadTupleRatio =
    rawEventsDeadTuples / Math.max(1, rawEventsLiveTuples);
  const rawEventsAutovacuumAgeSeconds = Number(
    snapshot.raw_events_autovacuum_age_seconds ?? Infinity,
  );
  const rawEventsMaintenanceHealthy =
    rawEventsLiveTuples < 10_000 ||
    (
      rawEventsAutovacuumAgeSeconds <=
        limits.rawEventsAutovacuumAgeSeconds &&
      rawEventsDeadTupleRatio <= limits.rawEventsDeadTupleRatio
    );

  return [
    check(
      "control_plane",
      snapshot.project_status === "ACTIVE_HEALTHY",
      `Supabase status: ${snapshot.project_status ?? "unknown"}`,
    ),
    check(
      "connection_headroom",
      utilization < limits.connectionUtilization,
      `${totalConnections}/${maxConnections} connections (${formatPercent(utilization)})`,
    ),
    check(
      "lock_waits",
      Number(snapshot.lock_waits ?? 0) === 0,
      `${Number(snapshot.lock_waits ?? 0)} lock wait(s)`,
    ),
    check(
      "background_cron",
      Number(snapshot.expected_cron_jobs ?? 0) === 4 &&
        Number(snapshot.active_expected_cron_jobs ?? 0) === 4 &&
        Number(snapshot.unexpected_legacy_cron_jobs ?? 0) === 0,
      `${Number(snapshot.active_expected_cron_jobs ?? 0)}/4 expected active; ${
        Number(snapshot.unexpected_legacy_cron_jobs ?? 0)
      } legacy active`,
    ),
    check(
      "sync_queue",
      Number(snapshot.oldest_ready_age_seconds ?? 0) <=
          limits.oldestReadyJobSeconds &&
        Number(snapshot.expired_running_jobs ?? 0) === 0,
      `${Number(snapshot.ready_jobs ?? 0)} ready; oldest ${
        Number(snapshot.oldest_ready_age_seconds ?? 0)
      }s; ${Number(snapshot.expired_running_jobs ?? 0)} expired running`,
    ),
    check(
      "sync_dlq",
      Number(snapshot.unclassified_dead_letters ?? 0) === 0,
      `${Number(snapshot.unclassified_dead_letters ?? 0)} unclassified; ${
        Number(snapshot.permanent_dead_letters ?? 0)
      } classified permanent; ${
        Number(snapshot.superseded_dead_letters ?? 0)
      } classified superseded`,
    ),
    check(
      "critical_indexes",
      Number(snapshot.invalid_critical_indexes ?? 0) === 0,
      `${Number(snapshot.invalid_critical_indexes ?? 0)} invalid/not-ready`,
    ),
    check(
      "raw_events_maintenance",
      rawEventsMaintenanceHealthy,
      `live=${rawEventsLiveTuples}; dead=${rawEventsDeadTuples} (${
        formatPercent(rawEventsDeadTupleRatio)
      }); last_autovacuum=${rawEventsAutovacuumAgeSeconds}s`,
    ),
  ];
}

export function evaluateProbe(report, limits = READINESS_LIMITS) {
  const byName = new Map(
    Array.isArray(report?.results)
      ? report.results.map((result) => [result.name, result])
      : [],
  );
  const frontend = byName.get("frontend");
  const auth = byName.get("auth-health");
  const rest = byName.get("postgrest");

  return check(
    "live_probe",
    report?.ok === true &&
      frontend?.availability === 1 &&
      auth?.availability === 1 &&
      rest?.availability === 1 &&
      Number(auth?.p95_ms ?? Infinity) < limits.authP95Ms &&
      Number(rest?.p95_ms ?? Infinity) < limits.restP95Ms,
    `frontend=${describeProbe(frontend)}, auth=${describeProbe(auth)}, rest=${
      describeProbe(rest)
    }`,
  );
}

export function evaluateAuthEmailDelivery(
  config,
  { minimumEmailsPerHour = 30 } = {},
) {
  const customSmtpConfigured = Boolean(
    String(config?.smtp_host ?? "").trim() &&
      String(config?.smtp_user ?? "").trim() &&
      String(config?.smtp_admin_email ?? "").trim(),
  );
  const emailRateLimit = Number(config?.rate_limit_email_sent ?? 0);
  const confirmationRequired = config?.mailer_autoconfirm !== true;

  return check(
    "auth_email_delivery",
    customSmtpConfigured &&
      confirmationRequired &&
      emailRateLimit >= minimumEmailsPerHour,
    `custom_smtp=${customSmtpConfigured}; confirmation_required=${
      confirmationRequired
    }; email_limit=${emailRateLimit}/${minimumEmailsPerHour} per hour`,
  );
}

export function evaluateCanaryRuns(
  runs,
  {
    now = new Date(),
    windowHours = 24,
    limits = READINESS_LIMITS,
  } = {},
) {
  const windowStart = new Date(now.getTime() - windowHours * 60 * 60 * 1_000);
  const inWindow = (Array.isArray(runs) ? runs : [])
    .filter((run) => {
      const createdAt = Date.parse(run.created_at ?? "");
      return Number.isFinite(createdAt) && createdAt >= windowStart.getTime();
    })
    .sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at)
    );
  const expectedRuns =
    windowHours * 60 / limits.canaryIntervalMinutes;
  const minimumRuns = Math.floor(expectedRuns * limits.canaryCoverageRatio);
  const failedRuns = inWindow.filter(
    (run) => run.status !== "completed" || run.conclusion !== "success",
  );
  const oldestAt = Date.parse(inWindow[0]?.created_at ?? "");
  const newestAt = Date.parse(inWindow.at(-1)?.updated_at ?? "");
  const maximumGapMs = limits.canaryIntervalMinutes * 2 * 60 * 1_000;
  const hasStartCoverage =
    Number.isFinite(oldestAt) && oldestAt - windowStart.getTime() <= maximumGapMs;
  const hasRecentCoverage =
    Number.isFinite(newestAt) && now.getTime() - newestAt <= maximumGapMs;

  return check(
    "canary_24h",
    inWindow.length >= minimumRuns &&
      failedRuns.length === 0 &&
      hasStartCoverage &&
      hasRecentCoverage,
    `${inWindow.length}/${minimumRuns} minimum runs; ${
      failedRuns.length
    } failed/incomplete; start=${hasStartCoverage}; recent=${hasRecentCoverage}`,
  );
}

export function evaluateInternalCanaryRuns(runs, options = {}) {
  const normalized = (Array.isArray(runs) ? runs : []).map((run) => ({
    created_at: run.created_at,
    updated_at: run.finished_at ?? run.created_at,
    status: "completed",
    conclusion: run.status === "pass" ? "success" : "failure",
  }));
  return {
    ...evaluateCanaryRuns(normalized, options),
    id: "internal_canary_24h",
  };
}

export function evaluateExternalCanaryRuns(
  runs,
  {
    now = new Date(),
    windowHours = 24,
    limits = READINESS_LIMITS,
  } = {},
) {
  const windowStart = now.getTime() - windowHours * 60 * 60 * 1_000;
  const inWindow = (Array.isArray(runs) ? runs : [])
    .filter((run) => {
      const createdAt = Date.parse(run.created_at ?? "");
      return Number.isFinite(createdAt) && createdAt >= windowStart;
    })
    .sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at)
    );
  const failedRuns = inWindow.filter(
    (run) => run.status !== "completed" || run.conclusion !== "success",
  );
  const newestAt = Date.parse(inWindow.at(-1)?.updated_at ?? "");
  const recent = Number.isFinite(newestAt) &&
    now.getTime() - newestAt <=
      limits.externalCanaryMaximumAgeMinutes * 60 * 1_000;

  return check(
    "external_canary_24h",
    inWindow.length >= limits.externalCanaryMinimumRuns &&
      failedRuns.length === 0 &&
      recent,
    `${inWindow.length}/${limits.externalCanaryMinimumRuns} minimum independent runs; ${
      failedRuns.length
    } failed/incomplete; recent=${recent}`,
  );
}

export function evaluateLoadReport(
  report,
  expectedPeakVirtualUsers,
  limits = READINESS_LIMITS,
) {
  const scenarios = Object.values(report?.scenarios ?? {});
  const enoughLoad =
    Number.isFinite(expectedPeakVirtualUsers) &&
    expectedPeakVirtualUsers > 0 &&
    Number(report?.virtual_users ?? 0) >= expectedPeakVirtualUsers * 2;
  const scenariosHealthy =
    scenarios.length >= 3 &&
    scenarios.every((scenario) =>
      Number(scenario?.error_rate ?? 1) < limits.maximumErrorRate
    ) &&
    Number(report?.scenarios?.auth?.p95_ms ?? Infinity) < limits.authP95Ms &&
    Number(report?.scenarios?.rest?.p95_ms ?? Infinity) < limits.restP95Ms &&
    Number(report?.scenarios?.health_rpc?.p95_ms ?? Infinity) <
      limits.restP95Ms;
  const databaseHealthy =
    report?.database?.ok === true &&
    String(report?.target ?? "").includes(
      String(report?.database?.project_ref ?? "__missing_project_ref__"),
    ) &&
    Number(report?.database?.samples ?? 0) >= 2 &&
    Number(report?.database?.max_connection_utilization ?? Infinity) <
      limits.connectionUtilization &&
    Number(report?.database?.max_lock_waits ?? Infinity) === 0 &&
    Number(report?.database?.max_expired_running_jobs ?? Infinity) === 0 &&
    Number(report?.database?.max_unclassified_dead_letters ?? Infinity) === 0;

  return check(
    "staging_load_2x",
    report?.schema_version === 1 &&
      report?.ok === true &&
      report?.production === false &&
      report?.mode === "authenticated" &&
      enoughLoad &&
      Number(report?.actual_duration_seconds ?? 0) >=
        limits.minimumLoadDurationSeconds &&
      scenariosHealthy &&
      databaseHealthy,
    `target=${report?.target ?? "missing"}; VUs=${
      Number(report?.virtual_users ?? 0)
    }; expected_peak=${expectedPeakVirtualUsers ?? "missing"}; duration=${
      Number(report?.actual_duration_seconds ?? 0)
    }s; database=${databaseHealthy}`,
  );
}

export function evaluateRestoreReport(
  report,
  { now = new Date(), limits = READINESS_LIMITS } = {},
) {
  const fresh = isFresh(report?.completed_at, now, limits.evidenceMaxAgeDays);
  const counts = report?.counts ?? {};
  const countsVerified = ["raw_events", "daily_metrics", "workspaces", "projects"]
    .every((key) =>
      Number.isFinite(Number(counts[key])) && Number(counts[key]) >= 0
    );

  return check(
    "restore_drill",
    report?.schema_version === 1 &&
      report?.environment === "isolated_restore" &&
      fresh &&
      countsVerified &&
      report?.bindings_verified === true &&
      report?.idempotency_verified === true &&
      Number(report?.rto_minutes ?? Infinity) <= 60 &&
      Boolean(report?.artifact_url),
    `environment=${report?.environment ?? "missing"}; fresh=${fresh}; idempotency=${
      report?.idempotency_verified === true
    }; RTO=${report?.rto_minutes ?? "missing"}m`,
  );
}

export function evaluateGatewayDrillReport(
  report,
  { now = new Date(), limits = READINESS_LIMITS } = {},
) {
  const fresh = isFresh(report?.completed_at, now, limits.evidenceMaxAgeDays);
  return check(
    "gateway_db_outage_drill",
    report?.schema_version === 1 &&
      report?.environment === "staging" &&
      fresh &&
      report?.webhook_acknowledged_while_consumer_stopped === true &&
      report?.message_persisted_in_queue === true &&
      report?.delivered_once_after_resume === true &&
      report?.duplicate_did_not_change_metrics === true &&
      report?.dlq_depth === 0 &&
      Boolean(report?.artifact_url),
    `environment=${report?.environment ?? "missing"}; fresh=${fresh}; queued=${
      report?.message_persisted_in_queue === true
    }; idempotent=${report?.duplicate_did_not_change_metrics === true}`,
  );
}

export function evaluateOnboardingReport(
  report,
  { now = new Date(), limits = READINESS_LIMITS } = {},
) {
  const fresh = isFresh(report?.completed_at, now, limits.evidenceMaxAgeDays);
  return check(
    "staging_onboarding",
    report?.schema_version === 1 &&
      report?.environment === "staging" &&
      fresh &&
      report?.login === true &&
      report?.bootstrap_account === true &&
      report?.first_funnel === true &&
      report?.activation_redirect === true &&
      report?.secrets_not_persisted === true &&
      Boolean(report?.artifact_url),
    `environment=${report?.environment ?? "missing"}; fresh=${fresh}; login=${
      report?.login === true
    }; bootstrap=${report?.bootstrap_account === true}; first_funnel=${
      report?.first_funnel === true
    }; secret_boundary=${report?.secrets_not_persisted === true}`,
  );
}

export function evaluateRlsReport(
  report,
  { now = new Date(), limits = READINESS_LIMITS } = {},
) {
  const fresh = isFresh(report?.completed_at, now, limits.evidenceMaxAgeDays);
  const validEnvironment = report?.environment === "staging" ||
    (
      report?.environment === "production" &&
      report?.mode === "management_read_only_impersonation"
    );
  return check(
    "rls_contracts",
    report?.schema_version === 1 &&
      validEnvironment &&
      report?.ok === true &&
      fresh &&
      report?.member_redacted === true &&
      report?.admin_inherited_access === true &&
      report?.direct_credentials_denied === true &&
      report?.sync_token_denied === true &&
      Boolean(report?.artifact_url),
    `environment=${report?.environment ?? "missing"}; mode=${
      report?.mode ?? "interactive"
    }; fresh=${fresh}; member_redacted=${report?.member_redacted === true}; admin_inherited=${
      report?.admin_inherited_access === true
    }; direct_credentials_denied=${report?.direct_credentials_denied === true}`,
  );
}

export function evaluateSqsSnapshot(snapshot, limits = READINESS_LIMITS) {
  return check(
    "durable_gateway_queue",
    snapshot?.configured === true &&
      Number(snapshot?.visible_messages ?? Infinity) <=
        limits.gatewayQueueDepth &&
      Number(snapshot?.oldest_message_seconds ?? Infinity) <=
        limits.gatewayQueueAgeSeconds &&
      Number(snapshot?.dead_letter_messages ?? Infinity) === 0 &&
      Number(snapshot?.consumer_heartbeat_age_seconds ?? Infinity) <= 120 &&
      ["starting", "healthy"].includes(snapshot?.consumer_status),
    `configured=${snapshot?.configured === true}; visible=${
      snapshot?.visible_messages ?? "missing"
    }; oldest=${snapshot?.oldest_message_seconds ?? "missing"}s; dlq=${
      snapshot?.dead_letter_messages ?? "missing"
    }; consumer=${snapshot?.consumer_status ?? "missing"}/${
      snapshot?.consumer_heartbeat_age_seconds ?? "missing"
    }s`,
  );
}

export function missingEvidenceCheck(id, path) {
  return {
    id,
    status: "hold",
    evidence: path
      ? `invalid or unreadable report: ${path}`
      : "evidence report not provided",
  };
}

export function readinessSummary(checks, generatedAt = new Date()) {
  const ready = checks.length > 0 && checks.every((item) => item.status === "pass");
  return {
    event: "backend_market_readiness",
    generated_at: generatedAt.toISOString(),
    decision: ready ? "ready" : "hold",
    passed: checks.filter((item) => item.status === "pass").length,
    total: checks.length,
    holds: checks
      .filter((item) => item.status !== "pass")
      .map((item) => item.id),
    checks,
  };
}

function check(id, passed, evidence) {
  return {
    id,
    status: passed ? "pass" : "hold",
    evidence,
  };
}

function describeProbe(probe) {
  if (!probe) return "missing";
  return `${Math.round(Number(probe.availability ?? 0) * 100)}%/${
    probe.p95_ms ?? "?"
  }ms`;
}

function isFresh(value, now, maximumAgeDays) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp) || timestamp > now.getTime()) return false;
  return now.getTime() - timestamp <= maximumAgeDays * 24 * 60 * 60 * 1_000;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 1_000) / 10}%` : "n/a";
}
