import { supabase } from "@/integrations/supabase/client";
import { syncVturbUntilDone } from "@/lib/vturbSync";

export type ActivationSource = "meta" | "vturb" | "gateway";
export type ActivationSyncSource = Extract<ActivationSource, "meta" | "vturb">;
export type ActivationSyncState = "pending" | "running" | "complete" | "error";
export type ActivationExperienceState =
  | "preparing"
  | "activated"
  | "ready_to_connect"
  | "waiting_for_event"
  | "ready_to_sync"
  | "needs_attention";

export interface FunnelActivationPlan {
  version: 1;
  projectId: string;
  workspaceId: string;
  configuredSources: ActivationSource[];
  skippedSources: ActivationSource[];
  syncSources: ActivationSyncSource[];
  syncState: ActivationSyncState;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errors?: Partial<Record<ActivationSyncSource, string[]>>;
  setupError?: string;
}

export interface FunnelActivationSnapshot {
  configuredSources: ActivationSource[];
  rawEventCount: number;
  metricsDayCount: number;
  lastEventAt: string | null;
  lastMetricDate: string | null;
  successfulSyncSources: ActivationSyncSource[];
  runningSyncSources: ActivationSyncSource[];
  failedSyncSources: ActivationSyncSource[];
}

export interface ActivationExperience {
  state: ActivationExperienceState;
  hasTrustedSignal: boolean;
  hasDataSignal: boolean;
  progress: number;
  headline: string;
  description: string;
}

const STORAGE_PREFIX = "infiniteprofit.funnelActivation";

export function activationStorageKey(projectId: string) {
  return `${STORAGE_PREFIX}.${projectId}`;
}

export function saveFunnelActivationPlan(plan: FunnelActivationPlan) {
  sessionStorage.setItem(activationStorageKey(plan.projectId), JSON.stringify(plan));
}

