import Papa from "papaparse";

/* ============================================================
   Types
   ============================================================ */
export interface BumpDef {
  /** Display name (e.g. "25 Afirmações") */
  name: string;
  /** Type inferred from header */
  type: "orderbump" | "upsell";
  /** Optional price extracted from header like "(R$ 29,90)" */
  price: number | null;
  countCol: number;
  revCol: number;
  rateCol: number;
}

export interface BumpDaily {
  name: string;
  type: "orderbump" | "upsell";
  count: number | null;
  revenue: number | null;
  rate: number | null; // percent
}

export interface DailyRow {
  data: string;
  date: Date | null;
  diaSemana: string;
  investimento: number | null;
  vendasFront: number | null;
  vendasTotais: number | null;
  cpaFront: number | null;
  fatBruto: number | null;
  fatLiquido: number | null;
  impostoMeta: number | null;
  roi: number | null;
  lucro: number | null;
  cac: number | null;
  aov: number | null;
  fatFront: number | null;
  fatOrderbump: number | null;
  fatFunil: number | null;
  reembolsos: number | null;
  taxaReembolso: number | null;
  valorReembolsado: number | null;
  aprovCartao: number | null;
  aprovPix: number | null;
  impressoes: number | null;
  cliques: number | null;
  landingPageviews?: number | null;
  pageviews: number | null;
  checkouts: number | null;
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  custoPageview: number | null;
  custoIC: number | null;
  taxaCarreg: number | null;
  passChk: number | null;
  playRate: number | null;
  retPitch: number | null;
  viewsUnicas: number | null;
  chegaramPitch: number | null;
  pitchChk: number | null;
  pitchVenda: number | null;
  chkVenda: number | null;
  obs: string;
  convGeralOrderbump: number | null;
  proporcaoFunilFront: number | null;
  bumps: BumpDaily[];
}

export interface ParsedCsv {
  rows: DailyRow[];
  bumpDefs: BumpDef[];
}

/* ============================================================
   parseBR — pt-BR number/currency/percent parser
   ============================================================ */
export function parseBR(input: unknown): number | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s || s === "—" || s === "#DIV/0!" || s === "-" || s === "N/A" || s === "#N/A") return null;
  const neg = s.startsWith("-") || /^\(.*\)$/.test(s);
  s = s.replace(/^\((.*)\)$/, "$1").replace(/^-/, "");
  s = s.replace(/R\$/gi, "").replace(/%$/, "").replace(/\s|\u00a0/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  } else if (s.includes(".")) {
    const parts = s.split(".");
    const allThree = parts.slice(1).every((p) => p.length === 3);
    const firstOK = parts[0].length >= 1 && parts[0].length <= 3;
    if (parts.length >= 2 && allThree && firstOK) s = s.replace(/\./g, "");
  }
  const v = parseFloat(s);
  if (isNaN(v)) return null;
  return neg ? -v : v;
}

