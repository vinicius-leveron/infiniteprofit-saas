import { describe, expect, it } from "vitest";
import { parseHublaCsv } from "../../supabase/functions/hubla-csv-import/core";

describe("hubla csv import core", () => {
  it("parses approved Hubla CSV rows with Brazilian money and metadata", () => {
    const csv = [
      "transação;data_pagamento;status;valor;valor_liquido;forma_pagamento;email;produto;tipo_produto;utm_source",
      "tx-1;01/06/2026 10:00;Aprovado;R$ 1.506,82;R$ 1.400,00;Cartão;buyer@example.com;Produto Front;main;Meta",
    ].join("\n");

    const result = parseHublaCsv(csv);

    expect(result.warnings).toEqual([]);
    expect(result.dataRows).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      line: 2,
      event_type: "purchase.approved",
      event_date: "2026-06-01",
      external_id: "tx-1",
    });
    expect(result.events[0].payload.total).toBeCloseTo(1506.82);
    expect(result.events[0].payload.net).toBeCloseTo(1400);
    expect(result.events[0].payload.payment_method).toBe("cartão");
    expect(result.events[0].payload.buyer_email).toBe("buyer@example.com");
    expect(result.events[0].payload.utm_source).toBe("meta");
  });

  it("parses refused and refunded rows without requiring an approved status", () => {
    const csv = [
      "transaction,status,amount,created_at",
      "tx-failed,Recusada,197.00,2026-06-02T10:00:00-03:00",
      "tx-refund,Reembolsado,197.00,2026-06-03T10:00:00-03:00",
    ].join("\n");

    const result = parseHublaCsv(csv);

    expect(result.warnings).toEqual([]);
    expect(result.events.map((event) => event.event_type)).toEqual([
      "purchase.refused",
      "purchase.refunded",
    ]);
    expect(result.events[0].payload.total).toBeCloseTo(197);
    expect(result.events[1].payload.total).toBeCloseTo(197);
  });

  it("does not assume approval when status and event fields are blank", () => {
    const csv = [
      "transacao;status;valor;data",
      "tx-empty;;R$ 197,00;04/06/2026",
    ].join("\n");

    const result = parseHublaCsv(csv);

    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toContain("status não reconhecido");
  });

  it("throws a clear error for empty CSV input", () => {
    expect(() => parseHublaCsv("transacao;status")).toThrow("CSV sem linhas suficientes");
  });
});
