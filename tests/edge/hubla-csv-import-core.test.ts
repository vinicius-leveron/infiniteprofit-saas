import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDailyMetricsCsv, parseHublaCsv } from "../../supabase/functions/hubla-csv-import/core";

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

  it("parses official Hubla invoice export headers with order bump columns", () => {
    const csv = [
      [
        "ID da fatura",
        "Tipo de fatura",
        "Detalhamento da fatura",
        "Status da fatura",
        "Método de pagamento",
        "Data de criação",
        "Data de pagamento",
        "Data de reembolso",
        "Itens na fatura",
        "Nome da oferta",
        "ID do produto",
        "Nome do produto",
        "ID do produto de orderbump",
        "Nome do produto de orderbump",
        "ID do cliente",
        "Email do cliente",
        "Valor do produto",
        "Valor total",
        "Valor Líquido",
        "UTM Origem",
        "UTM Mídia",
        "UTM Campanha",
        "UTM Conteúdo",
        "UTM Termo",
      ].join(";"),
      [
        "fat-1",
        "Venda",
        "Fatura regular",
        "Paga",
        "Pix",
        "01/06/2026 09:00",
        "01/06/2026 10:00",
        "",
        "2",
        "Oferta Rickson",
        "prod-front",
        "Produto Front",
        "prod-bump",
        "Alongue-se Bem",
        "cli-1",
        "buyer@example.com",
        "R$ 197,00",
        "R$ 241,42",
        "R$ 220,00",
        "Meta",
        "cpc",
        "Campanha Junho",
        "ad-123",
        "term",
      ].join(";"),
    ].join("\n");

    const result = parseHublaCsv(csv);

    expect(result.warnings).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      line: 2,
      event_type: "purchase.approved",
      event_date: "2026-06-01",
      external_id: "fat-1",
    });
    expect(result.events[0].payload.total).toBeCloseTo(241.42);
    expect(result.events[0].payload.net).toBeCloseTo(220);
    expect(result.events[0].payload.payment_method).toBe("pix");
    expect(result.events[0].payload.buyer_email).toBe("buyer@example.com");
    expect(result.events[0].payload.product_id).toBe("prod-front");
    expect(result.events[0].payload.utm_source).toBe("meta");
    expect(result.events[0].payload.utm_medium).toBe("cpc");
    expect(result.events[0].payload.items).toEqual([
      expect.objectContaining({
        external_id: "prod-front",
        name: "Produto Front",
        price: 197,
        is_bump: false,
      }),
      expect.objectContaining({
        external_id: "prod-bump",
        name: "Alongue-se Bem",
        is_bump: true,
      }),
    ]);
    expect(result.events[0].payload.items[1].price).toBeCloseTo(44.42);
  });

  it("splits multiple Hubla order bumps stored in one cell", () => {
    const csv = [
      "ID da fatura;Tipo de fatura;Detalhamento da fatura;Status da fatura;Data de pagamento;Itens na fatura;Nome da oferta;ID do produto;Nome do produto;ID do produto de orderbump;Nome do produto de orderbump;Valor do produto;Valor total",
      "fat-multi;Compra;Compra avulsa;Paga;15/07/2026 10:00;3;Oferta Front;front-1;Produto Front;ob-1, ob-2;Bump A, Bump B;197;241.42",
    ].join("\n");

    const result = parseHublaCsv(csv);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].payload.items).toHaveLength(3);
    expect(result.events[0].payload.items).toEqual([
      expect.objectContaining({ external_id: "front-1", is_bump: false, price: 197 }),
      expect.objectContaining({ external_id: "ob-1", name: "Bump A", is_bump: true, count_as_sale: true }),
      expect.objectContaining({ external_id: "ob-2", name: "Bump B", is_bump: true, count_as_sale: true }),
    ]);
    expect(result.events[0].payload.items[1].price).toBeCloseTo(22.21);
    expect(result.events[0].payload.items[2].price).toBeCloseTo(22.21);
  });

  it("marks Hubla rows whose offer name contains upsell as funnel offers", () => {
    const csv = [
      "ID da fatura;Tipo de fatura;Detalhamento da fatura;Status da fatura;Data de pagamento;Itens na fatura;Nome da oferta;ID do produto;Nome do produto;Valor total",
      "fat-upsell;Compra;Compra avulsa;Paga;15/07/2026 10:00;1;Acompanhamento - UPSELL PERPETUO;up-1;Acompanhamento Individual;780",
    ].join("\n");

    const result = parseHublaCsv(csv);

    expect(result.events[0].payload).toMatchObject({
      is_front: false,
      is_offer_event: true,
      items: [expect.objectContaining({ type: "upsell", is_bump: true, count_as_sale: true })],
    });
  });

  it("keeps Hubla liquid value below 100 as reais, not cents", () => {
    const csv = [
      "ID da fatura;Status da fatura;Data de pagamento;Valor total;Valor Líquido;Nome do produto",
      "fat-net-small;Paga;02/06/2026 17:05:48;97;87.24;Passos sem Dor",
    ].join("\n");

    const result = parseHublaCsv(csv);

    expect(result.warnings).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].payload.total).toBeCloseTo(97);
    expect(result.events[0].payload.net).toBeCloseTo(87.24);
  });

  it("parses the versioned Hubla QA fixture without false positives", () => {
    const csv = readFileSync("tests/fixtures/hubla-official-export.csv", "utf8");

    const result = parseHublaCsv(csv);

    expect(result.headers).toContain("id_da_fatura");
    expect(result.warnings).toEqual([]);
    expect(result.dataRows).toBe(4);
    expect(result.events.map((event) => event.event_type)).toEqual([
      "purchase.approved",
      "purchase.refused",
      "purchase.refunded",
      "purchase.approved",
    ]);
    expect(result.events[0].payload.items).toEqual([
      expect.objectContaining({ type: "main", is_bump: false }),
      expect.objectContaining({ type: "orderbump", is_bump: true }),
    ]);
    expect(result.events[3].payload.items).toEqual([
      expect.objectContaining({ type: "upsell", is_bump: true }),
    ]);
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

  it("reports zero recognized events for dashboard spreadsheets instead of importing fake sales", () => {
    const csv = [
      "Data;Investimento;Cliques;Faturamento líquido",
      "01/06/2026;R$ 100,00;20;R$ 500,00",
    ].join("\n");

    const result = parseHublaCsv(csv);

    expect(result.dataRows).toBe(1);
    expect(result.headers).toEqual(["data", "investimento", "cliques", "faturamento_liquido"]);
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toContain("status não reconhecido");
  });

  it("parses daily tracking spreadsheets as daily metric overrides", () => {
    const csv = [
      "Data;Investimento;Vendas Front;Vendas Totais do Funil;Faturamento Bruto Total do Funil;Faturamento Líquido Total do Funil (- taxas PLATAFORMA);Imposto Meta;ROI (fat liquido - imposto - meta);Lucro;Cliques;Pageviews;LP Views;Checkouts",
      "01/06/2026;R$ 100,00;3;4;R$ 1.200,50;R$ 1.000,25;R$ 12,50;8,88;R$ 887,75;20;18;17;7",
      "22/06/2026;0;;;0;;;;R$0,00;0;0;0",
    ].join("\n");

    const result = parseDailyMetricsCsv(csv);

    expect(result.dataRows).toBe(2);
    expect(result.overrides).toHaveLength(1);
    expect(result.overrides[0]).toMatchObject({
      line: 2,
      event_date: "2026-06-01",
      payload: {
        investimento: 100,
        vendas_front: 3,
        vendas_totais: 4,
        fat_bruto: 1200.5,
        fat_liquido: 1000.25,
        imposto_meta: 12.5,
        roi: 8.88,
        lucro: 887.75,
        cliques: 20,
        landing_pageviews: 17,
        pageviews: 18,
        checkouts: 7,
      },
    });
    expect(result.overrides[0].payload.import_authoritative).toBe(true);
  });

  it("reconciles funnel sales with grouped order bump columns", () => {
    const csv = [
      "Data;Investimento;Vendas Front;Vendas Totais do Funil;Orderbump - Acesso;Faturamento - Orderbump - Acesso;% Conversão - Orderbump - Acesso;Orderbump - Suporte;Faturamento - Orderbump - Suporte;% Conversão - Orderbump - Suporte;Faturamento Líquido",
      "15/07/2026;R$ 100,00;22;26;5;R$ 485,00;22,73%;6;R$ 582,00;27,27%;R$ 1.000,00",
    ].join("\n");

    const result = parseDailyMetricsCsv(csv);

    expect(result.overrides[0].payload.vendas_front).toBe(22);
    expect(result.overrides[0].payload.vendas_totais).toBe(33);
    expect(result.warnings).toContain(
      "Linha 2: vendas totais ajustadas de 26 para 33 (22 front + 11 ofertas agrupadas)",
    );
  });

  it("uses an aggregate order bump sales column when product columns are grouped", () => {
    const csv = [
      "Data;Investimento;Vendas Front;Vendas Totais do Funil;Vendas Orderbump;Faturamento Líquido",
      "15/07/2026;R$ 100,00;22;26;11;R$ 1.000,00",
    ].join("\n");

    const result = parseDailyMetricsCsv(csv);

    expect(result.overrides[0].payload.vendas_totais).toBe(33);
    expect(result.warnings).toContain(
      "Linha 2: vendas totais ajustadas de 26 para 33 (22 front + 11 ofertas agrupadas)",
    );
  });

  it("throws a clear error for empty CSV input", () => {
    expect(() => parseHublaCsv("transacao;status")).toThrow("CSV sem linhas suficientes");
  });
});
