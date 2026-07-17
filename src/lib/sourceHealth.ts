export type SourceHealthStatus =
  | "not_configured"
  | "syncing"
  | "healthy"
  | "warning"
  | "error";

export type SourceHealthKey = "meta" | "vturb" | "gateway" | "creative";

export interface SourceHealthSignal {
  workspaceId: string;
  projectId: string;
  source: SourceHealthKey;
  configured: boolean;
  lastSuccessAt: string | null;
  lastEventAt: string | null;
  lastErrorAt: string | null;
  syncing: boolean;
  warningCount: number;
  criticalCount: number;
}

export interface SourceHealthResult extends SourceHealthSignal {
  status: SourceHealthStatus;
  lastActivityAt: string | null;
}

const STATUS_WEIGHT: Record<SourceHealthStatus, number> = {
  not_configured: 0,
  healthy: 1,
  syncing: 2,
  warning: 3,
  error: 4,
};

function latestTimestamp(...values: Array<string | null>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
}

export function deriveSourceHealth(
  signal: SourceHealthSignal,
  now = Date.now(),
  staleAfterHours = 48,
): SourceHealthResult {
  const lastActivityAt = latestTimestamp(signal.lastSuccessAt, signal.lastEventAt);
  let status: SourceHealthStatus;

  if (!signal.configured) {
    status = "not_configured";
  } else if (signal.syncing) {
    status = "syncing";
  } else if (
    signal.criticalCount > 0 ||
    (signal.lastErrorAt &&
      (!signal.lastSuccessAt ||
        new Date(signal.lastErrorAt).getTime() > new Date(signal.lastSuccessAt).getTime()))
  ) {
    status = "error";
  } else if (
    signal.warningCount > 0 ||
    !lastActivityAt ||
    now - new Date(lastActivityAt).getTime() > staleAfterHours * 60 * 60 * 1000
  ) {
    status = "warning";
  } else {
    status = "healthy";
  }

  return { ...signal, status, lastActivityAt };
}

export function deriveOverallHealth(
  sources: SourceHealthResult[],
): SourceHealthStatus {
  const configuredSources = sources.filter((source) => source.configured);
  if (configuredSources.length === 0) return "not_configured";

  return configuredSources.reduce<SourceHealthStatus>(
    (worst, source) =>
      STATUS_WEIGHT[source.status] > STATUS_WEIGHT[worst] ? source.status : worst,
    "healthy",
  );
}

export function statusRequiresAction(status: SourceHealthStatus) {
  return status === "warning" || status === "error";
}

export const SOURCE_HEALTH_LABELS: Record<SourceHealthStatus, string> = {
  not_configured: "Sem conexão",
  syncing: "Sincronizando",
  healthy: "Saudável",
  warning: "Atenção",
  error: "Erro",
};
