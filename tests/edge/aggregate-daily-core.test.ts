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
            { action_type: "initiate_checkout", value: 50 },
            { action_type: "omni_initiated_checkout", value: 55 },
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
    expect(metrics.checkouts).toBe(50);
    expect(metrics.custo_ic).toBeCloseTo(2.4);
  });

  it("falls back to Hubla checkout_created when Meta initiate checkout is absent", () => {
    const metrics = aggregateOneDay([
      {
        source: "meta",
        event_type: "insight",
        payload: {
          spend: 120,
          impressions: 1000,
          actions: [
            { action_type: "link_click", value: 200 },
            { action_type: "landing_page_view", value: 160 },
          ],
        },
      },
      {
        source: "gateway",
        event_type: "checkout_created",
        external_id: "checkout-1",
        payload: { transaction_id: "checkout-1", status: "waiting_payment" },
      },
      {
        source: "gateway",
        event_type: "checkout_created",
        external_id: "checkout-2",
        payload: { transaction_id: "checkout-2", status: "waiting_payment" },
      },
    ]);

    expect(metrics.checkouts).toBe(2);
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

  it("deduplicates Hubla offer rows for revenue while counting funnel items as total sales", () => {
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

    expect(metrics.vendas_totais).toBe(3);
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

  it("counts explicit zero-price Hubla bumps as sales without inventing revenue", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-free-bumps",
        payload: {
          transaction_id: "tx-free-bumps",
          total: 197,
          net: 180,
          is_front: true,
          items: [
            { external_id: "front", name: "Front", price: 197, type: "main", is_bump: false },
            { external_id: "ob-1", name: "Bump 1", price: 0, type: "orderbump", is_bump: true, count_as_sale: true },
            { external_id: "ob-2", name: "Bump 2", price: 0, type: "orderbump", is_bump: true, count_as_sale: true },
          ],
        },
      },
    ]);

    expect(metrics.vendas_front).toBe(1);
    expect(metrics.vendas_totais).toBe(3);
    expect(metrics.fat_orderbump).toBeNull();
    expect(metrics.bumps).toEqual([
      expect.objectContaining({ name: "Bump 1", count: 1, revenue: 0 }),
      expect.objectContaining({ name: "Bump 2", count: 1, revenue: 0 }),
    ]);
  });

  it("uses the offer-suffix base id to deduplicate legacy rows without losing bump sales", () => {
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

    expect(metrics.vendas_totais).toBe(2);
    expect(metrics.fat_bruto).toBeCloseTo(241.42);
    expect(metrics.fat_front).toBe(197);
  });

  it("keeps upsells out of the general order-bump conversion", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-mixed-offers",
        payload: {
          transaction_id: "tx-mixed-offers",
          total: 150,
          net: 150,
          is_front: true,
          items: [
            { external_id: "front", name: "Front", price: 100, type: "main", is_bump: false },
            { external_id: "ob", name: "Order Bump", price: 20, type: "orderbump", is_bump: true },
            { external_id: "up", name: "Upsell", price: 30, type: "upsell", is_bump: true },
          ],
        },
      },
    ]);

    expect(metrics.vendas_front).toBe(1);
    expect(metrics.conv_geral_orderbump).toBe(100);
    expect(metrics.fat_orderbump).toBeCloseTo(20);
    expect(metrics.bumps).toEqual([
      expect.objectContaining({ name: "Order Bump", type: "orderbump", count: 1 }),
      expect.objectContaining({ name: "Upsell", type: "upsell", count: 1 }),
    ]);
  });

  it("uses Hubla seller receiver total from raw payload as net revenue", () => {
    const metrics = aggregateOneDay([
      {
        source: "meta",
        event_type: "insight",
        payload: {
          spend: 100,
          impressions: 1000,
          actions: [{ action_type: "link_click", value: 100 }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-liquid",
        payload: {
          total: 297,
          net: 297,
          is_front: true,
          raw_payload: {
            event: {
              invoice: {
                receivers: [
                  { role: "platform", totalCents: 1730 },
                  { role: "seller", totalCents: 27970 },
                ],
              },
            },
          },
        },
      },
    ]);

    expect(metrics.fat_bruto).toBeCloseTo(297);
    expect(metrics.fat_liquido).toBeCloseTo(279.7);
    expect(metrics.imposto_meta).toBeCloseTo(12.15);
    expect(metrics.lucro).toBeCloseTo(167.55);
    expect(metrics.roi).toBeCloseTo(2.6755);
  });

  it("rebuilds historical Hubla net before coproduction from receiver roles", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-coproduction",
        payload: {
          total: 100,
          net: 40.5,
          is_front: true,
          raw_payload: {
            event: {
              invoice: {
                receivers: [
                  { role: "seller", totalCents: 4050 },
                  { role: "partner", totalCents: 4950 },
                  { role: "platform", totalCents: 1000 },
                ],
              },
            },
          },
        },
      },
    ]);

    expect(metrics.fat_bruto).toBeCloseTo(100);
    expect(metrics.fat_liquido).toBeCloseTo(90);
  });

  it("rebuilds consolidated net from gross minus Hubla platform receiver", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-coproduction-owner-only",
        payload: {
          total: 100,
          net: 40.5,
          is_front: true,
          raw_payload: {
            event: {
              invoice: {
                receivers: [
                  { role: "platform", totalCents: 1000 },
                  { role: "seller", totalCents: 4050 },
                ],
              },
            },
          },
        },
      },
    ]);

    expect(metrics.fat_bruto).toBeCloseTo(100);
    expect(metrics.fat_liquido).toBeCloseTo(90);
  });

  it("deduplicates refunds and divides the rate by approved front sales", () => {
    const approved = Array.from({ length: 4 }, (_, index) => ({
      source: "gateway",
      event_type: "purchase.approved",
      external_id: `approved-${index}`,
      payload: { transaction_id: `approved-${index}`, total: 100, net: 90, is_front: true },
    }));
    const metrics = aggregateOneDay([
      ...approved,
      {
        source: "gateway",
        event_type: "purchase.refunded",
        external_id: "refund-1",
        payload: { transaction_id: "refund-1", total: 100, net: 90 },
      },
      {
        source: "gateway",
        event_type: "purchase.refunded",
        external_id: "refund-1-offer-1",
        payload: { transaction_id: "refund-1", total: 100, net: 90 },
      },
    ]);

    expect(metrics.reembolsos).toBe(1);
    expect(metrics.valor_reembolsado).toBeCloseTo(100);
    expect(metrics.taxa_reembolso).toBeCloseTo(25);
  });

  it("deduplicates payment approval attempts by method using checkout_created and approved events", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "checkout_created",
        external_id: "pix-open",
        payload: {
          transaction_id: "pix-open",
          status: "waiting_payment",
          payment_method: "pix",
          product_id: "front",
          items: [{ external_id: "front", name: "Produto Front", type: "main", is_bump: false }],
        },
      },
      {
        source: "gateway",
        event_type: "checkout_created",
        external_id: "pix-paid",
        payload: {
          transaction_id: "pix-paid",
          status: "waiting_payment",
          payment_method: "pix",
          product_id: "front",
          items: [{ external_id: "front", name: "Produto Front", type: "main", is_bump: false }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "pix-paid",
        payload: {
          transaction_id: "pix-paid",
          total: 197,
          net: 180,
          is_front: true,
          payment_method: "pix",
          product_id: "front",
          items: [{ external_id: "front", name: "Produto Front", price: 197, type: "main", is_bump: false }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.refused",
        external_id: "card-refused",
        payload: {
          transaction_id: "card-refused",
          payment_method: "credit_card",
          product_id: "front",
          items: [{ external_id: "front", name: "Produto Front", type: "main", is_bump: false }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "card-paid",
        payload: {
          transaction_id: "card-paid",
          total: 197,
          net: 180,
          is_front: true,
          payment_method: "credit_card",
          product_id: "front",
          items: [{ external_id: "front", name: "Produto Front", price: 197, type: "main", is_bump: false }],
        },
      },
    ]);

    expect(metrics.aprov_pix).toBeCloseTo(50);
    expect(metrics.aprov_cartao).toBeCloseTo(50);
  });

  it("subtracts refunded net value from liquid revenue and profit", () => {
    const metrics = aggregateOneDay([
      {
        source: "meta",
        event_type: "insight",
        payload: {
          spend: 100,
          impressions: 1000,
          actions: [{ action_type: "link_click", value: 100 }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-refund",
        payload: { transaction_id: "tx-refund", total: 297, net: 270, is_front: true },
      },
      {
        source: "gateway",
        event_type: "purchase.refunded",
        external_id: "tx-refund",
        payload: { transaction_id: "tx-refund", total: 297, net: 270 },
      },
    ]);

    expect(metrics.fat_bruto).toBeCloseTo(297);
    expect(metrics.fat_liquido).toBe(0);
    expect(metrics.valor_reembolsado).toBeCloseTo(297);
    expect(metrics.lucro).toBeCloseTo(-112.15);
  });

  it("counts linked Hubla child invoices without double counting their revenue", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "checkout_created",
        external_id: "tx-child",
        payload: {
          transaction_id: "tx-child",
          items: [{ external_id: "front", name: "Produto Front", price: 0, type: "main", is_bump: false }],
        },
      },
      {
        source: "gateway",
        event_type: "checkout_created",
        external_id: "tx-child-offer-1",
        payload: { transaction_id: "tx-child" },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-child",
        payload: {
          transaction_id: "tx-child",
          total: 241.42,
          net: 220,
          is_front: true,
          product_id: "front",
          raw_payload: { event: { invoice: { childInvoiceIds: ["tx-child-offer-1", "tx-child-offer-2"] } } },
          items: [{ external_id: "front", name: "Produto Front", price: 241.42, type: "main", is_bump: false }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-child-offer-1",
        payload: {
          transaction_id: "tx-child",
          total: 197,
          net: 180,
          is_offer_event: true,
          product_id: "front",
          items: [{ external_id: "front", name: "Produto Front", price: 197, type: "orderbump", is_bump: true }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-child-offer-2",
        payload: {
          transaction_id: "tx-child",
          total: 44.42,
          net: 40,
          is_offer_event: true,
          product_id: "bump",
          items: [{ external_id: "bump", name: "Order bump", price: 44.42, type: "orderbump", is_bump: true }],
        },
      },
    ]);

    expect(metrics.checkouts).toBe(1);
    expect(metrics.vendas_front).toBe(1);
    expect(metrics.vendas_totais).toBe(3);
    expect(metrics.fat_bruto).toBeCloseTo(241.42);
    expect(metrics.fat_front).toBeNull();
    expect(metrics.fat_orderbump).toBeCloseTo(241.42);
    expect(metrics.fat_funil).toBeCloseTo(241.42);
    expect(metrics.bumps).toEqual([
      expect.objectContaining({ name: "Produto Front", count: 1, revenue: 197, rate: 100 }),
      expect.objectContaining({ name: "Order bump", count: 1, revenue: 44.42, rate: 100 }),
    ]);
  });

  it("counts every explicit Hubla child offer, including one reusing the front product", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-bundle",
        payload: {
          transaction_id: "tx-bundle",
          total: 588,
          net: 554.73,
          is_front: false,
          product_id: "tummy",
          raw_payload: { event: { invoice: { childInvoiceIds: ["tx-bundle-offer-1"] } } },
          items: [{ external_id: "tummy", name: "Protocolo Tummy Time", price: 588, type: "main", is_bump: false }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-bundle-offer-1",
        payload: {
          transaction_id: "tx-bundle",
          total: 97,
          net: 91,
          is_offer_event: true,
          product_id: "tummy",
          items: [{ external_id: "tummy", name: "Protocolo Tummy Time", price: 97, type: "orderbump", is_bump: true }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-front",
        payload: {
          transaction_id: "tx-front",
          total: 197,
          net: 180,
          is_front: true,
          product_id: "tummy",
          items: [{ external_id: "tummy", name: "Protocolo Tummy Time", price: 197, type: "main", is_bump: false }],
        },
      },
    ]);

    expect(metrics.vendas_front).toBe(2);
    expect(metrics.vendas_totais).toBe(3);
    expect(metrics.fat_bruto).toBeCloseTo(785);
    expect(metrics.fat_orderbump).toBeCloseTo(97);
    expect(metrics.bumps).toEqual([
      expect.objectContaining({ name: "Protocolo Tummy Time", count: 1, revenue: 97 }),
    ]);
  });

  it("does not classify an access bump as front only because its name starts with the front name", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-front",
        payload: {
          transaction_id: "tx-front",
          total: 197,
          net: 180,
          is_front: true,
          product_id: "front",
          items: [
            {
              external_id: "front",
              name: "Protocolo Bebê Livre de Cólicas e Disquesia",
              price: 197,
              type: "main",
              is_bump: false,
            },
          ],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "tx-access",
        payload: {
          transaction_id: "tx-access",
          total: 97,
          net: 91,
          is_front: false,
          product_id: "access",
          items: [
            {
              external_id: "access",
              name: "Protocolo Bebê Livre de Cólicas e Disquesia - Acesso Vitalício",
              price: 97,
              type: "orderbump",
              is_bump: false,
            },
          ],
        },
      },
    ]);

    expect(metrics.vendas_front).toBe(1);
    expect(metrics.vendas_totais).toBe(2);
    expect(metrics.bumps).toEqual([
      expect.objectContaining({
        name: "Protocolo Bebê Livre de Cólicas e Disquesia - Acesso Vitalício",
        count: 1,
        revenue: 97,
      }),
    ]);
  });

  it("ignores legacy approved gateway rows with zero purchase value", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "legacy-zero",
        payload: { total: 0, net: 0, is_front: true },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "real-sale",
        payload: { total: 197, net: 179.75, is_front: true },
      },
    ]);

    expect(metrics.vendas_totais).toBe(1);
    expect(metrics.vendas_front).toBe(1);
    expect(metrics.fat_bruto).toBeCloseTo(197);
    expect(metrics.fat_liquido).toBeCloseTo(179.75);
  });

  it("uses imported daily sheet values without overwriting raw Meta traffic", () => {
    const metrics = aggregateOneDay([
      {
        source: "meta",
        event_type: "insight",
        payload: { spend: 100, impressions: 1000, actions: [{ action_type: "link_click", value: 100 }] },
      },
      {
        source: "sheet_override",
        event_type: "daily_metrics",
        payload: {
          investimento: 90,
          impressoes: 900,
          cliques: 90,
          vendas_front: 3,
          vendas_totais: 4,
          fat_bruto: 1200.5,
          fat_liquido: 1000.25,
          checkouts: 7,
          lucro: 800,
          roi: "8,50",
          bumps: [{ name: "Bump", type: "orderbump", count: 1, revenue: 97, rate: 33.33 }],
        },
      },
    ]);

    expect(metrics.investimento).toBe(100);
    expect(metrics.impressoes).toBe(1000);
    expect(metrics.cliques).toBe(100);
    expect(metrics.cpm).toBeCloseTo(100);
    expect(metrics.ctr).toBeCloseTo(10);
    expect(metrics.cpc).toBeCloseTo(1);
    expect(metrics.vendas_front).toBe(3);
    expect(metrics.vendas_totais).toBe(4);
    expect(metrics.fat_bruto).toBe(1200.5);
    expect(metrics.fat_liquido).toBe(1000.25);
    expect(metrics.checkouts).toBe(7);
    expect(metrics.imposto_meta).toBeCloseTo(12.15);
    expect(metrics.lucro).toBeCloseTo(888.1);
    expect(metrics.roi).toBeCloseTo(9.881);
    expect(metrics.bumps).toEqual([
      expect.objectContaining({ name: "Bump", count: 1, revenue: 97 }),
    ]);
  });

  it("keeps raw Hubla sales when imported daily sheet has stale sales values", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        payload: { total: 100, net: 90, is_front: true },
      },
      {
        source: "sheet_override",
        event_type: "daily_metrics",
        payload: {
          vendas_front: 3,
          vendas_totais: 4,
          checkouts: 7,
          fat_bruto: 1200.5,
          fat_liquido: 1000.25,
          bumps: [{ name: "Bump", type: "orderbump", count: 1, revenue: 97, rate: 33.33 }],
        },
      },
    ]);

    expect(metrics.vendas_front).toBe(1);
    expect(metrics.vendas_totais).toBe(1);
    expect(metrics.checkouts).toBe(7);
    expect(metrics.fat_bruto).toBe(100);
    expect(metrics.fat_liquido).toBe(90);
    expect(metrics.bumps).toEqual([]);
  });

  it("lets an authoritative daily sheet correct partial gateway coverage", () => {
    const metrics = aggregateOneDay([
      {
        source: "meta",
        event_type: "insight",
        payload: { spend: 100, impressions: 1000, actions: [{ action_type: "link_click", value: 100 }] },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "partial-sale",
        payload: { total: 297, net: 270, is_front: true },
      },
      {
        source: "sheet_override",
        event_type: "daily_metrics",
        payload: {
          import_source: "daily_metrics_sheet",
          import_authoritative: true,
          vendas_front: 22,
          vendas_totais: 33,
          fat_bruto: 10000,
          fat_liquido: 9000,
          fat_front: 7000,
          fat_orderbump: 3000,
          fat_funil: 3000,
          bumps: [{ name: "Acesso", type: "orderbump", count: 11, revenue: 3000, rate: 50 }],
        },
      },
    ]);

    expect(metrics.investimento).toBe(100);
    expect(metrics.vendas_front).toBe(22);
    expect(metrics.vendas_totais).toBe(33);
    expect(metrics.fat_bruto).toBe(10000);
    expect(metrics.fat_liquido).toBe(9000);
    expect(metrics.bumps).toEqual([
      expect.objectContaining({ name: "Acesso", count: 11, revenue: 3000 }),
    ]);
  });

  it("repairs legacy Hubla imports and recognizes upsells from the raw invoice", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "legacy-hubla-front",
        payload: {
          import_source: "hubla_csv",
          transaction_id: "legacy-hubla-front",
          total: 197,
          net: 180,
          is_front: true,
          raw_payload: {
            import_source: "hubla_csv",
            raw_row: { itens_na_fatura: "3" },
          },
          items: [
            { external_id: "front", name: "Front", price: 197, type: "main", is_bump: false },
            {
              external_id: "ob-1, ob-2",
              name: "Bump 1, Bump 2",
              price: 0,
              type: "orderbump",
              is_bump: true,
            },
          ],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "legacy-hubla-upsell",
        payload: {
          import_source: "hubla_csv",
          transaction_id: "legacy-hubla-upsell",
          total: 780,
          net: 700,
          is_front: true,
          raw_payload: {
            import_source: "hubla_csv",
            data: { object: { is_upsell: true } },
          },
          items: [{ external_id: "upsell", name: "Acompanhamento Individual", price: 780, type: "main", is_bump: false }],
        },
      },
    ]);

    expect(metrics.vendas_front).toBe(1);
    expect(metrics.vendas_totais).toBe(4);
    expect(metrics.fat_orderbump).toBeNull();
    expect(metrics.fat_funil).toBeCloseTo(780);
    expect(metrics.bumps).toEqual([
      expect.objectContaining({ name: "Bump 1", count: 1, revenue: 0 }),
      expect.objectContaining({ name: "Bump 2", count: 1, revenue: 0 }),
      expect.objectContaining({ name: "Acompanhamento Individual", type: "upsell", count: 1, revenue: 780 }),
    ]);
  });

  it("does not count a Hubla child invoice that mirrors the front product", () => {
    const metrics = aggregateOneDay([
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "hubla-parent",
        payload: {
          transaction_id: "hubla-parent",
          total: 326.9,
          net: 299.93,
          is_front: true,
          product_id: "front",
          raw_payload: { event: { invoice: { childInvoiceIds: ["hubla-parent-offer-1"] } } },
          items: [{ external_id: "front", name: "Destrave sua coluna", price: 326.9, type: "main", is_bump: false }],
        },
      },
      {
        source: "gateway",
        event_type: "purchase.approved",
        external_id: "hubla-parent-offer-1",
        payload: {
          transaction_id: "hubla-parent",
          total: 197,
          net: 180,
          is_front: false,
          is_offer_event: true,
          product_id: "front",
          raw_payload: { event: { invoice: { parentInvoiceId: "hubla-parent" } } },
          items: [{ external_id: "front", name: "Destrave sua coluna", price: 197, type: "orderbump", is_bump: true }],
        },
      },
    ]);

    expect(metrics.vendas_front).toBe(1);
    expect(metrics.vendas_totais).toBe(1);
    expect(metrics.bumps).toEqual([]);
  });
});
