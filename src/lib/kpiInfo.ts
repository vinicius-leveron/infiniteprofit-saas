/**
 * Dicionário de tooltips explicativos para KPIs.
 * Chave = label do KPI (case-insensitive, comparação por slug).
 */

const map: Record<string, { formula?: string; description: string }> = {
  "faturamento liquido": {
    formula: "Faturamento Bruto − Taxas − Imposto Meta",
    description: "Receita real entrada após descontos da plataforma e impostos.",
  },
  "faturamento bruto": {
    description: "Soma do valor de todas as vendas antes de qualquer dedução.",
  },
  "lucro": {
    formula: "Faturamento Líquido − Investimento",
    description: "Quanto sobrou após pagar tráfego.",
  },
  "roi": {
    formula: "Faturamento Líquido ÷ Investimento",
    description: "Retorno sobre investimento. ≥ 1.0x = lucro. < 1.0x = prejuízo.",
  },
  "investimento": {
    description: "Soma de tudo que foi gasto em mídia paga no período.",
  },
  "invest medio dia": {
    formula: "Investimento ÷ Dias",
    description: "Aporte diário médio em tráfego.",
  },
  "vendas totais": {
    description: "Soma de todas as vendas do funil (front + bumps + upsells).",
  },
  "vendas front": {
    description: "Vendas do produto principal (entrada do funil).",
  },
  "aov": {
    formula: "Faturamento Líquido ÷ Vendas Totais",
    description: "Average Order Value — ticket médio da venda completa.",
  },
  "cac": {
    formula: "Investimento ÷ Vendas Totais",
    description: "Custo de aquisição por cliente. Quanto menor, melhor.",
  },
  "aprov cartao": {
    description: "Taxa média de aprovação em cartão de crédito.",
  },
  "aprov pix": {
    description: "Taxa média de aprovação em Pix.",
  },
  "reembolsos": {
    description: "Quantidade de pedidos reembolsados no período.",
  },
  "ctr": {
    formula: "Cliques no link ÷ Impressões",
    description: "Click-through rate — quantos clicaram após ver o anúncio.",
  },
  "cpm": {
    formula: "(Investimento ÷ Impressões) × 1000",
    description: "Custo por mil impressões.",
  },
  "cpc": {
    formula: "Investimento ÷ Cliques no link",
    description: "Custo por clique no link.",
  },
  "custo por i c": {
    formula: "Investimento ÷ Checkouts",
    description: "Custo para gerar um checkout iniciado na Hubla.",
  },
  "custo pageview": {
    formula: "Investimento ÷ Landing Page Views",
    description: "Custo para entregar uma visualização de página de destino.",
  },
  "custo lp view": {
    formula: "Investimento ÷ Landing Page Views",
    description: "Custo para entregar uma visualização de página de destino.",
  },
  "taxa de carregamento": {
    formula: "Landing Page Views ÷ Cliques no link",
    description: "Quanto do tráfego pago efetivamente carrega a página.",
  },
  "play rate": {
    description: "Quem viu a página e iniciou o vídeo.",
  },
  "retencao pitch": {
    description: "Quem assiste o vídeo até a parte do pitch (oferta).",
  },
  "pitch checkout": {
    description: "Quem chegou no pitch e foi pro checkout.",
  },
  "pitch venda": {
    description: "Conversão direta de quem chegou no pitch em vendas.",
  },
  "checkout venda": {
    description: "Eficiência de fechamento dentro do checkout.",
  },
  "impressoes": {
    description: "Quantas vezes seu anúncio foi exibido.",
  },
  "cliques": {
    description: "Cliques no link do anúncio.",
  },
  "cliques no link": {
    description: "Cliques no link do anúncio.",
  },
  "lp views": {
    description: "Landing Page Views da Meta.",
  },
  "landing page views": {
    description: "Landing Page Views da Meta.",
  },
  "pageviews": {
    description: "Pageviews VSL vindos da VTurb.",
  },
  "checkouts": {
    description: "Checkouts iniciados (intenção de compra).",
  },
  "faturamento total funil": {
    description: "Soma de tudo (front + order bumps + upsells).",
  },
  "proporcao funil x front": {
    formula: "Faturamento Funil ÷ Faturamento Front",
    description: "Quanto o funil amplia a receita do produto principal.",
  },
  "% conv geral orderbump": {
    formula: "Vendas Orderbump ÷ Vendas Front",
    description: "% dos compradores que aceitaram um order bump.",
  },
  "receita bumps": {
    description: "Receita gerada por order bumps no checkout.",
  },
  "receita upsells": {
    description: "Receita gerada por upsells pós-compra.",
  },
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function getKpiInfo(label: string): { formula?: string; description: string } | null {
  const key = slug(label);
  if (map[key]) return map[key];
  // tenta match parcial
  for (const k in map) {
    if (key.startsWith(k) || k.startsWith(key)) return map[k];
  }
  return null;
}
