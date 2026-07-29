import { describe, expect, it } from "vitest";
import {
  dashboardFilterStorageKey,
  readStoredDashboardFilters,
  writeStoredDashboardFilters,
} from "./dashboardFilters";

describe("dashboard filter storage", () => {
  it("migrates the legacy account filter into the universal media filter", () => {
    window.localStorage.clear();

    writeStoredDashboardFilters("project-1", {
      period: "custom",
      customFrom: "2026-06-01",
      customTo: "2026-06-15",
      accountFilter: "act_123",
    });

    expect(readStoredDashboardFilters("project-1")).toEqual({
      period: "custom",
      customFrom: "2026-06-01",
      customTo: "2026-06-15",
      accountIds: ["act_123"],
      campaignIds: undefined,
      adsetIds: undefined,
      accountFilter: "act_123",
    });
    expect(readStoredDashboardFilters("project-2")).toEqual({});
  });

  it("ignores invalid stored period values", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      dashboardFilterStorageKey("project-1"),
      JSON.stringify({ period: "last-quarter", accountFilter: "act_123" }),
    );

    expect(readStoredDashboardFilters("project-1")).toEqual({
      period: undefined,
      customFrom: undefined,
      customTo: undefined,
      accountIds: ["act_123"],
      campaignIds: undefined,
      adsetIds: undefined,
      accountFilter: "act_123",
    });
  });

  it("restores multi-select dimensions and removes duplicates", () => {
    window.localStorage.clear();

    writeStoredDashboardFilters("project-1", {
      period: "this_month",
      accountIds: ["act_1", "act_1", "act_2"],
      campaignIds: ["campaign-1"],
      adsetIds: ["adset-1", "adset-2"],
    });

    expect(readStoredDashboardFilters("project-1")).toEqual({
      period: "this_month",
      customFrom: undefined,
      customTo: undefined,
      accountIds: ["act_1", "act_2"],
      campaignIds: ["campaign-1"],
      adsetIds: ["adset-1", "adset-2"],
      accountFilter: undefined,
    });
  });

  it("migrates the old 30-day preference to this month", () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      dashboardFilterStorageKey("project-1"),
      JSON.stringify({ period: "30d" }),
    );

    expect(readStoredDashboardFilters("project-1").period).toBe("this_month");
  });
});
