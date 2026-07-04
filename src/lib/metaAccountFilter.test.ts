import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyRow } from "./csv";

let rawEvents: Array<{ event_date: string; payload: Record<string, unknown> }> = [];

vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    then: (resolve: (value: { data: typeof rawEvents }) => unknown) => Promise.resolve({ data: rawEvents }).then(resolve),
  };

  return {
    supabase: {
      from: vi.fn(() => query),
    },
  };
});

import { applyMetaAccountFilter } from "./metaAccountFilter";

const baseRow = {
  data: "15/06/2026",
  date: new Date(2026, 5, 15),
  checkouts: 4,
  vendasFront: 2,
  vendasTotais: 2,
  fatLiquido: 500,
  pageviews: 20,
  landingPageviews: 999,
} as DailyRow;

describe("applyMetaAccountFilter", () => {
  beforeEach(() => {
    rawEvents = [];
  });

  it("recalculates traffic metrics with link_click and landing_page_view", async () => {
    rawEvents = [
      {
        event_date: "2026-06-15",
        payload: {
          spend: 200,
          impressions: 1000,
          clicks: 300,
          outbound_clicks: [{ action_type: "outbound_click", value: 250 }],
          actions: [
            { action_type: "link_click", value: 100 },
            { action_type: "landing_page_view", value: 80 },
            { action_type: "omni_landing_page_view", value: 90 },
          ],
        },
      },
    ];

    const [row] = await applyMetaAccountFilter([baseRow], "project-1", "act_1");

    expect(row.cliques).toBe(100);
    expect(row.landingPageviews).toBe(80);
    expect(row.ctr).toBe(10);
    expect(row.cpc).toBe(2);
    expect(row.taxaCarreg).toBe(80);
    expect(row.custoPageview).toBe(2.5);
    expect(row.custoIC).toBe(50);
    expect(row.impostoMeta).toBeCloseTo(25);
    expect(row.lucro).toBeCloseTo(275);
    expect(row.roi).toBeCloseTo(2.375);
    expect(row.pageviews).toBe(20);
  });

  it("falls back to outbound clicks and omni landing page views", async () => {
    rawEvents = [
      {
        event_date: "2026-06-15",
        payload: {
          spend: 100,
          impressions: 500,
          clicks: 70,
          outbound_clicks: [{ action_type: "outbound_click", value: 40 }],
          actions: [{ action_type: "omni_landing_page_view", value: 20 }],
        },
      },
    ];

    const [row] = await applyMetaAccountFilter([baseRow], "project-1", "act_1");

    expect(row.cliques).toBe(40);
    expect(row.landingPageviews).toBe(20);
    expect(row.taxaCarreg).toBe(50);
    expect(row.custoPageview).toBe(5);
  });
});
