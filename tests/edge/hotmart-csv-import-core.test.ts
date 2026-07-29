import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseHotmartCsv } from "../../supabase/functions/hubla-csv-import/core";
import { aggregateOneDay } from "../../supabase/functions/aggregate-daily/core";

const fixture = readFileSync(
  "tests/fixtures/hotmart-sales-export.csv",
  "utf8",
);

describe("Hotmart spreadsheet import", () => {
  it("normalizes front and order bump using the parent transaction", () => {
    const result = parseHotmartCsv(fixture, {
      productRoles: {
        "prod-front": "front",
        "prod-bump": "order_bump",
        "prod-foreign": "front",
      },
      offerRoles: {
        "offer-front": "front",
        "offer-bump": "order_bump",
        "offer-foreign": "front",
      },
    });

    expect(result.dataRows).toBe(3);
    expect(result.events).toHaveLength(3);
    expect(result.imported).toBe(2);
    expect(result.excluded).toBe(1);

    const front = result.events.find(
      (event) => event.external_id === "hotmart:HP-FRONT-1",
    );
    expect(front).toMatchObject({
      event_type: "purchase.approved",
      event_date: "2026-07-26",
      payload: {
        provider: "hotmart",
        product_role: "front",
        transaction_id: "HP-FRONT-1",
        gross: 297,
        metrics_ready: true,
        ingestion_source: "spreadsheet",
      },
    });
    expect(front?.payload.net).toBeCloseTo(270.05);
    expect(front?.payload.platform_fee).toBeCloseTo(26.95);

    const bump = result.events.find(
      (event) => event.external_id === "hotmart:HP-BUMP-1",
    );
    expect(bump).toMatchObject({
      payload: {
        product_role: "order_bump",
        transaction_id: "HP-FRONT-1",
        parent_transaction_id: "HP-FRONT-1",
        is_offer_event: true,
        metrics_ready: true,
      },
    });
    expect(bump?.payload.items[0]).toMatchObject({
      external_id: "prod-bump",
      type: "order_bump",
      is_bump: true,
    });

    const foreign = result.events.find(
      (event) => event.external_id === "hotmart:HP-FOREIGN-1",
    );
    expect(foreign?.payload).toMatchObject({
      metrics_ready: false,
      exclusion_reason: "unsupported_currency",
      original_currency: "USD",
    });
  });

  it("aggregates a linked bump as one front order with incremental revenue", () => {
    const parsed = parseHotmartCsv(fixture, {
      productRoles: {
        "prod-front": "front",
        "prod-bump": "order_bump",
        "prod-foreign": "front",
      },
      offerRoles: {},
    });
    const metrics = aggregateOneDay(
      parsed.events
        .filter(
          (event) =>
            event.event_date === "2026-07-26"
            && event.payload.metrics_ready !== false,
        )
        .map((event) => ({
          source: "gateway",
          event_type: event.event_type,
          external_id: event.external_id,
          payload: event.payload,
        })),
    );

    expect(metrics.vendas_front).toBe(1);
    expect(metrics.vendas_totais).toBe(2);
    expect(metrics.order_bump_orders).toBe(1);
    expect(metrics.conv_geral_orderbump).toBe(100);
    expect(metrics.fat_bruto).toBeCloseTo(364);
    expect(metrics.fat_orderbump).toBeCloseTo(67);
    expect(metrics.aov).toBeCloseTo(364);
  });

  it("never copies buyer PII into normalized payloads", () => {
    const result = parseHotmartCsv(fixture, {
      productRoles: {
        "prod-front": "front",
        "prod-bump": "order_bump",
        "prod-foreign": "front",
      },
      offerRoles: {},
    });
    const serialized = JSON.stringify(result.events);

    expect(serialized).not.toContain("pessoa@example.com");
    expect(serialized).not.toContain("11999999999");
    expect(serialized).not.toContain("98765432109");
    expect(serialized).not.toContain("Pessoa Teste");
  });

  it("preserves unbound products without contaminating metrics", () => {
    const result = parseHotmartCsv(fixture, {
      productRoles: { "prod-front": "front" },
      offerRoles: {},
    });
    const bump = result.events.find(
      (event) => event.external_id === "hotmart:HP-BUMP-1",
    );

    expect(bump?.payload).toMatchObject({
      metrics_ready: false,
      exclusion_reason: "unbound_product",
    });
    expect(result.warnings.join(" ")).toContain("não está vinculado");
  });

  it("deduplicates repeated transactions in the same export", () => {
    const lines = fixture.trim().split("\n");
    const duplicated = [...lines, lines[1]].join("\n");
    const result = parseHotmartCsv(duplicated, {
      productRoles: {
        "prod-front": "front",
        "prod-bump": "order_bump",
        "prod-foreign": "front",
      },
      offerRoles: {},
    });

    expect(result.events).toHaveLength(3);
    expect(result.warnings.join(" ")).toContain("duplicada");
  });

  it("blocks a role mismatch between the sheet and funnel binding", () => {
    const result = parseHotmartCsv(fixture, {
      productRoles: {
        "prod-front": "front",
        "prod-bump": "upsell",
        "prod-foreign": "front",
      },
      offerRoles: {},
    });
    const bump = result.events.find(
      (event) => event.external_id === "hotmart:HP-BUMP-1",
    );

    expect(bump?.payload).toMatchObject({
      metrics_ready: false,
      exclusion_reason: "product_role_mismatch",
    });
  });
});
