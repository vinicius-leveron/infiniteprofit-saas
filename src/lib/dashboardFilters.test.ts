import { describe, expect, it } from "vitest";
import {
  dashboardFilterStorageKey,
  readStoredDashboardFilters,
  writeStoredDashboardFilters,
} from "./dashboardFilters";

describe("dashboard filter storage", () => {
  it("restores period, custom dates and account filter by project", () => {
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
      accountFilter: "act_123",
    });
  });
});
