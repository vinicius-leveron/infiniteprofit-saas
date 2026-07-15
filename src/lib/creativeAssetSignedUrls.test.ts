import { describe, expect, it } from "vitest";
import type { CreativeAssetRow } from "./creativeAssets";
import { applyCreativeAssetSignedUrls } from "./creativeAssetSignedUrls";

const baseAsset: CreativeAssetRow = {
  id: "asset-1",
  creative_id: "creative-1",
  asset_key: "video:asset-1",
  media_type: "video",
  thumbnail_url: "https://public.example.com/poster.jpg",
  media_storage_path: "project-1/media/asset-1.mp4",
  headline: "Hook",
  primary_text: "Copy",
  cta: "Saiba mais",
  landing_url: "https://example.com",
  post_url: null,
  analysis_status: "ready",
  last_meta_synced_at: "2026-06-18T12:00:00Z",
  source_media_url: "https://public.example.com/video.mp4",
  source_fetched_at: "2026-06-18T12:00:00Z",
  media_bytes: 1024,
  media_duration_ms: 12000,
  media_fingerprint: "fingerprint",
  poster_storage_path: "project-1/posters/asset-1.jpg",
  last_processed_at: "2026-06-18T12:00:00Z",
  processing_version: "creative-sync-v2",
};

describe("applyCreativeAssetSignedUrls", () => {
  it("uses signed poster and media URLs for videos", () => {
    const [asset] = applyCreativeAssetSignedUrls([baseAsset], [
      {
        id: "asset-1",
        media_url: "https://signed.example.com/video.mp4",
        poster_url: "https://signed.example.com/poster.jpg",
      },
    ]);

    expect(asset.thumbnail_url).toBe("https://signed.example.com/poster.jpg");
    expect(asset.source_media_url).toBe("https://signed.example.com/video.mp4");
    expect(baseAsset.thumbnail_url).toBe("https://public.example.com/poster.jpg");
  });

  it("uses signed media URL as the image thumbnail", () => {
    const imageAsset: CreativeAssetRow = {
      ...baseAsset,
      id: "asset-2",
      asset_key: "image:asset-2",
      media_type: "image",
      source_media_url: "https://public.example.com/image.jpg",
      media_duration_ms: null,
      poster_storage_path: null,
    };

    const [asset] = applyCreativeAssetSignedUrls([imageAsset], [
      {
        id: "asset-2",
        media_url: "https://signed.example.com/image.jpg",
        poster_url: null,
      },
    ]);

    expect(asset.thumbnail_url).toBe("https://signed.example.com/image.jpg");
    expect(asset.source_media_url).toBe("https://signed.example.com/image.jpg");
  });

  it("keeps legacy URLs when signing has no replacement", () => {
    const [asset] = applyCreativeAssetSignedUrls([baseAsset], [
      {
        id: "asset-1",
        media_url: null,
        poster_url: null,
      },
    ]);

    expect(asset.thumbnail_url).toBe(baseAsset.thumbnail_url);
    expect(asset.source_media_url).toBe(baseAsset.source_media_url);
  });
});
