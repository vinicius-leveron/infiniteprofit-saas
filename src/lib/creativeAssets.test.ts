import { describe, expect, it } from "vitest";
import {
  applyCreativeFilters,
  buildCreativeAssetCards,
  derivePipelineStatus,
  groupCreativeCards,
  parseCreativeGroupRules,
  resolveSortKey,
  sortCreativeCards,
  type CreativeAssetAdRow,
  type CreativeAssetAnalysisRow,
  type CreativeAssetMetricRow,
  type CreativeAssetRow,
} from "./creativeAssets";

const assets: CreativeAssetRow[] = [
  {
    id: "asset-1",
    creative_id: "creative-1",
    asset_key: "video:abc",
    media_type: "video",
    thumbnail_url: "https://example.com/creative-1.jpg",
    media_storage_path: null,
    headline: "Hook criativo forte",
    primary_text: "Texto principal do criativo",
    cta: "Saiba mais",
    landing_url: "https://example.com",
    post_url: "https://www.facebook.com/123/posts/456",
    facebook_post_url: "https://www.facebook.com/123/posts/456",
    instagram_post_url: "https://www.instagram.com/p/abc/",
    analysis_status: "ready",
    last_meta_synced_at: "2026-06-03T12:00:00Z",
    source_media_url: "https://example.com/creative-1.mp4",
    source_fetched_at: "2026-06-03T12:00:00Z",
    media_bytes: 1024,
    media_duration_ms: 12000,
    media_fingerprint: "fingerprint-1",
    poster_storage_path: "project/poster/video-1.jpg",
    last_processed_at: "2026-06-03T12:00:00Z",
    processing_version: "v2",
  },
  {
    id: "asset-2",
    creative_id: "creative-2",
    asset_key: "image:def",
    media_type: "image",
    thumbnail_url: null,
    media_storage_path: null,
    headline: "Criativo imagem",
    primary_text: "Copy de imagem",
    cta: "Comprar",
    landing_url: null,
    post_url: null,
    facebook_post_url: null,
    instagram_post_url: null,
    analysis_status: "processing",
    last_meta_synced_at: "2026-06-03T12:00:00Z",
    source_media_url: "https://example.com/creative-2.jpg",
    source_fetched_at: "2026-06-03T12:00:00Z",
    media_bytes: 2048,
    media_duration_ms: null,
    media_fingerprint: "fingerprint-2",
    poster_storage_path: null,
    last_processed_at: null,
    processing_version: null,
  },
];

const ads: CreativeAssetAdRow[] = [
  {
    asset_id: "asset-1",
    ad_id: "ad-1",
    ad_name: "Anúncio 1",
    adset_id: "adset-1",
    adset_name: "Adset Escala",
    campaign_id: "camp-1",
    campaign_name: "Campanha Escala",
  },
  {
    asset_id: "asset-1",
    ad_id: "ad-2",
    ad_name: "Anúncio 2",
    adset_id: "adset-1",
    adset_name: "Adset Escala",
    campaign_id: "camp-1",
    campaign_name: "Campanha Escala",
  },
  {
    asset_id: "asset-2",
    ad_id: "ad-3",
    ad_name: "Anúncio 3",
    adset_id: "adset-2",
    adset_name: "Adset Teste",
    campaign_id: "camp-2",
    campaign_name: "Campanha Teste",
  },
];

const metrics: CreativeAssetMetricRow[] = [
  {
    asset_id: "asset-1",
    event_date: "2026-06-01",
    spend: 100,
    impressions: 1000,
    clicks: 40,
    outbound_clicks: 25,
    ctr: 4,
    link_ctr: 2.5,
    cpm: 100,
    purchases: 4,
    revenue: 400,
    refunds: 1,
    refund_value: 100,
    order_bump_purchases: 2,
    order_bump_revenue: 80,
    upsell_purchases: 1,
    upsell_revenue: 120,
    refund_rate: 25,
    roas: 4,
    cpa: 25,
    hook_rate: 35,
    has_meta_data: true,
    has_gateway_data: true,
  },
  {
    asset_id: "asset-1",
    event_date: "2026-06-02",
    spend: 50,
    impressions: 500,
    clicks: 20,
    outbound_clicks: 10,
    ctr: 4,
    link_ctr: 2,
    cpm: 100,
    purchases: 2,
    revenue: 180,
    refunds: 0,
    refund_value: 0,
    order_bump_purchases: 1,
    order_bump_revenue: 40,
    upsell_purchases: 0,
    upsell_revenue: 0,
    refund_rate: 0,
    roas: 3.6,
    cpa: 25,
    hook_rate: 45,
    has_meta_data: true,
    has_gateway_data: true,
  },
  {
    asset_id: "asset-2",
    event_date: "2026-06-02",
    spend: 200,
    impressions: 2000,
    clicks: 20,
    outbound_clicks: 6,
    ctr: 1,
    link_ctr: 0.3,
    cpm: 100,
    purchases: 1,
    revenue: 120,
    refunds: 0,
    refund_value: 0,
    order_bump_purchases: 0,
    order_bump_revenue: 0,
    upsell_purchases: 0,
    upsell_revenue: 0,
    refund_rate: 0,
    roas: 0.6,
    cpa: 200,
    hook_rate: 0.3,
    has_meta_data: true,
    has_gateway_data: true,
  },
];

