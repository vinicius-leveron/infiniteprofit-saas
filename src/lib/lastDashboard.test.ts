import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {},
}));

import {
  buildDashboardDestination,
  readLastDashboardPreference,
  selectClientLandingDestination,
  writeLastDashboardPreference,
} from "./lastDashboard";

describe("last Dashboard preference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("restores an accessible funnel and its last Dashboard tab", () => {
    writeLastDashboardPreference({
      userId: "user-1",
      clientId: "client-1",
      funnelId: "funnel-2",
      dashboardTab: "anuncios",
    });

    const destination = selectClientLandingDestination({
      userId: "user-1",
      clientId: "client-1",
      funnels: [
        { id: "funnel-1", name: "Primeiro", updated_at: "2026-07-17" },
        { id: "funnel-2", name: "Segundo", updated_at: "2026-07-16" },
      ],
    });

    expect(destination).toBe(
      buildDashboardDestination("funnel-2", "anuncios"),
    );
  });

  it("clears an inaccessible preference and falls back to the most recent funnel", () => {
    writeLastDashboardPreference({
      userId: "user-1",
      clientId: "client-1",
      funnelId: "removed-funnel",
      dashboardTab: "geral",
    });

    const destination = selectClientLandingDestination({
      userId: "user-1",
      clientId: "client-1",
      funnels: [
        { id: "funnel-1", name: "Mais recente", updated_at: "2026-07-17" },
      ],
    });

    expect(destination).toBe(buildDashboardDestination("funnel-1"));
    expect(readLastDashboardPreference("user-1", "client-1")).toBeNull();
  });

  it("opens the client funnel list when no funnel is available", () => {
    expect(
      selectClientLandingDestination({
        userId: "user-1",
        clientId: "client-1",
        funnels: [],
      }),
    ).toBe("/clients/client-1/funnels");
  });
});
