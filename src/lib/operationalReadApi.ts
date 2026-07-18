import { supabase } from "@/integrations/supabase/client";

const DEFAULT_OPERATIONAL_READ_TIMEOUT_MS = 8_000;

export interface SourceHealthSignalRow {
  workspace_id: string;
  project_id: string;
  project_name: string;
  source: "meta" | "vturb" | "gateway" | "creative";
  configured: boolean;
  last_success_at: string | null;
  last_event_at: string | null;
  last_error_at: string | null;
  sync_status: string | null;
  warning_count: number;
  critical_count: number;
}

export interface ClientOperationalSummaryRow {
  workspace_id: string;
  workspace_name: string;
  organization_id: string;
  funnel_count: number;
  health_status:
    | "not_configured"
    | "syncing"
    | "healthy"
    | "warning"
    | "error";
  action_funnels: number;
  syncing_funnels: number;
  last_activity_at: string;
}

export interface FunnelEventCoverageRow {
  source: string;
  event_type: string;
  event_count: number;
  last_event_at: string | null;
}

export interface WorkspaceIntegrationSafeRow {
  workspace_id: string;
  vturb_last_event_at: string | null;
  gateway_provider: "hotmart" | "hubla" | "kiwify" | null;
  gateway_webhook_token: string | null;
  gateway_last_event_at: string | null;
  has_vturb_api_key: boolean;
  has_gateway_secret: boolean;
}

export interface WorkspaceMetaAccountSafeRow {
  id: string;
  workspace_id: string;
  account_id: string;
  label: string | null;
  last_synced_at: string | null;
  created_at: string;
  has_access_token: boolean;
}

export interface WorkspaceCheckoutBindingSafeRow {
  project_id: string;
  enabled: boolean;
  webhook_token: string | null;
}

export interface ProjectSyncSettingsSafeRow {
  project_id: string;
  sheet_url: string | null;
  sync_token: string | null;
}

export class OperationalReadError extends Error {
  readonly retryable: boolean;
  readonly code: string | null;

  constructor(
    message: string,
    options: { retryable?: boolean; code?: string | null } = {},
  ) {
    super(message);
    this.name = "OperationalReadError";
    this.retryable = options.retryable ?? false;
    this.code = options.code ?? null;
  }
}

export function listSourceHealthSignals(workspaceId: string | null) {
  return runOperationalRpc<SourceHealthSignalRow>(
    "list_source_health_signals",
    { _workspace_id: workspaceId },
  );
}

export function listClientOperationalSummaries(organizationId: string) {
  return runOperationalRpc<ClientOperationalSummaryRow>(
    "list_client_operational_summaries",
    { _organization_id: organizationId },
  );
}

export function listFunnelEventCoverage(projectId: string) {
  return runOperationalRpc<FunnelEventCoverageRow>(
    "list_funnel_event_coverage",
    { _project_id: projectId },
  );
}

export async function getWorkspaceIntegrationSafe(workspaceId: string) {
  const rows = await runOperationalRpc<WorkspaceIntegrationSafeRow>(
    "get_workspace_integration_safe",
    { _workspace_id: workspaceId },
  );
  return rows[0] ?? null;
}

export function listWorkspaceMetaAccountsSafe(workspaceId: string) {
  return runOperationalRpc<WorkspaceMetaAccountSafeRow>(
    "list_workspace_meta_accounts_safe",
    { _workspace_id: workspaceId },
  );
}

export function listWorkspaceCheckoutBindingsSafe(workspaceId: string) {
  return runOperationalRpc<WorkspaceCheckoutBindingSafeRow>(
    "list_workspace_checkout_bindings_safe",
    { _workspace_id: workspaceId },
  );
}

export async function getFunnelCheckoutBindingSafe(projectId: string) {
  const rows = await runOperationalRpc<WorkspaceCheckoutBindingSafeRow>(
    "get_funnel_checkout_binding_safe",
    { _project_id: projectId },
  );
  return rows[0] ?? null;
}

export async function getProjectSyncSettingsSafe(projectId: string) {
  const rows = await runOperationalRpc<ProjectSyncSettingsSafeRow>(
    "get_project_sync_settings_safe",
    { _project_id: projectId },
  );
  return rows[0] ?? null;
}

async function runOperationalRpc<T>(
  functionName: string,
  args: Record<string, unknown>,
  timeoutMs = DEFAULT_OPERATIONAL_READ_TIMEOUT_MS,
): Promise<T[]> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { data, error } = await supabase
      .rpc(functionName, args)
      .abortSignal(controller.signal);

    if (error) {
      throw new OperationalReadError(
        userFacingOperationalError(error.message),
        {
          retryable: isOperationalReadRetryable(error),
          code: error.code ?? null,
        },
      );
    }

    return (data ?? []) as T[];
  } catch (error) {
    if (error instanceof OperationalReadError) throw error;
    if (
      error instanceof DOMException &&
      error.name === "AbortError"
    ) {
      throw new OperationalReadError(
        "A consulta demorou mais que o esperado. Tente novamente.",
        { retryable: true, code: "CLIENT_TIMEOUT" },
      );
    }

    const message =
      error instanceof Error ? error.message : "Falha na consulta operacional.";
    throw new OperationalReadError(userFacingOperationalError(message), {
      retryable: isOperationalReadRetryable(error),
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function isOperationalReadRetryable(error: unknown) {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const status = Number(record.status ?? record.statusCode);
  const code = String(record.code ?? "");
  const message =
    error instanceof Error
      ? error.message
      : String(record.message ?? error ?? "");

  return (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    code === "57014" ||
    /failed to fetch|fetch failed|timeout|timed out|connection|502|503|504/i.test(
      message,
    )
  );
}

function userFacingOperationalError(message: string) {
  return isOperationalReadRetryable({ message })
    ? "O banco está temporariamente sobrecarregado. Tente novamente em instantes."
    : message || "Falha na consulta operacional.";
}