function parseDateBR(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Map of normalized (slugged) header → DailyRow key.
 * Order matters: more specific aliases come first so they win in the
 * exact-match lookup. The fallback prefix matcher uses EXACT_KEYS to avoid
 * over-matching (e.g. "cac" swallowing "cac front").
 */
const HEADER_MAP: Record<string, keyof DailyRow> = {
  // Identity
  "data": "data",
  "dia da semana": "diaSemana",
  "dia semana": "diaSemana",

  // Investment & sales
  "investimento": "investimento",
  "vendas front": "vendasFront",
  "vendas totais do funil": "vendasTotais",
  "vendas totais funil todo": "vendasTotais",
  "vendas totais funil": "vendasTotais",
  "vendas totais": "vendasTotais",
  "cpa front": "cpaFront",

  // Revenue
  "faturamento bruto total do funil": "fatBruto",
  "faturamento bruto": "fatBruto",
  "faturamento liquido total do funil taxas e imposto meta": "fatLiquido",
  "faturamento liquido": "fatLiquido",
  "imposto meta": "impostoMeta",
  "taxa meta": "impostoMeta",
  "faturamento front": "fatFront",
  "faturamento total orderbump": "fatOrderbump",
  "faturamento total funil": "fatFunil",
  "faturamento funil": "fatFunil",

  // Profit metrics
  "roi": "roi",
  "roi fat liquido imposto meta": "roi",
  "lucro": "lucro",
  "lucro bruto": "lucro",
  "lucro liquido": "lucro",
  "cac": "cac",
  "aov": "aov",
  "ticket medio": "aov",

  // Refunds
  "reembolsos": "reembolsos",
  "taxa de reembolso": "taxaReembolso",
  "valor reembolsado": "valorReembolsado",

  // Approval
  "aprovacao cartao": "aprovCartao",
  "aprovacao pix": "aprovPix",
  "% aprovacao cartao": "aprovCartao",
  "% aprovacao pix": "aprovPix",

  // Traffic funnel
  "impressoes": "impressoes",
  "cliques": "cliques",
  "cliques no link": "cliques",
  "link clicks": "cliques",
  "landing page views": "landingPageviews",
  "landing pageviews": "landingPageviews",
  "lp views": "landingPageviews",
  "visualizacoes da pagina de destino": "landingPageviews",
  "visualizacoes de pagina de destino": "landingPageviews",
  "pageviews": "pageviews",
  "checkouts": "checkouts",
  "cpm": "cpm",
  "ctr": "ctr",
  "cpc": "cpc",
  "custo por pageview": "custoPageview",
  "custo por i c": "custoIC",
  "taxa de carregamento": "taxaCarreg",
  "passagem para o checkout": "passChk",

  // VSL funnel
  "play rate": "playRate",
  "retencao pitch": "retPitch",
  "visualizacoes unicas": "viewsUnicas",
  "chegaram no pitch": "chegaramPitch",
  "pitch checkout": "pitchChk",
  "pitch venda": "pitchVenda",
  "checkout venda front": "chkVenda",
  "checkout venda": "chkVenda",

  "observacoes gerais": "obs",
};

/**
 * Keys that must match EXACTLY (no prefix fuzzy fallback). Prevents short
 * keys like "cac" from swallowing "cac front" or "aov" from being mistaken
 * for other "aov…" columns.
 */
const EXACT_KEYS = new Set<string>([
  "cac",
  "aov",
  "roi",
  "lucro",
  "cpm",
  "ctr",
  "cpc",
  "data",
]);

function findKey(header: string): keyof DailyRow | null {
  const s = slug(header);
  if (HEADER_MAP[s]) return HEADER_MAP[s];
  for (const k in HEADER_MAP) {
    if (EXACT_KEYS.has(k)) continue;
    if (s.startsWith(k) || k.startsWith(s)) return HEADER_MAP[k];
  }
  return null;
}

/* ============================================================
   Detect dynamic bumps/upsells from header trios:
     "Orderbump - <Name> (R$ X,XX)" | "Upsell - <Name>"
     followed by "Faturamento - Orderbump|Upsell - <Name>"
     followed by "% Conversão - Orderbump|Upsell - <Name>"
   We skip the aggregate "Faturamento Total - Orderbump" and
   "% Conversao Geral - Orderbump" headers.
   ============================================================ */
function detectBumps(headers: string[]): BumpDef[] {
  const out: BumpDef[] = [];
  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i] || "";
    const s = slug(raw);
    if (!s) continue;

    // ---- Format A: "Orderbump - <Name> (R$ X)" / "Upsell - <Name>" ----
    const isOrderbumpA =
      (s.startsWith("orderbump ") || s.startsWith("upsell ")) &&
      !s.startsWith("orderbump total") &&
      !raw.toLowerCase().includes("faturamento") &&
      !raw.toLowerCase().includes("receita") &&
      !raw.toLowerCase().includes("conversão") &&
      !raw.toLowerCase().includes("conversao");

    // ---- Format B: "Bump N: <Name>" / "Upsell" (followed by "Receita …" + "Tx %") ----
    // Match "bump 1 ...", "bump 2 ...", or a bare "upsell" header used as count column.
    const bumpNumMatch = /^bump\s+(\d+)\b/.exec(s);
    const isUpsellBare = s === "upsell";
    const isOrderbumpB = !!bumpNumMatch || isUpsellBare;
    // Avoid double-matching format A as B
    const isFormatB =
      isOrderbumpB &&
      !raw.toLowerCase().includes("receita") &&
      !raw.toLowerCase().includes("faturamento") &&
      !s.startsWith("orderbump ") &&
      !s.startsWith("upsell ");

    if (!isOrderbumpA && !isFormatB) continue;

    let type: "orderbump" | "upsell";
    let name: string;
    let price: number | null = null;

    if (isOrderbumpA) {
      type = s.startsWith("upsell") ? "upsell" : "orderbump";
      const prefixRe = /^(orderbump|upsell)\s*-?\s*/i;
      name = raw.replace(/\n/g, " ").replace(prefixRe, "").trim();
      const priceMatch = name.match(/\(R\$\s*([\d.,]+)\)\s*$/i);
      price = priceMatch ? parseBR(priceMatch[1]) : null;
      name = name.replace(/\(R\$[^)]*\)\s*$/i, "").trim() || raw;
    } else {
      type = isUpsellBare ? "upsell" : "orderbump";
      // "Bump 1:\nAlongue-se Bem" → "Alongue-se Bem"; bare "Upsell" → "Upsell"
      const cleaned = raw.replace(/\n/g, " ").trim();
      const colonIdx = cleaned.indexOf(":");
      name = colonIdx >= 0 ? cleaned.slice(colonIdx + 1).trim() : cleaned;
      if (!name) name = isUpsellBare ? "Upsell" : `Bump ${bumpNumMatch?.[1] ?? ""}`.trim();
    }

    // Look ahead for matching revenue + rate columns within next 4 cols
    let revCol = -1;
    let rateCol = -1;
    for (let j = i + 1; j < Math.min(i + 5, headers.length); j++) {
      const hraw = headers[j] || "";
      const hs = slug(hraw);
      if (revCol < 0 && (hs.startsWith("faturamento ") || hs.startsWith("receita "))) {
        revCol = j;
      } else if (
        rateCol < 0 &&
        (hs.startsWith("conversao ") ||
          hs === "tx" ||
          hs.startsWith("tx ") ||
          hs.startsWith("taxa "))
      ) {
        rateCol = j;
      }
      if (revCol >= 0 && rateCol >= 0) break;
    }
    // Fallback: assume next col is revenue, col after is rate
    if (revCol < 0 && i + 1 < headers.length) revCol = i + 1;
    if (rateCol < 0 && i + 2 < headers.length) rateCol = i + 2;

    out.push({ name, type, price, countCol: i, revCol, rateCol });
  }
  return out;
}

