import { describe, expect, it } from "vitest";
import {
  buildCreativeAnalysisFallback,
  buildCreativeDailyMetrics,
  deriveCreativeAsset,
} from "../../supabase/functions/creative-sync/core";

describe("creative sync core", () => {
  it("derives a Facebook post URL from effective_object_story_id", () => {
    const asset = deriveCreativeAsset({
      id: "ad-1",
      creative: {
        id: "creative-1",
        title: "Criativo",
        effective_object_story_id: "123456_987654",
        image_url: "https://example.com/image.jpg",
      },
    });

    expect(asset.postUrl).toBe("https://www.facebook.com/123456/posts/987654");
    expect(asset.facebookPostUrl).toBe("https://www.facebook.com/123456/posts/987654");
    expect(asset.instagramPostUrl).toBeNull();
  });

  it("keeps Facebook and Instagram moderation links separately", () => {
    const asset = deriveCreativeAsset({
      id: "ad-2",
      creative: {
        id: "creative-2",
        object_story_id: "123456_987654",
        instagram_permalink_url: "https://www.instagram.com/p/abc123/",
        image_url: "https://example.com/image.jpg",
      },
    });

    expect(asset.postUrl).toBe("https://www.facebook.com/123456/posts/987654");
    expect(asset.facebookPostUrl).toBe("https://www.facebook.com/123456/posts/987654");
    expect(asset.instagramPostUrl).toBe("https://www.instagram.com/p/abc123/");
  });

  it("derives a shared asset key from video creative data", () => {
    const derived = deriveCreativeAsset({
      id: "ad-3",
      name: "Anuncio 1",
      creative: {
        id: "creative-3",
        title: "Headline",
        body: "Body",
        thumbnail_url: "https://example.com/thumb.jpg",
        object_story_spec: {
          video_data: {
            video_id: "video-123",
            message: "Mensagem",
          },
        },
      },
    });

    expect(derived.mediaType).toBe("video");
    expect(derived.assetKey).toBe("video:video-123");
    expect(derived.primaryText).toBe("Body");
  });

  it("builds daily metrics with video hook rate and image proxy fallback", () => {
    const metrics = buildCreativeDailyMetrics({
      metaRows: [
        {
          event_date: "2026-06-01",
          payload: {
            ad_id: "ad-video",
            spend: 120,
            impressions: 1000,
            clicks: 20,
            outbound_clicks: [{ action_type: "outbound_click", value: 12 }],
            video_p25_watched_actions: [{ action_type: "video_p25_watched_actions", value: 250 }],
          },
        },
        {
          event_date: "2026-06-01",
          payload: {
            ad_id: "ad-image",
            spend: 80,
            impressions: 800,
            clicks: 16,
            outbound_clicks: [{ action_type: "outbound_click", value: 8 }],
          },
        },
      ],
      gatewayRows: [
        {
          event_date: "2026-06-01",
          event_type: "purchase.approved",
          payload: {
            utm_content: "ad-video",
            transaction_id: "tx-video-1",
            total: 300,
          },
        },
        {
          event_date: "2026-06-01",
          event_type: "purchase.refunded",
          payload: {
            transaction_id: "tx-video-1",
            total: 300,
          },
        },
      ],
      assetIdByAdId: new Map([
        ["ad-video", "asset-video"],
        ["ad-image", "asset-image"],
      ]),
      mediaTypeByAssetId: new Map([
        ["asset-video", "video"],
        ["asset-image", "image"],
      ]),
    });

    const videoRow = metrics.find((row) => row.asset_id === "asset-video");
    const imageRow = metrics.find((row) => row.asset_id === "asset-image");

    expect(videoRow?.hook_rate).toBeCloseTo(25, 1);
    expect(videoRow?.purchases).toBe(1);
    expect(videoRow?.revenue).toBe(300);
    expect(videoRow?.refunds).toBe(1);
    expect(videoRow?.refund_value).toBe(300);
    expect(videoRow?.refund_rate).toBe(100);
    expect(imageRow?.hook_rate).toBeCloseTo(1, 1);
    expect(imageRow?.link_ctr).toBeCloseTo(1, 1);
  });

  it("separates front, order bump, and upsell volume and revenue", () => {
    const rows = buildCreativeDailyMetrics({
      metaRows: [],
      gatewayRows: [
        {
          event_date: "2026-06-01",
          event_type: "purchase.approved",
          payload: { utm_content: "ad-1", total: 197, is_front: true },
        },
        {
          event_date: "2026-06-01",
          event_type: "purchase.approved",
          payload: {
            utm_content: "ad-1",
            total: 47,
            is_front: false,
            is_offer_event: true,
            items: [{ type: "orderbump", is_bump: true, price: 47 }],
          },
        },
        {
          event_date: "2026-06-01",
          event_type: "purchase.approved",
          payload: { utm_content: "ad-1", total: 97, is_front: false, is_offer_event: false },
        },
      ],
      assetIdByAdId: new Map([["ad-1", "asset-1"]]),
      mediaTypeByAssetId: new Map([["asset-1", "video"]]),
    });

    expect(rows[0]).toMatchObject({
      purchases: 1,
      revenue: 341,
      order_bump_purchases: 1,
      order_bump_revenue: 47,
      upsell_purchases: 1,
      upsell_revenue: 97,
    });
  });

  it("keeps a late refund linked when only the approved event has UTM", () => {
    const rows = buildCreativeDailyMetrics({
      metaRows: [],
      gatewayRows: [
        {
          event_date: "2026-06-01",
          event_type: "purchase.approved",
          payload: { utm_content: "ad-late-refund", transaction_id: "tx-late", total: 200 },
        },
        {
          event_date: "2026-06-10",
          event_type: "purchase.refunded",
          payload: { transaction_id: "tx-late", refund_amount: 200 },
        },
        {
          event_date: "2026-06-10",
          event_type: "purchase.refunded",
          payload: { transaction_id: "tx-late", refund_amount: 200 },
        },
      ],
      assetIdByAdId: new Map([["ad-late-refund", "asset-late-refund"]]),
      mediaTypeByAssetId: new Map([["asset-late-refund", "video"]]),
    });

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        asset_id: "asset-late-refund",
        event_date: "2026-06-10",
        refunds: 1,
        refund_value: 200,
      }),
    ]));
  });

  it("does not present ad metadata as inferred AI analysis", () => {
    const fallback = buildCreativeAnalysisFallback({
      mediaType: "video",
      transcriptStatus: "pending",
      headline: "Headline",
      primaryText: "Texto",
      cta: "Comprar",
    });

    expect(fallback.status).toBe("pending");
    expect(fallback.transcript).toBeNull();
    expect(fallback.summary).toBe("Criativo aguardando processamento.");
    expect(fallback.hook).toBeNull();
    expect(fallback.angle).toBeNull();
    expect(fallback.copy).toBe("Texto");
    expect(fallback.analysisCoverage).toBe("pending");
  });
});
