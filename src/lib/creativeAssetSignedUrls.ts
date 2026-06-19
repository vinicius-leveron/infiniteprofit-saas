import type { CreativeAssetRow } from "./creativeAssets";

export interface CreativeAssetSignedUrl {
  id: string;
  media_type?: CreativeAssetRow["media_type"] | null;
  media_url: string | null;
  poster_url: string | null;
}

export function applyCreativeAssetSignedUrls(
  assets: CreativeAssetRow[],
  signedUrls: CreativeAssetSignedUrl[],
): CreativeAssetRow[] {
  if (signedUrls.length === 0) return assets;

  const signedByAssetId = new Map(signedUrls.map((item) => [item.id, item]));

  return assets.map((asset) => {
    const signed = signedByAssetId.get(asset.id);
    if (!signed) return asset;

    const mediaUrl = signed.media_url ?? null;
    const posterUrl = signed.poster_url ?? null;

    if (asset.media_type === "video") {
      return {
        ...asset,
        thumbnail_url: posterUrl ?? asset.thumbnail_url,
        source_media_url: mediaUrl ?? asset.source_media_url,
      };
    }

    if (asset.media_type === "image") {
      return {
        ...asset,
        thumbnail_url: mediaUrl ?? posterUrl ?? asset.thumbnail_url,
        source_media_url: mediaUrl ?? asset.source_media_url,
      };
    }

    return {
      ...asset,
      thumbnail_url: mediaUrl ?? posterUrl ?? asset.thumbnail_url,
      source_media_url: mediaUrl ?? asset.source_media_url,
    };
  });
}
