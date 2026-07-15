import { describe, expect, it } from "vitest";
import { normalizeHubla } from "../../supabase/functions/webhook-gateway/core";

describe("webhook gateway core", () => {
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
});
