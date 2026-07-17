import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activationStorageKey,
  deriveActivationExperience,
  readFunnelActivationPlan,
  type FunnelActivationPlan,
  type FunnelActivationSnapshot,
} from "./funnelActivation";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

const emptySnapshot: FunnelActivationSnapshot = {
  configuredSources: [],
  rawEventCount: 0,
  metricsDayCount: 0,
  lastEventAt: null,
  lastMetricDate: null,
  successfulSyncSources: [],
  runningSyncSources: [],
  failedSyncSources: [],
};

const pendingPlan: FunnelActivationPlan = {
  version: 1,
  projectId: "project-1",
  workspaceId: "workspace-1",
  configuredSources: ["meta"],
  skippedSources: ["vturb", "gateway"],
  syncSources: ["meta"],
  syncState: "pending",
  createdAt: "2026-07-17T12:00:00.000Z",
};

describe("funnel activation experience", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("treats postponed sources as a neutral next step instead of an error", () => {
    const experience = deriveActivationExperience(emptySnapshot, {
      ...pendingPlan,
      configuredSources: [],
      syncSources: [],
      syncState: "complete",
    });

    expect(experience.state).toBe("ready_to_connect");
    expect(experience.headline).toBe("Seu funil está pronto para começar");
    expect(experience.hasTrustedSignal).toBe(false);
    expect(experience.hasDataSignal).toBe(false);
  });

  it("shows real preparation while the first connected source is syncing", () => {
    const experience = deriveActivationExperience(
      {
        ...emptySnapshot,
        configuredSources: ["meta"],
        runningSyncSources: ["meta"],
      },
      { ...pendingPlan, syncState: "running" },
    );

    expect(experience.state).toBe("preparing");
    expect(experience.progress).toBe(72);
  });

  it("activates from a signal that belongs to the funnel", () => {
    const experience = deriveActivationExperience(
      {
        ...emptySnapshot,
        configuredSources: ["meta"],
        rawEventCount: 12,
        lastEventAt: "2026-07-17T12:05:00.000Z",
      },
      { ...pendingPlan, syncState: "complete" },
    );

    expect(experience.state).toBe("activated");
    expect(experience.progress).toBe(100);
    expect(experience.hasTrustedSignal).toBe(true);
    expect(experience.hasDataSignal).toBe(true);
  });

  it("recognizes a successful first sync even before aggregated rows appear", () => {
    const experience = deriveActivationExperience(
      {
        ...emptySnapshot,
        configuredSources: ["vturb"],
        successfulSyncSources: ["vturb"],
      },
      null,
    );

    expect(experience.state).toBe("activated");
    expect(experience.hasDataSignal).toBe(false);
    expect(experience.headline).toBe("Sua primeira conexão foi confirmada");
  });

  it("shows a gateway-only funnel as ready to receive its first event", () => {
    const experience = deriveActivationExperience(
      { ...emptySnapshot, configuredSources: ["gateway"] },
      null,
    );

    expect(experience.state).toBe("waiting_for_event");
    expect(experience.headline).toBe("Seu rastreamento está pronto");
  });

  it("keeps setup errors actionable without losing the created funnel", () => {
    const experience = deriveActivationExperience(
      { ...emptySnapshot, configuredSources: ["meta"] },
      {
        ...pendingPlan,
        syncState: "error",
        errors: { meta: ["Token expirado"] },
      },
    );

    expect(experience.state).toBe("needs_attention");
  });

  it("whitelists the persisted plan and drops legacy or injected secrets", () => {
    sessionStorage.setItem(
      activationStorageKey("project-1"),
      JSON.stringify({
        ...pendingPlan,
        metaToken: "meta-secret",
        vturbApiKey: "vturb-secret",
        gatewaySecret: "gateway-secret",
      }),
    );

    const plan = readFunnelActivationPlan("project-1");
    expect(plan).toEqual(pendingPlan);
    expect(JSON.stringify(plan)).not.toContain("secret");
  });
});
