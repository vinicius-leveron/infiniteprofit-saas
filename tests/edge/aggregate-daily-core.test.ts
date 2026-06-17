import { describe, expect, it } from "vitest";
import { aggregateOneDay } from "../../supabase/functions/aggregate-daily/core";

describe("aggregate daily core", () => {
  it("uses Meta link clicks and landing page views for traffic rates", () => {
    const metrics = aggregateOneDay([
      {
        source: "meta",
        event_type: "insight",
        payload: {
          spend: 120,
          impressions: 1000,
          clicks: 300,
          outbound_clicks: [{ action_type: "outbound_click", value: 180 }],
          actions: [
            { action_type: "link_click", value: 200 },
            { action_type: "landing_page_view", value: 160 },
            { action_type: "omni_landing_page_view", value: 165 },
          ],
        },
      },
      {
        source: "vturb",
        event_type: "sessions_stats_by_day",
        payload: {
          total_viewed_session_uniq: 40,
          total_started_session_uniq: 20,
        },
      },
      { source: "gateway", event_type: "checkout_created", payload: {} },
      { source: "gateway", event_type: "checkout_created", payload: {} },
    ]);

    expect(metrics.cliques).toBe(200);
    expect(metrics.landing_pageviews).toBe(160);
    expect(metrics.pageviews).toBe(40);
    expect(metrics.ctr).toBeCloseTo(20);
    expect(metrics.cpc).toBeCloseTo(0.6);
    expect(metrics.taxa_carreg).toBeCloseTo(80);
    expect(metrics.custo_pageview).toBeCloseTo(0.75);
    expect(metrics.custo_ic).toBeCloseTo(60);
  });

  it("falls back to outbound clicks and then total clicks when link clicks are absent", () => {
    const outbound = aggregateOneDay([
      {
        source: "meta",
        event_type: "insight",
        payload: {
          spend: 50,
          impressions: 500,
          clicks: 90,
          outbound_clicks: [{ action_type: "outbound_click", value: 70 }],
          actions: [{ action_type: "landing_page_view", value: 35 }],
        },
      },
    ]);
    const totalClicks = aggregateOneDay([
      {
        source: "meta",
        event_type: "insight",
        payload: {
          spend: 50,
          impressions: 500,
          clicks: 90,
          actions: [{ action_type: "landing_page_view", value: 45 }],
        },
      },
    ]);

    expect(outbound.cliques).toBe(70);
    expect(outbound.taxa_carreg).toBeCloseTo(50);
    expect(totalClicks.cliques).toBe(90);
    expect(totalClicks.taxa_carreg).toBeCloseTo(50);
  });

  it("deduplicates Hubla offer rows into a single checkout purchase", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-1",
        payload: {
          transaction_id: "tx-1",
          total: 1506.82,
          net: 1506.82,
          is_front: true,
          payment_method: "card",
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-1-offer-1",
        payload: {
          transaction_id: "tx-1",
          total: 756.7,
          net: 756.7,
          is_front: false,
          is_offer_event: true,
          items: [
            {
              external_id: "tx-1-offer-1",
              name: "Bump 1",
              price: 756.7,
              type: "orderbump",
              is_bump: true,
            },
          ],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-1-offer-2",
        payload: {
          transaction_id: "tx-1",
          total: 220.1,
          net: 220.1,
          is_front: false,
          is_offer_event: true,
          items: [
            {
              external_id: "tx-1-offer-2",
              name: "Bump 2",
              price: 220.1,
              type: "orderbump",
              is_bump: true,
            },
          ],
        },
      },
    ]);

    expect(metrics.vendas_totais).toBe(1);
    expect(metrics.vendas_front).toBe(1);
    expect(metrics.fat_bruto).toBeCloseTo(2483.62);
    expect(metrics.fat_liquido).toBeCloseTo(2483.62);
    expect(metrics.fat_front).toBeCloseTo(1506.82);
    expect(metrics.fat_orderbump).toBeCloseTo(976.8);
    expect(metrics.aprov_cartao).toBe(100);
    expect(metrics.bumps).toEqual([
      expect.objectContaining({ name: "Bump 1", count: 1, revenue: 756.7, rate: 100 }),
      expect.objectContaining({ name: "Bump 2", count: 1, revenue: 220.1, rate: 100 }),
    ]);
  });

  it("uses the offer-suffix base id to deduplicate legacy rows", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-2",
        payload: { total: 197, net: 197, is_front: true },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-2-offer-1",
        payload: { total: 44.42, net: 44.42, is_offer_event: true },
      },
    ]);

    expect(metrics.vendas_totais).toBe(1);
    expect(metrics.fat_bruto).toBeCloseTo(241.42);
    expect(metrics.fat_front).toBe(197);
  });
});