const analyses: CreativeAssetAnalysisRow[] = [
  {
    asset_id: "asset-1",
    status: "ready",
    transcript_status: "ready",
    transcript: "Transcrição do criativo",
    transcript_segments: [{ start_ms: 0, end_ms: 1200, text: "Transcrição do criativo" }],
    transcript_language: "pt",
    transcript_provider: "openai",
    transcript_model: "gpt-4o-mini-transcribe",
    transcript_error_message: null,
    summary: "Resumo",
    hook: "Hook",
    hook_timestamps: [{ start_ms: 0, end_ms: 1500, label: "Abertura", reason: "Promessa clara" }],
    angle: "Ângulo",
    copy: "Copy",
    cta: "CTA",
    visual: "Visual",
    visual_evidence: [{ timestamp_ms: 0, observation: "Pessoa em close" }],
    tags: ["hook", "escala"],
    scores: { hook_score: 82, clareza_da_copy: 74, escala: 88 },
    analysis_coverage: "full",
    analysis_error_message: null,
    error_message: null,
    processed_at: "2026-06-03T12:00:00Z",
  },
];

describe("creative assets view helpers", () => {
  it("aggregates cards by asset and computes weighted metrics", () => {
    const cards = buildCreativeAssetCards({ assets, ads, metrics, analyses });
    const first = cards.find((card) => card.id === "asset-1");

    expect(first?.adsCount).toBe(2);
    expect(first?.spend).toBe(150);
    expect(first?.purchases).toBe(6);
    expect(first?.revenue).toBe(580);
    expect(first?.refunds).toBe(1);
    expect(first?.refundValue).toBe(100);
    expect(first?.orderBumpPurchases).toBe(3);
    expect(first?.orderBumpRevenue).toBe(120);
    expect(first?.upsellPurchases).toBe(1);
    expect(first?.upsellRevenue).toBe(120);
    expect(first?.aov).toBeCloseTo(96.66, 1);
    expect(first?.instagramPostUrl).toBe("https://www.instagram.com/p/abc/");
    expect(first?.refundRate).toBeCloseTo(16.66, 1);
    expect(first?.roas).toBeCloseTo(3.866, 2);
    expect(first?.hookRate).toBeCloseTo(38.33, 1);
    expect(first?.scores.hook).toBe(82);
    expect(first?.scores.clareza).toBe(74);
    expect(first?.scores.potencial_de_escala).toBe(88);
    expect(first?.tags).toContain("hook");
    expect(first?.pipelineStatus).toBe("ready");
    expect(first?.transcriptSegments).toHaveLength(1);
  });

  it("filters and sorts cards using saved rule shape", () => {
    const cards = buildCreativeAssetCards({ assets, ads, metrics, analyses });
    const rules = parseCreativeGroupRules({
      mediaType: "video",
      pipelineStatus: "ready",
      minRoas: 2,
      campaignQuery: "escala",
    });

    const filtered = applyCreativeFilters(cards, { search: "hook", rules });
    const sorted = sortCreativeCards(filtered, "roas");

    expect(sorted).toHaveLength(1);
    expect(sorted[0].id).toBe("asset-1");
    expect(resolveSortKey("best-roas", "spend", null)).toBe("roas");
  });

  it("groups cards by campaign and adset labels", () => {
    const cards = buildCreativeAssetCards({ assets, ads, metrics, analyses });
    const groupedByCampaign = groupCreativeCards(cards, "campaign");
    const groupedByAdset = groupCreativeCards(cards, "adset");

    expect(groupedByCampaign.map((group) => group.label)).toContain("Campanha Escala");
    expect(groupedByAdset.map((group) => group.label)).toContain("Adset Teste");
  });

  it("derives granular pipeline states for transcript and analysis stages", () => {
    expect(derivePipelineStatus({
      mediaType: "video",
      analysisStatus: "processing",
      transcriptStatus: "processing",
      analysisCoverage: "pending",
      activeJobStatus: "running",
      transcript: null,
      transcriptErrorMessage: null,
      analysisErrorMessage: null,
    })).toBe("transcribing");

    expect(derivePipelineStatus({
      mediaType: "video",
      analysisStatus: "processing",
      transcriptStatus: "pending",
      analysisCoverage: "pending",
      activeJobStatus: null,
      transcript: null,
      transcriptErrorMessage: null,
      analysisErrorMessage: null,
    })).toBe("pending");

    expect(derivePipelineStatus({
      mediaType: "video",
      analysisStatus: "processing",
      transcriptStatus: "processing",
      analysisCoverage: "pending",
      activeJobStatus: null,
      transcript: null,
      transcriptErrorMessage: null,
      analysisErrorMessage: null,
    })).toBe("pending");

    expect(derivePipelineStatus({
      mediaType: "video",
      analysisStatus: "pending",
      transcriptStatus: "pending",
      analysisCoverage: "pending",
      activeJobStatus: "queued",
      transcript: null,
      transcriptErrorMessage: null,
      analysisErrorMessage: null,
    })).toBe("transcribing");

    expect(derivePipelineStatus({
      mediaType: "video",
      analysisStatus: "processing",
      transcriptStatus: "ready",
      analysisCoverage: "partial",
      activeJobStatus: "running",
      transcript: "texto",
      transcriptErrorMessage: null,
      analysisErrorMessage: null,
    })).toBe("analyzing");

    expect(derivePipelineStatus({
      mediaType: "video",
      analysisStatus: "failed",
      transcriptStatus: "failed",
      analysisCoverage: "failed",
      activeJobStatus: null,
      transcript: null,
      transcriptErrorMessage: "erro",
      analysisErrorMessage: null,
    })).toBe("missing_transcript");
  });
});
