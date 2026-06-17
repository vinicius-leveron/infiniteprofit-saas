import { describe, expect, it } from "vitest";
import { deriveCreativeAsset } from "../../supabase/functions/creative-sync/core";

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
  });

  it("prefers Instagram permalink when Meta returns one", () => {
    const asset = deriveCreativeAsset({
      id: "ad-2",
      creative: {
        id: "creative-2",
        object_story_id: "123456_987654",
        instagram_permalink_url: "https://www.instagram.com/p/abc123/",
        image_url: "https://example.com/image.jpg",
      },
    });

    expect(asset.postUrl).toBe("https://www.instagram.com/p/abc123/");
  });
});
