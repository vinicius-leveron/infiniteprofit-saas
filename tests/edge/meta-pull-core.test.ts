import { describe, expect, it } from "vitest";
import {
  META_INSIGHT_LEVELS,
  parseMetaInsightLevels,
} from "../../supabase/functions/meta-pull/core";

describe("Meta pull profiles", () => {
  it("keeps full collection for manual/user syncs", () => {
    expect(parseMetaInsightLevels(["account"], false)).toEqual(
      META_INSIGHT_LEVELS,
    );
  });

  it("allows the worker to select safe insight levels", () => {
    expect(
      parseMetaInsightLevels(
        ["account", "account", "invalid", "campaign"],
        true,
      ),
    ).toEqual(["account", "campaign"]);
  });

  it("falls back to a full sync when the worker profile is absent or invalid", () => {
    expect(parseMetaInsightLevels(undefined, true)).toEqual(
      META_INSIGHT_LEVELS,
    );
    expect(parseMetaInsightLevels(["invalid"], true)).toEqual(
      META_INSIGHT_LEVELS,
    );
  });
});
