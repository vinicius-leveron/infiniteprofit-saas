import { describe, expect, it } from "vitest";
import {
  buildWatchdogProjectPlan,
  parseWatchdogOptions,
  type WatchdogProjectStatus,
} from "../../supabase/functions/sync-watchdog/core";

const status: WatchdogProjectStatus = {
  projectId: "project-1",
  rawDates: ["2026-07-15", "2026-07-16", "2026-07-16"],
  dailyDates: ["2026-07-14", "2026-07-15"],
  metaAccounts: 1,
  vturbPlayers: 1,
  hasVturbKey: true,
  checkoutEnabled: true,
  latestMetaSyncAt: "2026-07-17T18:50:00Z",
  latestVturbSyncAt: "2026-07-17T15:00:00Z",
  latestGatewayEventAt: null,
};

describe("sync watchdog core", () => {
  it("detects only the missing and orphan aggregate dates", () => {
    const plan = buildWatchdogProjectPlan(
      status,
      parseWatchdogOptions({}),
      Date.parse("2026-07-17T20:00:00Z"),
    );

    expect(plan.aggregateDates).toEqual(["2026-07-15", "2026-07-16"]);
    expect(plan.missingDailyDates).toEqual(["2026-07-16"]);
    expect(plan.orphanDailyDates).toEqual(["2026-07-14"]);
    expect(plan.triggerMetaSync).toBe(false);
    expect(plan.triggerVturbSync).toBe(true);
    expect(plan.gatewayNeedsAttention).toBe(true);
  });

  it("does not trigger external actions in observation-only mode", () => {
    const options = parseWatchdogOptions({
      trigger_sync: false,
      generate_alerts: false,
      max_projects: 9999,
    });
    const plan = buildWatchdogProjectPlan(
      status,
      options,
      Date.parse("2026-07-17T20:00:00Z"),
    );

    expect(options.maxProjects).toBe(500);
    expect(plan.triggerMetaSync).toBe(false);
    expect(plan.triggerVturbSync).toBe(false);
    expect(plan.generateAlerts).toBe(false);
  });
});