/* ============================================================
   Main parser
   ============================================================ */
export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
  const rows = result.data;
  if (rows.length < 2) return { rows: [], bumpDefs: [] };

  const headers = rows[0];
  const idx: Partial<Record<keyof DailyRow, number>> = {};
  headers.forEach((h, i) => {
    const k = findKey(h);
    if (k && idx[k] == null) idx[k] = i;
  });

  const bumpDefs = detectBumps(headers);

  // Aggregate columns from CSV
  let convGeralOrderbumpCol = -1;
  let proporcaoFunilFrontCol = -1;
  headers.forEach((h, i) => {
    const s = slug(h);
    if (convGeralOrderbumpCol < 0 && s.includes("conversao geral") && s.includes("orderbump")) {
      convGeralOrderbumpCol = i;
    }
    if (
      proporcaoFunilFrontCol < 0 &&
      s.includes("proporcao") &&
      s.includes("front") &&
      s.includes("funil")
    ) {
      proporcaoFunilFrontCol = i;
    }
  });

  const out: DailyRow[] = [];
  const headerDataIdx = idx.data ?? 0;
  const headerDataSlug = slug(headers[headerDataIdx] || "");
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    const dataRaw = (row[headerDataIdx] || "").trim();
    if (!dataRaw) continue;
    // Pula linhas que repetem o header (caso CSVs concatenados tragam header duplicado)
    if (headerDataSlug && slug(dataRaw) === headerDataSlug) continue;
    const date = parseDateBR(dataRaw);
    if (!date) continue;

    const get = (k: keyof DailyRow) => {
      const i = idx[k];
      return i == null ? null : parseBR(row[i]);
    };
    const getStr = (k: keyof DailyRow) => {
      const i = idx[k];
      return i == null ? "" : (row[i] || "").trim();
    };

    const bumps: BumpDaily[] = bumpDefs.map((b) => ({
      name: b.name,
      type: b.type,
      count: parseBR(row[b.countCol]),
      revenue: parseBR(row[b.revCol]),
      rate: parseBR(row[b.rateCol]),
    }));

    out.push({
      data: dataRaw,
      date,
      diaSemana: getStr("diaSemana"),
      investimento: get("investimento"),
      vendasFront: get("vendasFront"),
      vendasTotais: get("vendasTotais"),
      cpaFront: get("cpaFront"),
      fatBruto: get("fatBruto"),
      fatLiquido: get("fatLiquido"),
      impostoMeta: get("impostoMeta"),
      roi: get("roi"),
      lucro: get("lucro"),
      cac: get("cac"),
      aov: get("aov"),
      fatFront: get("fatFront"),
      fatOrderbump: get("fatOrderbump"),
      fatFunil: get("fatFunil"),
      reembolsos: get("reembolsos"),
      taxaReembolso: get("taxaReembolso"),
      valorReembolsado: get("valorReembolsado"),
      aprovCartao: get("aprovCartao"),
      aprovPix: get("aprovPix"),
      impressoes: get("impressoes"),
      cliques: get("cliques"),
      landingPageviews: get("landingPageviews") ?? get("pageviews"),
      pageviews: get("pageviews"),
      checkouts: get("checkouts"),
      cpm: get("cpm"),
      ctr: get("ctr"),
      cpc: get("cpc"),
      custoPageview: get("custoPageview"),
      custoIC: get("custoIC"),
      taxaCarreg: get("taxaCarreg"),
      passChk: get("passChk"),
      playRate: get("playRate"),
      retPitch: get("retPitch"),
      viewsUnicas: get("viewsUnicas"),
      chegaramPitch: get("chegaramPitch"),
      pitchChk: get("pitchChk"),
      pitchVenda: get("pitchVenda"),
      chkVenda: get("chkVenda"),
      obs: getStr("obs"),
      convGeralOrderbump: convGeralOrderbumpCol >= 0 ? parseBR(row[convGeralOrderbumpCol]) : null,
      proporcaoFunilFront: proporcaoFunilFrontCol >= 0 ? parseBR(row[proporcaoFunilFrontCol]) : null,
      bumps,
    });
  }

  out.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  return { rows: out, bumpDefs };
}
