import { describe, expect, it } from "vitest";
import {
  normalizeHotmart,
  normalizeHubla,
  validateHotmartHottok,
} from "../../supabase/functions/webhook-gateway/core";

describe("webhook gateway core", () => {
  it("accepts only the exact Hotmart Hottok", () => {
    expect(validateHotmartHottok("hottok-correto", "hottok-correto")).toBe(
      true,
    );
    expect(validateHotmartHottok("hottok-errado", "hottok-correto")).toBe(
      false,
    );
    expect(validateHotmartHottok(null, "hottok-correto")).toBe(false);
  });

  it("normalizes Hubla Stripe-like invoice success with cents and audit payload", () => {
    const raw = {
      id: "evt_123",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_123",
          amount_paid: 150682,
          amount_due: 150682,
          payment_method_types: ["card"],
          customer_email: "buyer@example.com",
          status_transitions: { paid_at: Date.UTC(2026, 5, 1, 15, 0, 0) / 1000 },
          metadata: { utm_source: "Meta", utm_campaign: "Rickson" },
        },
      },
    };

    const [event] = normalizeHubla(raw);

    expect(event.event_type).toBe("purchase.approved");
    expect(event.event_date).toBe("2026-06-01");
    expect(event.external_id).toBe("in_123");
    expect(event.payload.total).toBeCloseTo(1506.82);
    expect(event.payload.net).toBeCloseTo(1506.82);
    expect(event.payload.payment_method).toBe("card");
    expect(event.payload.buyer_email).toBe("buyer@example.com");
    expect(event.payload.transaction_id).toBe("in_123");
    expect(event.payload.raw_payload).toBe(raw);
    expect(event.payload.utm_source).toBe("meta");
  });

  it("normalizes Hubla refused and refunded invoices", () => {
    const refused = normalizeHubla({
      type: "invoice.payment_failed",
      data: { object: { id: "in_failed", amount_due: 19700, created: 1780498800 } },
    });
    const refunded = normalizeHubla({
      type: "invoice.refunded",
      data: { object: { id: "in_refund", amount_paid: 19700, created: 1780498800 } },
    });

    expect(refused[0]?.event_type).toBe("purchase.refused");
    expect(refused[0]?.payload.total).toBeCloseTo(197);
    expect(refunded[0]?.event_type).toBe("purchase.refunded");
    expect(refunded[0]?.payload.total).toBeCloseTo(197);
  });

  it("normalizes Portuguese Hubla paid status as approved", () => {
    const [event] = normalizeHubla({
      data: {
        object: {
          id: "fat-paga",
          status: "Paga",
          amount_paid: 19700,
          paid_at: "2026-06-01T12:00:00.000-03:00",
        },
      },
    });

    expect(event.event_type).toBe("purchase.approved");
    expect(event.event_date).toBe("2026-06-01");
    expect(event.external_id).toBe("fat-paga");
    expect(event.payload.total).toBeCloseTo(197);
  });

  it("normalizes Hubla status updates with completed/confirmed statuses as approved", () => {
    const completed = normalizeHubla({
      type: "invoice.status_updated",
      event: {
        invoice: {
          id: "invoice-completed",
          state: "completed",
          amount: { totalCents: 29700 },
          updatedAt: "2026-07-15T12:00:00.000Z",
        },
      },
    });
    const confirmed = normalizeHubla({
      type: "payment.confirmed",
      data: {
        object: {
          id: "invoice-confirmed",
          status: "confirmado",
          amount_paid: 19700,
          updated_at: "2026-07-15T12:00:00.000Z",
        },
      },
    });

    expect(completed[0]?.event_type).toBe("purchase.approved");
    expect(completed[0]?.payload.total).toBeCloseTo(297);
    expect(confirmed[0]?.event_type).toBe("purchase.approved");
    expect(confirmed[0]?.payload.total).toBeCloseTo(197);
  });

  it("uses Hubla seller receiver total as net revenue", () => {
    const [event] = normalizeHubla({
      type: "invoice.payment_succeeded",
      event: {
        invoice: {
          id: "fat-liquid",
          status: "paid",
          amount: { totalCents: 29700 },
          receivers: [
            { role: "platform", totalCents: 1730 },
            { role: "seller", totalCents: 27970 },
          ],
          saleDate: "2026-06-23T12:00:00.000Z",
        },
      },
    });

    expect(event.event_type).toBe("purchase.approved");
    expect(event.payload.total).toBeCloseTo(297);
    expect(event.payload.net).toBeCloseTo(279.7);
  });

  it("keeps coproducer share in net revenue while exposing the receiver split", () => {
    const [event] = normalizeHubla({
      type: "invoice.payment_succeeded",
      event: {
        invoice: {
          id: "fat-coproduction",
          status: "paid",
          amount: { totalCents: 10000 },
          receivers: [
            { role: "seller", totalCents: 4050 },
            { role: "partner", totalCents: 4950 },
            { role: "platform", totalCents: 1000 },
          ],
          saleDate: "2026-07-15T12:00:00.000Z",
        },
      },
    });

    expect(event.payload.net).toBeCloseTo(90);
    expect(event.payload.account_net).toBeCloseTo(40.5);
    expect(event.payload.coproducer_amount).toBeCloseTo(49.5);
    expect(event.payload.coproduction_rate).toBeCloseTo(55);
    expect(event.payload.platform_fee).toBeCloseTo(10);
  });

  it("reconstructs consolidated net when Hubla sends only the seller receiver", () => {
    const [event] = normalizeHubla({
      type: "invoice.payment_succeeded",
      event: {
        invoice: {
          id: "fat-coproduction-owner-only",
          status: "paid",
          amount: { totalCents: 10000 },
          receivers: [
            { role: "platform", totalCents: 1000 },
            { role: "seller", totalCents: 4050 },
          ],
          saleDate: "2026-07-15T12:00:00.000Z",
        },
      },
    });

    expect(event.payload.net).toBeCloseTo(90);
    expect(event.payload.net_before_coproduction).toBeCloseTo(90);
    expect(event.payload.account_net).toBeCloseTo(40.5);
    expect(event.payload.coproduction_rate).toBeNull();
    expect(event.payload.platform_fee).toBeCloseTo(10);
  });

  it("derives coproduction rate when Hubla labels every payee as seller", () => {
    const [event] = normalizeHubla({
      type: "invoice.payment_succeeded",
      event: {
        invoice: {
          id: "fat-coproduction-seller-roles",
          sellerId: "owner",
          status: "paid",
          amount: { totalCents: 10000 },
          receivers: [
            { id: "platform-identity", role: "platform", totalCents: 1000 },
            { id: "owner", role: "seller", totalCents: 4050 },
            { id: "partner-account", role: "seller", totalCents: 4950 },
          ],
          saleDate: "2026-07-15T12:00:00.000Z",
        },
      },
    });

    expect(event.payload.net).toBeCloseTo(90);
    expect(event.payload.account_net).toBeCloseTo(40.5);
    expect(event.payload.coproducer_amount).toBeCloseTo(49.5);
    expect(event.payload.coproduction_rate).toBeCloseTo(55);
  });

  it("normalizes Hubla v2 invoice.created already paid as checkout and approved purchase", () => {
    const raw = {
      type: "invoice.created",
      version: "2.0.0",
      event: {
        user: { email: "buyer@example.com" },
        invoice: {
          id: "c26d37e2-aa2e-46bb-8735-91819b9c5b6b",
          type: "sell",
          amount: {
            totalCents: 36216,
            subtotalCents: 29700,
            installmentFeeCents: 6516,
          },
          receivers: [
            { role: "platform", totalCents: 7020 },
            { role: "seller", totalCents: 29196 },
          ],
          status: "paid",
          saleDate: "2026-06-22T21:26:10.300Z",
          createdAt: "2026-06-22T21:26:10.300Z",
          paymentMethod: "credit_card",
          payer: { email: "payer@example.com" },
          paymentSession: {
            utm: {
              source: "FB",
              campaign: "[DENISE] [VENDAS]",
              medium: "Instagram",
              content: "AD06",
              term: "Feed",
            },
          },
        },
        product: { id: "3KYffvGtV3QwRXXnwtyx", name: "Produto Denise" },
        products: [{ id: "3KYffvGtV3QwRXXnwtyx", name: "Produto Denise" }],
      },
    };

    const events = normalizeHubla(raw);

    expect(events.map((event) => event.event_type)).toEqual(["checkout_created", "purchase.approved"]);
    const approved = events.find((event) => event.event_type === "purchase.approved");
    expect(approved?.event_date).toBe("2026-06-22");
    expect(approved?.external_id).toBe("c26d37e2-aa2e-46bb-8735-91819b9c5b6b");
    expect(approved?.payload.total).toBeCloseTo(362.16);
    expect(approved?.payload.gross).toBeCloseTo(362.16);
    expect(approved?.payload.subtotal).toBeCloseTo(297);
    expect(approved?.payload.net).toBeCloseTo(291.96);
    expect(approved?.payload.payment_method).toBe("credit_card");
    expect(approved?.payload.buyer_email).toBe("payer@example.com");
    expect(approved?.payload.product_id).toBe("3KYffvGtV3QwRXXnwtyx");
    expect(approved?.payload.items).toEqual([
      expect.objectContaining({
        external_id: "3KYffvGtV3QwRXXnwtyx",
        name: "Produto Denise",
        price: 297,
        is_bump: false,
      }),
    ]);
    expect(approved?.payload.utm_source).toBe("fb");
    expect(approved?.payload.utm_content).toBe("ad06");
    expect(approved?.payload.raw_payload).toBe(raw);
  });

  it("normalizes the recommended Hubla invoice format as one sale with nested offers", () => {
    const events = normalizeHubla({
      type: "invoice.payment_succeeded",
      version: "2.0.0",
      event: {
        product: { id: "product-front", name: "Produto principal" },
        products: [
          {
            id: "product-front",
            name: "Produto principal anual",
            offers: [{
              id: "offer-front",
              name: "Principal",
              amountCents: 19700,
              isOrderBump: false,
            }],
          },
          {
            id: "product-bump-a",
            name: "Templates",
            offers: [{
              id: "offer-bump-a",
              name: "Oferta única",
              amountCents: 4700,
              isOrderBump: true,
            }],
          },
          {
            id: "product-bump-b",
            name: "Mentoria",
            offers: [{
              id: "offer-bump-b",
              name: "Oferta única",
              amountCents: 9700,
              isOrderBump: true,
            }],
          },
        ],
        hasOrderBump: true,
        invoice: {
          id: "invoice-recommended-1",
          status: "paid",
          payerId: "payer-1",
          amount: { subtotalCents: 34100, totalCents: 34100 },
          paymentMethod: "credit_card",
          createdAt: "2026-08-06T12:00:00.000Z",
          receivers: [
            { role: "platform", totalCents: 4100 },
            { role: "seller", totalCents: 30000 },
          ],
        },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("purchase.approved");
    expect(events[0].external_id).toBe("invoice-recommended-1");
    expect(events[0].payload.total).toBe(341);
    expect(events[0].payload.buyer_provider_id).toBe("payer-1");
    expect(events[0].payload.items).toEqual([
      expect.objectContaining({ external_id: "offer-front", product_id: "product-front", price: 197, is_bump: false }),
      expect.objectContaining({ external_id: "offer-bump-a", product_id: "product-bump-a", price: 47, is_bump: true }),
      expect.objectContaining({ external_id: "offer-bump-b", product_id: "product-bump-b", price: 97, is_bump: true }),
    ]);
  });

  it("keeps Hubla v2 unpaid invoice.created as checkout only", () => {
    const events = normalizeHubla({
      type: "invoice.created",
      event: {
        invoice: {
          id: "unpaid-invoice",
          status: "unpaid",
          amount: { totalCents: 19700 },
          createdAt: "2026-06-22T21:26:10.300Z",
        },
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("checkout_created");
    expect(events[0].payload.total).toBeCloseTo(197);
   });

  it("marks offer suffix events as order bump items without changing the upsert id", () => {
    const [event] = normalizeHubla({
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "tx-abc-offer-1",
          amount_paid: 75670,
          description: "Order bump",
          created: "2026-06-06T12:00:00.000Z",
        },
      },
    });

    expect(event.external_id).toBe("tx-abc-offer-1");
    expect(event.payload.transaction_id).toBe("tx-abc");
    expect(event.payload.is_offer_event).toBe(true);
    expect(event.payload.is_front).toBe(false);
    expect(event.payload.items).toEqual([
      expect.objectContaining({
        external_id: "tx-abc-offer-1",
        is_bump: true,
        price: 756.7,
      }),
    ]);
  });

  it("does not create approved checkout events when no amount is present", () => {
    const events = normalizeHubla({
      type: "invoice.payment_succeeded",
      data: { object: { id: "in_without_amount", created: "2026-06-01T12:00:00.000Z" } },
    });

    expect(events).toEqual([]);
  });

  it("publishes a bound Hotmart webhook sale and gross while commissions are enriching", () => {
    const [event] = normalizeHotmart({
      id: "evt-hot-1",
      event: "PURCHASE_APPROVED",
      creation_date: 1785258000000,
      data: {
        product: {
          id: 101,
          ucode: "ucode-front",
          name: "Produto principal",
        },
        purchase: {
          transaction: "HP123",
          status: "APPROVED",
          approved_date: 1785258000000,
          full_price: { value: 297, currency_value: "BRL" },
          hotmart_fee: { value: 27, currency_value: "BRL" },
          payment: { type: "CREDIT_CARD" },
          offer: { code: "offer-front" },
          origin: { src: "Meta", sck: "AD-07" },
        },
      },
    }, {
      productRoles: { "101": "front", "ucode-front": "front" },
      offerRoles: { "offer-front": "front" },
      requireProductBinding: true,
    });

    expect(event.event_type).toBe("purchase.approved");
    expect(event.external_id).toBe("hotmart:HP123");
    expect(event.payload).toEqual(expect.objectContaining({
      provider: "hotmart",
      gross: 297,
      total: 297,
      platform_fee: null,
      net: null,
      currency: "BRL",
      payment_method: "credit_card",
      product_id: "101",
      product_ucode: "ucode-front",
      offer_code: "offer-front",
      product_role: "front",
      is_front: true,
      is_upsell: false,
      metrics_ready: true,
      financial_metrics_ready: false,
      financial_state: "pending",
      financial_exclusion_reason: "financial_enrichment_required",
      utm_source: "meta",
      utm_content: "ad-07",
    }));
    expect(event.payload).not.toHaveProperty("raw_payload");
  });

  it("consolidates producer, affiliate and all coproducers from authoritative Hotmart commissions", () => {
    const [event] = normalizeHotmart({
      id: "api-HP-CONSOLIDATED-APPROVED",
      event: "PURCHASE_APPROVED",
      creation_date: 1785258000000,
      data: {
        product: { id: "front", name: "Produto principal" },
        purchase: {
          transaction: "HP-CONSOLIDATED",
          approved_date: 1785258000000,
          full_price: { value: 297, currency_value: "BRL" },
        },
        commissions: [
          { source: "PRODUCER", commission: { value: 243.04, currency_value: "BRL" } },
          { source: "AFFILIATE", commission: { value: 0, currency_value: "BRL" } },
          { source: "COPRODUCER", commission: { value: 17.01, currency_value: "BRL" } },
          { source: "CO_PRODUCER", commission: { value: 10, currency_value: "BRL" } },
          { source: "HOTMART", commission: { value: 26.95, currency_value: "BRL" } },
        ],
      },
    }, {
      productRoles: { front: "front" },
      requireProductBinding: true,
      source: "api",
      commissionsAuthoritative: true,
    });

    expect(event.payload).toEqual(expect.objectContaining({
      gross: 297,
      producer_net: 243.04,
      affiliate_net: 0,
      coproducer_net: 27.01,
      consolidated_net: 270.05,
      net: 270.05,
      platform_fee: 26.95,
      financial_metrics_ready: true,
      financial_state: "ready",
    }));
  });

  it("classifies Hotmart bump and upsell products from the funnel binding", () => {
    const bump = normalizeHotmart(hotmartPurchaseFixture("PURCHASE_COMPLETE", {
      transaction: "HP-BUMP",
      productId: "bump-1",
      offerCode: "bump-offer",
    }), {
      productRoles: { "bump-1": "order_bump" },
      requireProductBinding: true,
    })[0];
    const upsell = normalizeHotmart(hotmartPurchaseFixture("PURCHASE_APPROVED", {
      transaction: "HP-UPSELL",
      productId: "upsell-1",
      offerCode: "upsell-offer",
    }), {
      offerRoles: { "upsell-offer": "upsell" },
      requireProductBinding: true,
    })[0];

    expect(bump.payload.product_role).toBe("order_bump");
    expect(bump.payload.items[0]).toEqual(
      expect.objectContaining({ type: "order_bump", is_bump: true }),
    );
    expect(upsell.payload.product_role).toBe("upsell");
    expect(upsell.payload.is_upsell).toBe(true);
  });

  it("preserves unbound and unsupported-currency Hotmart events without aggregating them", () => {
    const unbound = normalizeHotmart(
      hotmartPurchaseFixture("PURCHASE_APPROVED", {
        transaction: "HP-UNBOUND",
        productId: "other-product",
      }),
      { productRoles: { expected: "front" }, requireProductBinding: true },
    )[0];
    const foreign = normalizeHotmart({
      ...hotmartPurchaseFixture("PURCHASE_APPROVED", {
        transaction: "HP-USD",
        productId: "front-usd",
      }),
      data: {
        ...hotmartPurchaseFixture("PURCHASE_APPROVED", {
          transaction: "HP-USD",
          productId: "front-usd",
        }).data,
        purchase: {
          transaction: "HP-USD",
          approved_date: 1785258000000,
          full_price: { value: 100, currency_value: "USD" },
          hotmart_fee: { value: 10, currency_value: "USD" },
        },
      },
    }, {
      productRoles: { "front-usd": "front" },
      requireProductBinding: true,
    })[0];

    expect(unbound.payload.metrics_ready).toBe(false);
    expect(unbound.payload.exclusion_reason).toBe("unbound_product");
    expect(foreign.payload.metrics_ready).toBe(false);
    expect(foreign.payload.exclusion_reason).toBe("unsupported_currency");
  });

  it("accepts foreign currency only with Hotmart commission conversion", () => {
    const fixture = hotmartPurchaseFixture("PURCHASE_APPROVED", {
      transaction: "HP-CONVERTED",
      productId: "front-usd",
    });
    fixture.data.purchase.full_price = {
      value: 100,
      currency_value: "USD",
    };
    fixture.data.purchase.hotmart_fee = {
      value: 10,
      currency_value: "USD",
    };
    const [event] = normalizeHotmart({
      ...fixture,
      data: {
        ...fixture.data,
        commissions: [
          {
            source: "PRODUCER",
            value: 90,
            currency_value: "USD",
            currency_conversion: {
              converted_value: 450,
              converted_to_currency: "BRL",
              conversion_rate: 5,
            },
          },
          {
            source: "MARKETPLACE",
            value: 10,
            currency_value: "USD",
          },
        ],
      },
    }, {
      productRoles: { "front-usd": "front" },
      requireProductBinding: true,
      source: "api",
      commissionsAuthoritative: true,
    });

    expect(event.payload).toEqual(expect.objectContaining({
      gross: 500,
      platform_fee: 50,
      net: 450,
      original_currency: "USD",
      currency: "BRL",
      metrics_ready: true,
    }));
  });

  it("uses only the informed amount for a partial Hotmart refund", () => {
    const [event] = normalizeHotmart({
      event: "PURCHASE_PARTIALLY_REFUNDED",
      creation_date: 1785258000000,
      data: {
        product: { id: "front" },
        purchase: {
          transaction: "HP-PARTIAL",
          full_price: { value: 300, currency_value: "BRL" },
          hotmart_fee: { value: 30, currency_value: "BRL" },
          refund_value: { value: 50 },
        },
        commissions: [{
          source: "PRODUCER",
          commission: { value: 270, currency_value: "BRL" },
        }],
      },
    }, {
      productRoles: { front: "front" },
      requireProductBinding: true,
      source: "api",
      commissionsAuthoritative: true,
    });

    expect(event.event_type).toBe("purchase.refunded");
    expect(event.payload.total).toBe(50);
    expect(event.payload.net).toBe(45);
    expect(event.payload.metrics_ready).toBe(true);
  });

  it.each([
    ["PURCHASE_BILLET_PRINTED", "checkout_created"],
    ["PURCHASE_CANCELED", "purchase.refused"],
    ["PURCHASE_EXPIRED", "purchase.refused"],
    ["PURCHASE_DELAYED", "purchase.refused"],
    ["PURCHASE_PROTEST", "purchase.refused"],
    ["PURCHASE_REFUNDED", "purchase.refunded"],
    ["PURCHASE_CHARGEBACK", "purchase.refunded"],
  ])("maps Hotmart %s to %s", (rawEvent, expectedType) => {
    const [event] = normalizeHotmart(
      hotmartPurchaseFixture(rawEvent, {
        transaction: `HP-${rawEvent}`,
        productId: "front",
      }),
      { productRoles: { front: "front" }, requireProductBinding: true },
    );

    expect(event.event_type).toBe(expectedType);
    expect(event.payload.metrics_ready).toBe(true);
  });

  it("keeps recurring approvals idempotent by transaction", () => {
    const fixture = hotmartPurchaseFixture("PURCHASE_APPROVED", {
      transaction: "HP-RECURRENCE-03",
      productId: "subscription-front",
    });
    fixture.data.purchase.recurrence_number = 3;
    const [event] = normalizeHotmart(fixture, {
      productRoles: { "subscription-front": "front" },
      requireProductBinding: true,
    });

    expect(event.external_id).toBe("hotmart:HP-RECURRENCE-03");
    expect(event.payload.transaction_id).toBe("HP-RECURRENCE-03");
    expect(event.payload.recurrence_number).toBe(3);
  });

  it("keeps Hotmart cart abandonment operational and separate from checkout KPI", () => {
    const [event] = normalizeHotmart(
      hotmartPurchaseFixture("PURCHASE_OUT_OF_SHOPPING_CART", {
        transaction: "HP-ABANDONED",
        productId: "front",
      }),
      { productRoles: { front: "front" }, requireProductBinding: true },
    );

    expect(event.event_type).toBe("checkout.abandoned");
    expect(event.payload.metrics_ready).toBe(false);
    expect(event.payload.exclusion_reason).toBe(
      "cart_abandonment_is_operational",
    );
  });
});

function hotmartPurchaseFixture(
  event: string,
  {
    transaction,
    productId,
    offerCode = "offer",
  }: {
    transaction: string;
    productId: string;
    offerCode?: string;
  },
) {
  return {
    id: `evt-${transaction}`,
    event,
    creation_date: 1785258000000,
    data: {
      product: { id: productId, name: productId },
      purchase: {
        transaction,
        status: "APPROVED",
        approved_date: 1785258000000,
        full_price: { value: 197, currency_value: "BRL" },
        hotmart_fee: { value: 17, currency_value: "BRL" },
        offer: { code: offerCode },
      },
    },
  };
}