export function readFunnelActivationPlan(projectId: string): FunnelActivationPlan | null {
  const raw = sessionStorage.getItem(activationStorageKey(projectId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<FunnelActivationPlan>;
    if (
      parsed.version !== 1 ||
      parsed.projectId !== projectId ||
      typeof parsed.workspaceId !== "string"
    ) {
      throw new Error("Plano de ativação inválido");
    }

    return {
      version: 1,
      projectId,
      workspaceId: parsed.workspaceId,
      configuredSources: readSources(parsed.configuredSources),
      skippedSources: readSources(parsed.skippedSources),
      syncSources: readSources(parsed.syncSources).filter(isSyncSource),
      syncState: readSyncState(parsed.syncState),
      createdAt:
        typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : undefined,
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : undefined,
      errors: readErrors(parsed.errors),
      setupError: typeof parsed.setupError === "string" ? parsed.setupError : undefined,
    };
  } catch {
    sessionStorage.removeItem(activationStorageKey(projectId));
    return null;
  }
}

export function deriveActivationExperience(
  snapshot: FunnelActivationSnapshot,
  plan: FunnelActivationPlan | null,
): ActivationExperience {
  const planCompletedWithoutErrors =
    plan?.syncState === "complete" &&
    plan.syncSources.length > 0 &&
    !hasPlanErrors(plan);
  const hasDataSignal =
    snapshot.rawEventCount > 0 || snapshot.metricsDayCount > 0;
  const hasTrustedSignal =
    hasDataSignal ||
    snapshot.successfulSyncSources.length > 0 ||
    planCompletedWithoutErrors;
  const isPreparing =
    snapshot.runningSyncSources.length > 0 ||
    plan?.syncState === "pending" ||
    plan?.syncState === "running";
  const hasFailure =
    snapshot.failedSyncSources.length > 0 ||
    plan?.syncState === "error" ||
    Boolean(plan?.setupError);
  const hasSyncableSource = snapshot.configuredSources.some(isSyncSource);

  if (hasTrustedSignal) {
    return {
      state: "activated",
      hasTrustedSignal: true,
      hasDataSignal,
      progress: 100,
      headline: hasDataSignal
        ? "Seu primeiro resultado chegou"
        : "Sua primeira conexão foi confirmada",
      description: hasDataSignal
        ? "O funil já recebeu dados próprios. Agora você pode abrir o dashboard com contexto real."
        : "A fonte respondeu corretamente. O dashboard será preenchido assim que os primeiros dados estiverem disponíveis.",
    };
  }

  if (snapshot.configuredSources.length === 0) {
    return {
      state: "ready_to_connect",
      hasTrustedSignal: false,
      hasDataSignal: false,
      progress: 38,
      headline: "Seu funil está pronto para começar",
      description:
        "Nada deu errado. Conecte a primeira fonte quando quiser para receber o primeiro resultado.",
    };
  }

  if (isPreparing) {
    return {
      state: "preparing",
      hasTrustedSignal: false,
      hasDataSignal: false,
      progress: 72,
      headline: "Buscando seus primeiros dados",
      description:
        "As conexões já estão salvas. Estamos validando as fontes e procurando o primeiro sinal deste funil.",
    };
  }

  if (hasFailure) {
    return {
      state: "needs_attention",
      hasTrustedSignal: false,
      hasDataSignal: false,
      progress: 58,
      headline: "O funil foi criado. Falta concluir uma conexão",
      description:
        "Seus dados e configurações estão preservados. Revise somente a fonte que precisa de atenção.",
    };
  }

  if (hasSyncableSource) {
    return {
      state: "ready_to_sync",
      hasTrustedSignal: false,
      hasDataSignal: false,
      progress: 58,
      headline: "Suas fontes estão conectadas",
      description:
        "Inicie a primeira sincronização para confirmar o primeiro sinal real deste funil.",
    };
  }

  return {
    state: "waiting_for_event",
    hasTrustedSignal: false,
    hasDataSignal: false,
    progress: 64,
    headline: "Seu rastreamento está pronto",
    description:
      "O gateway já pode receber vendas. Esta tela reconhecerá automaticamente o primeiro evento.",
  };
}

export async function runFunnelActivationSync(
  projectId: string,
  source: ActivationSyncSource,
) {
  if (source === "vturb") {
    const result = await syncVturbUntilDone({ projectId, days: 30 });
    return { source, errors: result.errors };
  }

  const { data, error } = await supabase.functions.invoke("meta-pull", {
    body: { project_id: projectId, days: 30 },
  });

  return {
    source,
    errors: [
      ...(error?.message ? [error.message] : []),
      ...extractActivationSyncErrors(data),
    ],
  };
}

export function extractActivationSyncErrors(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];

  const errors: string[] = [];
  const record = payload as { error?: unknown; results?: unknown[] };

  if (typeof record.error === "string" && record.error.trim()) {
    errors.push(record.error.trim());
  }

  if (Array.isArray(record.results)) {
    for (const result of record.results) {
      if (!result || typeof result !== "object") continue;
      const message = (result as { error?: unknown }).error;
      if (typeof message === "string" && message.trim()) errors.push(message.trim());
    }
  }

  return [...new Set(errors)];
}

export function hasPlanErrors(plan: FunnelActivationPlan | null) {
  return Boolean(
    plan?.setupError ||
      Object.values(plan?.errors ?? {}).some((messages) => (messages?.length ?? 0) > 0),
  );
}

function readSources(value: unknown): ActivationSource[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isActivationSource))];
}

function readErrors(value: unknown): FunnelActivationPlan["errors"] {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const errors: FunnelActivationPlan["errors"] = {};

  for (const source of ["meta", "vturb"] as const) {
    if (!Array.isArray(record[source])) continue;
    errors[source] = [
      ...new Set(
        record[source].filter(
          (message): message is string =>
            typeof message === "string" && Boolean(message.trim()),
        ),
      ),
    ];
  }

  return Object.keys(errors).length > 0 ? errors : undefined;
}

function readSyncState(value: unknown): ActivationSyncState {
  return value === "running" || value === "complete" || value === "error"
    ? value
    : "pending";
}

function isActivationSource(value: unknown): value is ActivationSource {
  return value === "meta" || value === "vturb" || value === "gateway";
}

function isSyncSource(source: ActivationSource): source is ActivationSyncSource {
  return source === "meta" || source === "vturb";
}
